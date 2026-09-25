import type { Action, ActionResult } from "@elizaos/core";
import { getContext } from "../context.js";
import { parseScanInput, parseSignalInput } from "../parse.js";
import { getConfluenceSignal, getMarketScan, getPriceLevels, type ConfluenceSignal, type MarketScan, type PriceLevels } from "../services.js";
import { failure, paymentLine } from "./shared.js";

const fmt = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US", { maximumSignificantDigits: 8 }) : "?");

// --- Confluence: six indicators in one call ($0.10) ---

const CONFLUENCE_TRIGGER = /\b(confluence|indicators?|rsi|macd|bollinger|obv|ema\s*50|ema\s*200|golden cross|death cross|overbought|oversold|technical analysis|all signals)\b/i;
const NAMES: Record<keyof ConfluenceSignal["indicators"], string> = {
  ichimoku: "Ichimoku",
  rsi: "RSI",
  macd: "MACD",
  ema_cross: "EMA 50/200",
  bollinger: "Bollinger",
  volume: "Volume",
};

export function formatConfluence(s: ConfluenceSignal): string {
  const lines = (Object.keys(NAMES) as Array<keyof ConfluenceSignal["indicators"]>).map((key) => {
    const i = s.indicators[key];
    return `${NAMES[key]}: ${i.vote ? i.vote : `not counted (${i.reason ?? "no data"})`}`;
  });
  const rsi = s.indicators.rsi.value !== undefined ? ` · RSI ${fmt(s.indicators.rsi.value)} (${s.indicators.rsi.zone})` : "";
  return [`${s.pair} ${s.interval}: ${s.signal.toUpperCase()} (${s.confidence} confidence)`, `${s.summary}. Price ${fmt(s.price)}${rsi}.`, lines.join(" · ")].join("\n");
}

export const confluenceSignalAction: Action = {
  name: "FIZZL_CONFLUENCE_SIGNAL",
  similes: ["CONFLUENCE_SIGNAL", "TECHNICAL_ANALYSIS", "RSI_MACD", "ALL_INDICATORS", "TRADING_SIGNALS"],
  description:
    "Six indicators for a crypto pair in one call: Ichimoku, RSI (14), MACD (12/26/9), EMA 50/200, Bollinger Bands and volume (OBV), each with a bullish/bearish/neutral vote, plus a combined signal and confidence (\"4 of 6 indicators bullish\"). Top 200 coins. Paid per call via x402: $0.10 USDC on Solana or Base. Parameters: pair (e.g. SOL-USDT), interval (1m…1M, default 1h).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return CONFLUENCE_TRIGGER.test(text) && parseSignalInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parseSignalInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Which pair? For example: “all indicators for SOL-USDT on the 4h”.");
    const { client, urls } = await getContext(runtime);
    const result = await getConfluenceSignal(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not get the confluence signal for ${input.pair}: ${result.error}`);
    const text = `${formatConfluence(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_CONFLUENCE_SIGNAL"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { confluenceSignal: result.data.signal, confluenceConfidence: result.data.confidence, confluencePair: result.data.pair, confluenceInterval: result.data.interval },
      data: { confluence: result.data, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "What do RSI, MACD and the other indicators say for ETH/USDT on the 4h?" } },
      { name: "{{agent}}", content: { text: "ETH-USDT 4h: BULLISH (medium confidence)\n4 of 6 indicators bullish. Price 3,412 · RSI 61.2 (normal).\nIchimoku: bullish · RSI: bullish · MACD: bullish · EMA 50/200: bullish · Bollinger: bearish · Volume: neutral", actions: ["FIZZL_CONFLUENCE_SIGNAL"] } },
    ],
  ],
};

// --- Price levels: support/resistance and a long/short plan ($0.05) ---

const LEVELS_TRIGGER = /\b(support|resistance|price levels?|levels|targets?|take[- ]?profit|stop[- ]?loss|entry|pivots?|fibonacci|fib|where (?:to|should i) (?:buy|sell|enter|exit))\b/i;

export function formatLevels(l: PriceLevels): string {
  const bias = { long: "LONG bias", short: "SHORT bias", none: "NO CLEAR BIAS" }[l.bias] ?? l.bias;
  const plan = l.bias === "short" ? l.plans.short : l.plans.long;
  const which = l.bias === "short" ? "Short" : "Long";
  return [
    `${l.pair} ${l.interval}: ${bias} (${l.bias_from})`,
    `Price ${fmt(l.price)} · ATR ${fmt(l.atr)} (${fmt(l.atr_percent)}%)`,
    `Resistance: ${l.resistances.map((r) => fmt(r.price)).join(" · ") || "none nearby"}`,
    `Support: ${l.supports.map((r) => fmt(r.price)).join(" · ") || "none nearby"}`,
    `${which} plan: entry ${fmt(plan.entry)} · stop ${fmt(plan.stop)} · targets ${fmt(plan.target_1)} / ${fmt(plan.target_2)} (R/R ${fmt(plan.risk_reward_1)} / ${fmt(plan.risk_reward_2)})`,
    l.note,
  ].join("\n");
}

