import type { Action, ActionResult } from "@elizaos/core";
import { getContext } from "../context.js";
import { parsePresignInput } from "../parse.js";
import { presignCheck, type PresignVerdict } from "../services.js";
import { failure, paymentLine } from "./shared.js";

const ASK = /\b(sign\w*|safe|risky?|check\w*|approv\w*|permit\w*|transaction|tx|drain\w*|phish\w*|scam\w*)\b/i;
const VERDICT = {
  green: "🟢 GREEN: no known risk signals. OK to sign.",
  orange: "🟠 ORANGE: ask a person before signing.",
  red: "🔴 RED: do not sign.",
} as const;
const SEVERITY_ORDER = { red: 0, orange: 1, info: 2 } as const;
const short = (s: string) => (/^0x[a-fA-F0-9]{40}$/.test(s) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

// Verdict and what to do first, then the reasons (red, orange, info), then the explanation.
export function formatPresign(v: PresignVerdict): string {
  const reasons = [...v.reasons]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((r) => `· ${r.severity}: ${r.code}${r.subject ? ` (${short(r.subject)})` : ""}`);
  return [VERDICT[v.verdict] ?? v.verdict, ...reasons, ...(v.explanation?.text ? [v.explanation.text] : [])].join("\n");
}

export const presignCheckAction: Action = {
  name: "FIZZL_PRESIGN_CHECK",
  similes: ["PRESIGN_CHECK", "CHECK_BEFORE_SIGNING", "IS_IT_SAFE_TO_SIGN", "SIGNATURE_RISK_CHECK", "TRANSACTION_RISK_CHECK"],
  description:
    "Before signing an EVM transaction, token approval or EIP-712 signature (Permit, Permit2, Seaport, x402 payment), ask presign-guard for a GREEN / ORANGE / RED verdict with reason codes. It checks who gets access (flagged or phishing addresses, plain wallets, unlimited or long-lived permissions) and the token itself (honeypots, fakes of known tokens such as a fake USDC in an x402 payment, owner powers, high taxes): only sign on green, ask a person on orange, never sign on red. Paid per call via x402: $0.01 USDC on Base ($0.03 with a plain-language explanation). Parameters: request (presign-guard body), or typedData (eth_signTypedData_v4 payload), or transaction ({ to, data, value, chainId }); explain (boolean), lang (en|nl).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return ASK.test(text) && parsePresignInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parsePresignInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Send what you are about to sign: the EIP-712 typed data, or the transaction { to, data, value, chainId }.");

    const { client, urls } = await getContext(runtime);
    if (client.canPay && !client.wallets.base) {
      return failure(callback, "presign-guard is paid in USDC on Base only. Set EVM_PRIVATE_KEY to a Base wallet with a little USDC.");
    }
    const result = await presignCheck(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not check this before signing: ${result.error}. Do not sign until it can be checked.`);

    const text = `${formatPresign(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_PRESIGN_CHECK"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { presignVerdict: result.data.verdict, safeToSign: result.data.verdict === "green" },
      data: { verdict: result.data, request: input.request, payment: result.payment },
    };
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: { text: 'Is it safe to sign this? {"primaryType":"Permit","domain":{"name":"USD Coin","version":"2","chainId":8453,"verifyingContract":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},"message":{"owner":"0x1111111111111111111111111111111111111111","spender":"0xbad0000000000000000000000000000000000001","value":"1000000000","nonce":0,"deadline":"9999999999"}}' },
      },
      { name: "{{agent}}", content: { text: "🔴 RED: do not sign.\n· red: SIGNATURE_GRANT_TO_EOA (0xbad0…0001)\n· info: OFFCHAIN_SIGNATURE", actions: ["FIZZL_PRESIGN_CHECK"] } },
    ],
  ],
};
