import type { Action, ActionResult } from "@elizaos/core";
import { getContext } from "../context.js";
import { parseDiagnoseInput } from "../parse.js";
import { diagnoseX402, type Diagnosis } from "../services.js";
import { failure, paymentLine } from "./shared.js";

const TRIGGER = /\b(x402|402|paywall|payment[- ]required|paid (?:api|endpoint))\b/i;
const ASK = /\b(diagnos\w*|check\w*|debug\w*|test\w*|broken|work(?:s|ing)?|why|fix|doctor|validat\w*|audit\w*)\b/i;
const ICON = { pass: "✅", warn: "⚠️", fail: "⛔", skip: "·", info: "ℹ️" } as const;

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
    return TRIGGER.test(text) && ASK.test(text) && parseDiagnoseInput(text) !== null;
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