export const priceLevelsAction: Action = {
  name: "FIZZL_PRICE_LEVELS",
  similes: ["PRICE_LEVELS", "SUPPORT_RESISTANCE", "PRICE_TARGETS", "STOP_AND_TARGETS", "TRADE_PLAN"],
  description:
    "Price levels for a crypto pair: up to 3 supports and resistances (swing highs/lows and pivots), ATR, Fibonacci and Ichimoku levels, the bias from the 6-indicator confluence vote, and a long and a short plan (entry, stop, two targets, risk/reward). Top 200 coins. Levels from price history, not trade advice. Paid per call via x402: $0.05 USDC on Solana or Base. Parameters: pair (e.g. SOL-USDT), interval (1m…1M, default 1h).",
  validate: async (_runtime, message) => {
    const text = message.content?.text ?? "";
    return LEVELS_TRIGGER.test(text) && parseSignalInput(text) !== null;
  },
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parseSignalInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    if (!input) return failure(callback, "Which pair? For example: “support and resistance for BTC-USDT on the 4h”.");
    const { client, urls } = await getContext(runtime);
    const result = await getPriceLevels(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not get the price levels for ${input.pair}: ${result.error}`);
    const text = `${formatLevels(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_PRICE_LEVELS"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { levelsBias: result.data.bias, levelsPair: result.data.pair, levelsInterval: result.data.interval, levelsPrice: result.data.price },
      data: { levels: result.data, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Where are support and resistance for BTC-USDT on the 4h, and where would the stop go?" } },
      { name: "{{agent}}", content: { text: "BTC-USDT 4h: LONG bias (4 of 6 indicators bullish)\nPrice 84,244 · ATR 993 (1.18%)\nResistance: 84,404 · 84,979 · 85,385\nSupport: 83,901 · 83,470 · 82,891\nLong plan: entry 84,244 · stop 82,643 · targets 85,385 / 87,223 (R/R 0.71 / 1.86)\nLevels computed from price history, not trade advice or a prediction.", actions: ["FIZZL_PRICE_LEVELS"] } },
    ],
  ],
};

// --- Market scan: every top-200 coin in one call ($0.25) ---

const SCAN_TRIGGER = /\b(scan|screener|screen the market|market breadth|market overview|which coins|what coins|all coins|every coin|strongest coins|weakest coins|top movers)\b/i;

const coin = (c: MarketScan["coins"][number]) => `${c.pair.replace(/-USDT$/, "")} ${c.cloud_distance_percent > 0 ? "+" : ""}${fmt(c.cloud_distance_percent)}%`;

export function formatScan(s: MarketScan): string {
  const head = `Market scan ${s.interval}: ${s.breadth} (${s.summary.bullish} bullish · ${s.summary.neutral} neutral · ${s.summary.bearish} bearish)`;
  const lines = s.filter
    ? [`${s.filter[0].toUpperCase()}${s.filter.slice(1)} (${s.coins.length}): ${s.coins.slice(0, 10).map(coin).join(" · ") || "none"}`]
    : [`Strongest: ${s.coins.slice(0, 5).map(coin).join(" · ")}`, `Weakest: ${s.coins.slice(-5).reverse().map(coin).join(" · ")}`];
  return [head, ...lines, "% = price distance above (+) or below (−) the Ichimoku cloud. Not trade advice."].join("\n");
}

export const marketScanAction: Action = {
  name: "FIZZL_MARKET_SCAN",
  similes: ["MARKET_SCAN", "SCAN_MARKET", "CRYPTO_SCREENER", "MARKET_BREADTH", "WHICH_COINS_BULLISH"],
  description:
    "The Ichimoku Cloud signal for 148 top-200 coins (stablecoins excluded) in one call, sorted from strongest bullish to strongest bearish by the price's distance from the cloud, with market breadth (\"98 of 148 coins bullish\"). Paid per call via x402: $0.25 USDC on Solana or Base. Parameters: interval (1m…1M, default 1h), signal (optional filter: bullish, bearish or neutral).",
  validate: async (_runtime, message) => SCAN_TRIGGER.test(message.content?.text ?? ""),
  handler: async (runtime, message, _state, options, callback): Promise<ActionResult> => {
    const input = parseScanInput(message.content?.text ?? "", (options ?? {}) as Record<string, unknown>);
    const { client, urls } = await getContext(runtime);
    const result = await getMarketScan(client, urls, input);
    if (!result.ok || !result.data) return failure(callback, `Could not scan the market: ${result.error}`);
    const text = `${formatScan(result.data)}${paymentLine(result.payment)}`;
    await callback?.({ text, actions: ["FIZZL_MARKET_SCAN"], source: message.content?.source });
    return {
      success: true,
      text,
      values: { scanBreadth: result.data.breadth, scanInterval: result.data.interval, scanBullish: result.data.summary.bullish, scanBearish: result.data.summary.bearish },
      data: { scan: result.data, payment: result.payment },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Scan the market on the 1d: which coins are strongest?" } },
      { name: "{{agent}}", content: { text: "Market scan 1d: 104 of 144 coins bullish (104 bullish · 12 neutral · 28 bearish)\nStrongest: BP +29.99% · USELESS +28.59% · NEAR +28.52% · DRV +25.41% · RAY +24.13%\nWeakest: SPX -50.99% · KAG -17.52% · RAIN -13.34% · LEO -4.869% · ASTER -4.594%\n% = price distance above (+) or below (−) the Ichimoku cloud. Not trade advice.", actions: ["FIZZL_MARKET_SCAN"] } },
    ],
  ],
};
