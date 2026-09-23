import type { Plugin, Provider } from "@elizaos/core";
import { ichimokuSignalAction } from "./actions/ichimoku-signal.js";
import { checkWalletApprovalsAction, explainApprovalAction } from "./actions/wallet-approvals.js";
import { diagnoseX402Action } from "./actions/x402-doctor.js";
import { getContext } from "./context.js";

// Tells the agent which paid tools it has and whether it can pay for them.
const servicesProvider: Provider = {
  name: "FIZZL_SERVICES",
  description: "Fizzl's paid x402 tools available to this agent and the wallets that pay for them",
  get: async (runtime) => {
    const { client } = await getContext(runtime);
    const wallets = [client.wallets.solana && `Solana ${client.wallets.solana}`, client.wallets.base && `Base ${client.wallets.base}`].filter(Boolean);
    const text = [
      "Paid tools (x402, USDC):",
      "- FIZZL_ICHIMOKU_SIGNAL: Ichimoku Cloud signal for a crypto pair, $0.02 (Solana or Base)",
      "- FIZZL_CHECK_WALLET_APPROVALS: risk of an EVM wallet's token/NFT approvals, $0.10 (Base)",
      "- FIZZL_EXPLAIN_APPROVAL: plain-language verdict on an approval JSON, $0.05 (Base)",
      "- FIZZL_DIAGNOSE_X402: diagnose why an x402 paid endpoint fails, with fix hints, $0.01 (Solana or Base)",
      wallets.length ? `Paying wallets: ${wallets.join(", ")}` : "No paying wallet configured; these tools will fail until SVM_PRIVATE_KEY or EVM_PRIVATE_KEY is set.",
    ].join("\n");
    return { text, values: { fizzlCanPay: client.canPay, fizzlWallets: wallets.join(", ") } };
  },
};

export const fizzlPlugin: Plugin = {
  name: "fizzl",
  description:
    "Fizzl's x402 agent services: Ichimoku Cloud trading signals (Solana/Base), PlainText wallet-approval risk checks (Base) and x402 Doctor endpoint diagnosis (Solana/Base), paid per call in USDC.",
  actions: [ichimokuSignalAction, checkWalletApprovalsAction, explainApprovalAction, diagnoseX402Action],
  providers: [servicesProvider],
  init: async (_config, runtime) => {
    const { client } = await getContext(runtime);
    if (!client.canPay) {
      console.warn("[fizzl] No paying wallet: set SVM_PRIVATE_KEY (Solana) and/or EVM_PRIVATE_KEY (Base) with USDC.");
    } else {
      console.log(`[fizzl] x402 payments enabled (${Object.entries(client.wallets).map(([n, a]) => `${n} ${a}`).join(", ")})`);
    }
  },
};

export default fizzlPlugin;
export { ichimokuSignalAction, checkWalletApprovalsAction, explainApprovalAction, diagnoseX402Action };
export { FizzlClient } from "./client.js";
export { parseSignalInput, parseWalletInput, parseApprovalPayload, parseDiagnoseInput } from "./parse.js";
