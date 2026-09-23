import type { Action, ActionResult } from "@elizaos/core";
import { getContext } from "../context.js";
import { parseApprovalPayload, parseWalletInput } from "../parse.js";
import { checkWalletApprovals, explainApproval, type ApprovalVerdict } from "../services.js";
import { failure, paymentLine } from "./shared.js";

const VERDICT_ICON = { SAFE: "✅", CAUTION: "⚠️", RISK: "⛔" } as const;

export function formatVerdict(v: ApprovalVerdict, subject: string): string {
  return `${VERDICT_ICON[v.verdict] ?? ""} ${subject}: ${v.verdict}\n${v.explanation}`.trim();
}

export const checkWalletApprovalsAction: Action = {
  name: "FIZZL_CHECK_WALLET_APPROVALS",
  similes: ["CHECK_WALLET_APPROVALS", "WALLET_APPROVAL_CHECK", "REVOKE_CHECK", "CHECK_ALLOWANCES"],
  description:
    "Check an EVM wallet's live token or NFT approvals (allowances) and explain in plain language whether they are SAFE, CAUTION or RISK. Chains: ethereum, bsc, polygon, arbitrum, optimism, base, avalanche. Paid per call via x402: $0.10 USDC on Base. Parameters: address (0x…), chain, kind (token|nft).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return /\b(approv\w*|allowance\w*|revoke\w*|permissions?|safe|risky?|drain\w*)\b/i.test(text) && parseWalletInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parseWalletInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Send the EVM wallet address (0x…) to check.");

    const { client, urls } = await getContext(runtime);
    if (!client.wallets.base && client.canPay) {
      return failure(callback, "PlainText charges on Base. Set EVM_PRIVATE_KEY for a wallet holding USDC on Base.");
    }
    const result = await checkWalletApprovals(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not check ${input.address}: ${result.error}`);

    const short = `${input.address.slice(0, 6)}…${input.address.slice(-4)}`;
    const text = `${formatVerdict(result.data, `${short} ${input.kind} approvals on ${input.chain}`)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_CHECK_WALLET_APPROVALS"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { approvalVerdict: result.data.verdict },
      data: { verdict: result.data, input, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Are the token approvals on 0x6B0F4651eD42893ab58139938175E4a69f175F25 safe on base?" } },
      { name: "{{agent}}", content: { text: "⚠️ 0x6B0F…5F25 token approvals on base: CAUTION\nOne contract can spend unlimited USDC…", actions: ["FIZZL_CHECK_WALLET_APPROVALS"] } },
    ],
  ],
};

export const explainApprovalAction: Action = {
  name: "FIZZL_EXPLAIN_APPROVAL",
  similes: ["EXPLAIN_APPROVAL", "EXPLAIN_PERMISSION", "EXPLAIN_SIGNATURE_REQUEST"],
  description:
    "Explain a pasted approval/permission JSON payload (from a dapp prompt, scanner or signature request) in plain language with a SAFE/CAUTION/RISK verdict, without an on-chain lookup. Paid per call via x402: $0.05 USDC on Base. Parameter: data (the JSON object).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return /\b(explain|what does|is this|safe|risky?)\b/i.test(text) && /\b(approv\w*|permit\w*|permission|allowance|signature|spender)\b/i.test(text) && parseApprovalPayload(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const data = parseApprovalPayload(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!data) return failure(callback, "Paste the approval or permission JSON you want explained.");

    const { client, urls } = await getContext(runtime);
    if (!client.wallets.base && client.canPay) {
      return failure(callback, "PlainText charges on Base. Set EVM_PRIVATE_KEY for a wallet holding USDC on Base.");
    }
    const result = await explainApproval(client, urls, data);
    if (!result.ok || !result.data) return failure(callback, `Could not explain that payload: ${result.error}`);

    const text = `${formatVerdict(result.data, "This approval")}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_EXPLAIN_APPROVAL"], source: message.content?.source });
    return { success: true, text, values: { approvalVerdict: result.data.verdict }, data: { verdict: result.data, payment: result.payment } };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: 'Is this approval safe? {"spender":"0x1111111254eeb25477b68fb85ed929f73a960582","amount":"unlimited","token":"USDC"}' } },
      { name: "{{agent}}", content: { text: "⚠️ This approval: CAUTION\nIt lets the 1inch router spend all of your USDC…", actions: ["FIZZL_EXPLAIN_APPROVAL"] } },
    ],
  ],
};
