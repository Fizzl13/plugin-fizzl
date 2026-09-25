import type { Plugin, Provider } from "@elizaos/core";
import { ichimokuSignalAction } from "./actions/ichimoku-signal.js";
import { confluenceSignalAction, marketScanAction, priceLevelsAction } from "./actions/trading-signals.js";
import { checkWalletApprovalsAction, explainApprovalAction } from "./actions/wallet-approvals.js";
import { diagnoseX402Action, preflightX402Action } from "./actions/x402-doctor.js";
import { presignCheckAction } from "./actions/presign-guard.js";
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
      "- FIZZL_CONFLUENCE_SIGNAL: six indicators (Ichimoku, RSI, MACD, EMA 50/200, Bollinger, volume) with votes and a combined signal, $0.10 (Solana or Base)",
      "- FIZZL_PRICE_LEVELS: support/resistance, ATR and a long/short plan with stop and targets, $0.05 (Solana or Base)",
      "- FIZZL_MARKET_SCAN: the Ichimoku signal for 148 top-200 coins at once, strongest first, with market breadth, $0.25 (Solana or Base)",
      "- FIZZL_CHECK_WALLET_APPROVALS: risk of an EVM wallet's token/NFT approvals, $0.10 (Solana or Base)",
      "- FIZZL_EXPLAIN_APPROVAL: plain-language verdict on an approval JSON, $0.05 (Solana or Base)",
      "- FIZZL_PREFLIGHT_X402: before paying an unknown x402 endpoint, GO/CAUTION/NO-GO with the recommended option, $0.001 (Solana or Base)",
      "- FIZZL_DIAGNOSE_X402: diagnose why an x402 paid endpoint fails, with fix hints, $0.01 (Solana or Base)",
      "- FIZZL_PRESIGN_CHECK: before signing a transaction, approval or EIP-712 signature, GREEN/ORANGE/RED with reasons, $0.01 (Base)",
      wallets.length ? `Paying wallets: ${wallets.join(", ")}` : "No paying wallet configured; these tools will fail until SVM_PRIVATE_KEY or EVM_PRIVATE_KEY is set.",
    ].join("\n");
    return { text, values: { fizzlCanPay: client.canPay, fizzlWallets: wallets.join(", ") } };
  },
};

export const fizzlPlugin: Plugin = {
  name: "fizzl",
  description:
    "Fizzl's x402 agent services: Ichimoku Cloud, 6-indicator confluence, price-level and market-scan trading signals (Solana/Base), PlainText wallet-approval risk checks (Solana/Base), x402 Doctor pre-payment checks and endpoint diagnosis (Solana/Base) and presign-guard checks before signing (Base), paid per call in USDC.",
  actions: [ichimokuSignalAction, confluenceSignalAction, priceLevelsAction, marketScanAction, checkWalletApprovalsAction, explainApprovalAction, preflightX402Action, diagnoseX402Action, presignCheckAction],
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
export { ichimokuSignalAction, confluenceSignalAction, priceLevelsAction, marketScanAction, checkWalletApprovalsAction, explainApprovalAction, preflightX402Action, diagnoseX402Action, presignCheckAction };
export { FizzlClient } from "./client.js";
export { parseSignalInput, parseScanInput, parseWalletInput, parseApprovalPayload, parseDiagnoseInput, parsePreflightInput, parsePresignInput } from "./parse.js";
export { preflightX402, presignCheck } from "./services.js";
export type { PresignVerdict, PresignReason, ConfluenceSignal, PriceLevels, PricePlan, MarketScan, ScanCoin, ScanInput } from "./services.js";
export { getConfluenceSignal, getPriceLevels, getMarketScan } from "./services.js";
