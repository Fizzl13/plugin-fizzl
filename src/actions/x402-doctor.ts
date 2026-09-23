import type { Action, ActionResult } from "@elizaos/core";
import { getContext } from "../context.js";
import { parseDiagnoseInput, parsePreflightInput } from "../parse.js";
import { diagnoseX402, preflightX402, type Diagnosis, type Preflight } from "../services.js";
import { failure, paymentLine } from "./shared.js";

const TRIGGER = /\b(x402|402|paywall|payment[- ]required|paid (?:api|endpoint))\b/i;
const ASK = /\b(diagnos\w*|check\w*|debug\w*|test\w*|broken|work(?:s|ing)?|why|fix|doctor|validat\w*|audit\w*)\b/i;
const ICON = { pass: "✅", warn: "⚠️", fail: "⛔", skip: "·", info: "ℹ️" } as const;
// Buyer intent: the user is about to pay, not debugging their own endpoint.
const PAY_INTENT = /\b(safe to pay|should (?:i|we) pay|before (?:i |we )?pay\w*|ok to pay|worth paying|pay (?:for )?(?:this|it)|preflight|pre-?payment|trust\w*|legit\w*|scam\w*)\b/i;
const VERDICT = { go: "✅ GO", caution: "⚠️ CAUTION", no_go: "⛔ NO-GO" } as const;

// Verdict and summary first, then the recommended option, then the reasons.
export function formatPreflight(p: Preflight): string {
  const best = p.recommended_option === null ? null : p.options[p.recommended_option];
  const lines = [`${VERDICT[p.verdict]} ${p.url}`, p.summary];
  if (best && p.verdict !== "no_go") {
    lines.push(`Recommended: ${best.usd !== null ? `$${best.usd} ${best.asset_symbol ?? ""}`.trim() : `${best.amount} atomic units`} on ${best.network_name ?? best.network} → ${best.pay_to}`);
  }
  for (const r of p.reasons.filter((x) => x.level !== "info")) lines.push(`${r.level === "no_go" ? "⛔" : "⚠️"} ${r.message}`);
  for (const o of p.options.filter((x) => !x.payable)) lines.push(`· option ${o.index} (${o.network_name ?? o.network}): ${o.problems.join("; ")}`);
  return lines.join("\n");
}

// Failures and warnings first (with their fix hints), then a pass count.
export function formatDiagnosis(d: Diagnosis): string {
  const count = (s: string) => d.checks.filter((c) => c.status === s).length;
  const problems = d.checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "fail" ? -1 : 1))
    .map((c) => `${ICON[c.status]} ${c.message}${c.hint ? `\n   → ${c.hint}` : ""}`);
  return [
    `${ICON[d.overall]} ${d.url}${d.method ? ` (${d.method})` : ""}: ${d.overall.toUpperCase()}`,
    `${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed`,
    ...problems,
  ].join("\n");
}

export const diagnoseX402Action: Action = {
  name: "FIZZL_DIAGNOSE_X402",
  similes: ["X402_DOCTOR", "DIAGNOSE_X402", "CHECK_X402_ENDPOINT", "DEBUG_PAYWALL"],
  description:
    "Diagnose an x402 paid endpoint with x402 Doctor: 402 challenge format, accepts[] (network, asset, amount, payTo), resource URL, Solana settlement readiness, Bazaar/OpenAPI discovery and browser paywall, each with a fix hint. Never pays the endpoint itself. Paid per call via x402: $0.01 USDC on Solana or Base. Parameters: url, method (GET|POST, optional).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return TRIGGER.test(text) && ASK.test(text) && !PAY_INTENT.test(text) && parseDiagnoseInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parseDiagnoseInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Send the URL of the x402 endpoint to diagnose (https://…).");

    const { client, urls } = await getContext(runtime);
    const result = await diagnoseX402(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not diagnose ${input.url}: ${result.error}`);

    const text = `${formatDiagnosis(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_DIAGNOSE_X402"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { x402Overall: result.data.overall },
      data: { diagnosis: result.data, input, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Why doesn't my x402 endpoint work? https://api.example.com/paid" } },
      { name: "{{agent}}", content: { text: "⛔ https://api.example.com/paid (GET): FAIL\n14 passed, 1 warnings, 1 failed\n⛔ accepts[0]: amount \"0.01\" is not in atomic units…", actions: ["FIZZL_DIAGNOSE_X402"] } },
    ],
  ],
};

export const preflightX402Action: Action = {
  name: "FIZZL_PREFLIGHT_X402",
  similes: ["X402_PREFLIGHT", "SAFE_TO_PAY", "CHECK_BEFORE_PAYING", "PREPAYMENT_CHECK"],
  description:
    "Before paying an x402 / pay-per-call API you have not used before, ask x402 Doctor whether it is safe to pay: verdict GO, CAUTION or NO-GO, the recommended payment option (cheapest one that will settle, on your network if given) and the reasons (payment would fail, over budget, charges more than advertised, not HTTPS, unknown token). Never pays the endpoint itself. Paid per call via x402: $0.001 USDC on Solana or Base. Parameters: url, max_usd (budget, optional), network (CAIP-2 or solana/base, optional), method (GET|POST, optional).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return PAY_INTENT.test(text) && parsePreflightInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parsePreflightInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Send the URL of the x402 endpoint you want to pay (https://…), optionally with a budget like max $0.05.");

    const { client, urls } = await getContext(runtime);
    const result = await preflightX402(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not check ${input.url}: ${result.error}`);

    const text = `${formatPreflight(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_PREFLIGHT_X402"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { x402Verdict: result.data.verdict, x402SafeToPay: result.data.safe_to_pay },
      data: { preflight: result.data, input, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Is it safe to pay https://ichimoku-signal.onrender.com/signal/BTC-USDT? Max $0.05 on solana." } },
      { name: "{{agent}}", content: { text: "✅ GO https://ichimoku-signal.onrender.com/signal/BTC-USDT\nOK to pay: $0.02 on Solana.\nRecommended: $0.02 USDC on Solana → ATWJ…", actions: ["FIZZL_PREFLIGHT_X402"] } },
    ],
  ],
};
