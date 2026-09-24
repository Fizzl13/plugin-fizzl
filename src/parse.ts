// Turns a chat message into the input each paid endpoint needs. Explicit
// handler options (from the LLM's action parameters) win over what is parsed
// from the text.

export const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"] as const;
const QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH", "BNB"];
const EVM_CHAINS = ["ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche"] as const;
export type EvmChain = (typeof EVM_CHAINS)[number];

const CHAIN_ALIASES: Record<string, EvmChain> = {
  ethereum: "ethereum", eth: "ethereum", mainnet: "ethereum",
  bsc: "bsc", bnb: "bsc", "binance smart chain": "bsc",
  polygon: "polygon", matic: "polygon",
  arbitrum: "arbitrum", arb: "arbitrum",
  optimism: "optimism", op: "optimism",
  base: "base",
  avalanche: "avalanche", avax: "avalanche",
};

// Words that look like tickers but are not.
const NOT_TICKERS = new Set(["THE", "FOR", "AND", "ON", "IN", "OF", "IS", "WHAT", "GET", "SHOW", "ME", "A", "AN", "CLOUD", "SIGNAL", "ICHIMOKU", "CHART", "PRICE", "TREND", "NOW", "TODAY", "PAIR", "CHECK", "GIVE", "HOW", "LOOKS", "LOOK", "BULLISH", "BEARISH"]);

export interface SignalInput { pair: string; interval: string }

// "ichimoku for SOL/USDT on the 4h" → { pair: "SOL-USDT", interval: "4h" }
// "is BTC above the cloud?"        → { pair: "BTC-USDT", interval: "1h" }
export function parseSignalInput(text: string, options: Record<string, unknown> = {}): SignalInput | null {
  const interval = typeof options.interval === "string" && (INTERVALS as readonly string[]).includes(options.interval)
    ? options.interval
    : parseInterval(text) ?? "1h";

  if (typeof options.pair === "string" && /^[A-Za-z0-9]{2,12}-?[A-Za-z0-9]{2,12}$/.test(options.pair)) {
    return { pair: options.pair.toUpperCase(), interval };
  }

  const quoted = new RegExp(`\\b([A-Za-z0-9]{2,10})\\s*[-/]?\\s*(${QUOTES.join("|")})\\b`, "i").exec(text);
  if (quoted && !NOT_TICKERS.has(quoted[1].toUpperCase())) {
    return { pair: `${quoted[1].toUpperCase()}-${quoted[2].toUpperCase()}`, interval };
  }

  // A bare ticker: $SOL, SOL, sol. Prefer $-prefixed, then all-caps words.
  const dollar = /\$([A-Za-z][A-Za-z0-9]{1,9})\b/.exec(text);
  if (dollar) return { pair: `${dollar[1].toUpperCase()}-USDT`, interval };
  const caps = text.match(/\b[A-Z][A-Z0-9]{1,9}\b/g)?.find((w) => !NOT_TICKERS.has(w) && !(INTERVALS as readonly string[]).includes(w));
  if (caps) return { pair: `${caps}-USDT`, interval };
  return null;
}

function parseInterval(text: string): string | null {
  // "1M" is a month and case-sensitive; everything else is matched loosely.
  const exact = /\b(1M)\b/.exec(text);
  if (exact) return "1M";
  const m = /\b(1|3|5|15|30)\s*(?:m|min|mins|minute|minutes)\b|\b(1|2|4|6|8|12)\s*(?:h|hr|hrs|hour|hours)\b|\b(1|3)\s*(?:d|day|days)\b|\b1\s*(?:w|wk|week)\b/i.exec(text);
  if (m) {
    if (m[1]) return `${m[1]}m`;
    if (m[2]) return `${m[2]}h`;
    if (m[3]) return `${m[3]}d`;
    return "1w";
  }
  if (/\bdaily\b/i.test(text)) return "1d";
  if (/\bweekly\b/i.test(text)) return "1w";
  if (/\bhourly\b/i.test(text)) return "1h";
  return null;
}

export interface WalletInput { address: string; chain: EvmChain; kind: "token" | "nft" }

