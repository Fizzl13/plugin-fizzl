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
