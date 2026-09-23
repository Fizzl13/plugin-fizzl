import type { Action, ActionResult } from "@elizaos/core";
import { getContext } from "../context.js";
import { parseSignalInput } from "../parse.js";
import { getIchimokuSignal, type IchimokuSignal } from "../services.js";
import { failure, paymentLine } from "./shared.js";

const TRIGGER = /\b(ichimoku|kumo|tenkan|kijun|senkou|above the cloud|below the cloud|in the cloud|cloud signal)\b/i;

const CLOUD = { above_cloud: "above the cloud", below_cloud: "below the cloud", in_cloud: "inside the cloud" } as const;
const CROSS = { bullish_cross: "tenkan above kijun (bullish cross)", bearish_cross: "tenkan below kijun (bearish cross)", flat: "tenkan equal to kijun" } as const;

export function formatSignal(s: IchimokuSignal): string {
  const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumSignificantDigits: 8 }) : "?");
  return [
    `${s.pair} ${s.interval}: ${s.signal.toUpperCase()}`,
    `Price ${fmt(s.price)} is ${CLOUD[s.cloud_position] ?? s.cloud_position}; ${CROSS[s.tenkan_kijun_cross] ?? s.tenkan_kijun_cross}.`,
    `Tenkan ${fmt(s.tenkan_sen)} · Kijun ${fmt(s.kijun_sen)} · Span A ${fmt(s.senkou_span_a)} · Span B ${fmt(s.senkou_span_b)}`,
  ].join("\n");
}

export const ichimokuSignalAction: Action = {
  name: "FIZZL_ICHIMOKU_SIGNAL",
  similes: ["ICHIMOKU_SIGNAL", "ICHIMOKU_CLOUD", "GET_ICHIMOKU", "CLOUD_SIGNAL"],
  description:
    "Get a live Ichimoku Cloud signal (bullish/bearish/neutral, cloud position, tenkan/kijun cross and all line values) for a crypto pair on Binance.US candles. Paid per call via x402: $0.02 USDC on Solana or Base. Parameters: pair (e.g. SOL-USDT), interval (1m…1M, default 1h).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return TRIGGER.test(text) && parseSignalInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parseSignalInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Which pair? For example: “Ichimoku for SOL-USDT on the 4h”.");

    const { client, urls } = await getContext(runtime);
    const result = await getIchimokuSignal(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not get the Ichimoku signal for ${input.pair}: ${result.error}`);

    const text = `${formatSignal(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_ICHIMOKU_SIGNAL"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { ichimokuSignal: result.data.signal, ichimokuPair: result.data.pair, ichimokuInterval: result.data.interval },
      data: { signal: result.data, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "What does the Ichimoku cloud say for SOL/USDT on the 4h?" } },
      { name: "{{agent}}", content: { text: "SOL-USDT 4h: BULLISH\nPrice 158.2 is above the cloud; tenkan above kijun (bullish cross).", actions: ["FIZZL_ICHIMOKU_SIGNAL"] } },
    ],
    [
      { name: "{{user}}", content: { text: "Is BTC above the cloud on the daily?" } },
      { name: "{{agent}}", content: { text: "BTC-USDT 1d: NEUTRAL\nPrice 64,210 is above the cloud; tenkan below kijun (bearish cross).", actions: ["FIZZL_ICHIMOKU_SIGNAL"] } },
    ],
  ],
};