export function parseWalletInput(text: string, options: Record<string, unknown> = {}): WalletInput | null {
  const address = typeof options.address === "string" ? options.address : /\b0x[a-fA-F0-9]{40}\b/.exec(text)?.[0];
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
  let chain: EvmChain = "ethereum";
  if (typeof options.chain === "string" && (EVM_CHAINS as readonly string[]).includes(options.chain)) {
    chain = options.chain as EvmChain;
  } else {
    const lower = text.toLowerCase();
    for (const [alias, value] of Object.entries(CHAIN_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`).test(lower)) {
        chain = value;
        break;
      }
    }
  }
  const kind = options.kind === "nft" || /\bnfts?\b/i.test(text) ? "nft" : "token";
  return { address, chain, kind };
}

// The first JSON object in the message: a ```json block or a bare {...}.
export function parseApprovalPayload(text: string, options: Record<string, unknown> = {}): Record<string, unknown> | null {
  if (options.data && typeof options.data === "object" && !Array.isArray(options.data)) return options.data as Record<string, unknown>;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidates = [fenced, text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export interface DiagnoseInput { url: string; method?: "GET" | "POST" }

// The first public http(s) URL in the message; POST only when asked for.
export function parseDiagnoseInput(text: string, options: Record<string, unknown> = {}): DiagnoseInput | null {
  const raw = typeof options.url === "string" ? options.url : /\bhttps?:\/\/[^\s<>"'`)\]]+/i.exec(text)?.[0];
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.replace(/[.,;:!?]+$/, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const opt = typeof options.method === "string" ? options.method.toUpperCase() : undefined;
  const method = opt === "GET" || opt === "POST" ? opt : /\bPOST\b/.test(text) ? "POST" : undefined;
  return method ? { url: url.href, method } : { url: url.href };
}

export interface PreflightInput { url: string; method?: "GET" | "POST"; maxUsd?: number; network?: string }

const NETWORK_WORDS: Array<[RegExp, string]> = [
  [/\bsolana\b/i, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  [/\bbase\b/i, "eip155:8453"],
];

// "is it safe to pay https://x.y/paid, max $0.05 on solana?" →
// { url, maxUsd: 0.05, network: "solana:5eykt…" }. The budget is the first
// dollar amount (or one after "max"/"budget"/"up to"); the network is named.
export function parsePreflightInput(text: string, options: Record<string, unknown> = {}): PreflightInput | null {
  const base = parseDiagnoseInput(text, options);
  if (!base) return null;
  const input: PreflightInput = { ...base };
  const withoutUrl = text.replace(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi, " ");
  const optMax = options.max_usd ?? options.maxUsd;
  const budget = optMax !== undefined
    ? Number(optMax)
    : Number((/(?:max(?:imum)?|budget|up to|at most|no more than)\s*(?:of\s*)?\$?\s*(\d+(?:\.\d+)?)/i.exec(withoutUrl) ?? /\$\s*(\d+(?:\.\d+)?)/.exec(withoutUrl))?.[1]);
  if (Number.isFinite(budget) && budget > 0) input.maxUsd = budget;
  const optNetwork = typeof options.network === "string" ? options.network : undefined;
  const network = optNetwork ?? NETWORK_WORDS.find(([re]) => re.test(withoutUrl))?.[1];
  if (network) input.network = network;
  return input;
}

export interface PresignInput {
  /** The presign-guard request: { type: "approval" | "transaction" | "signature", chainId, … }. */
  request: Record<string, unknown>;
  explain: boolean;
  lang: "en" | "nl";
}

const CHAIN_IDS: Partial<Record<EvmChain, number>> = { ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, optimism: 10, base: 8453 };

function chainIdFrom(text: string, value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(value.trim())) return Number(value.trim());
  const lower = text.toLowerCase();
  for (const [alias, chain] of Object.entries(CHAIN_ALIASES)) {
    if (CHAIN_IDS[chain] && new RegExp(`\\b${alias}\\b`).test(lower)) return CHAIN_IDS[chain]!;
  }
  return 8453;
}

// What the agent is about to sign, as a presign-guard request. Accepts:
// a ready request ({ type, chainId, … }), an eth_signTypedData_v4 payload
// ({ domain, primaryType, message }) or a transaction ({ to, data, value? }).
export function parsePresignInput(text: string, options: Record<string, unknown> = {}): PresignInput | null {
  const given = options.request ?? options.typedData ?? options.transaction;
  const payload = given && typeof given === "object" && !Array.isArray(given)
    ? (given as Record<string, unknown>)
    : parseApprovalPayload(text, options);
  if (!payload) return null;

  let request: Record<string, unknown> | null = null;
  if (payload.type === "approval" || payload.type === "transaction" || payload.type === "signature") {
    request = { ...payload, chainId: chainIdFrom(text, payload.chainId) };
  } else if (typeof payload.primaryType === "string" && payload.domain && typeof payload.domain === "object" && payload.message && typeof payload.message === "object") {
    request = { type: "signature", chainId: chainIdFrom(text, (payload.domain as Record<string, unknown>).chainId), typedData: payload };
  } else if (typeof payload.to === "string" && /^0x[a-fA-F0-9]{40}$/.test(payload.to) && (typeof payload.data === "string" || payload.value !== undefined)) {
    request = {
      type: "transaction",
      chainId: chainIdFrom(text, payload.chainId),
      to: payload.to,
      data: typeof payload.data === "string" ? payload.data : "0x",
      ...(payload.value !== undefined ? { value: String(payload.value) } : {}),
    };
  }
  if (!request) return null;

  const explain = options.explain === true || /\b(explain|in plain|plain language|uitleg)\b/i.test(text);
  const lang = options.lang === "nl" || /\b(dutch|nederlands|in het nederlands)\b/i.test(text) ? "nl" : "en";
  return { request, explain, lang };
}
