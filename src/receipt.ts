// Signed verdicts: x402 Doctor and presign-guard sign every paid answer with a
// `receipt` (EIP-191 personal_sign over canonical JSON of the whole answer
// without receipt.signature; request id, route and a SHA-256 of the request
// input inside the signed body). The actions check it before an agent acts on
// a verdict: a changed, unsigned or foreign answer, or one for another
// request, is reported as untrusted instead of used.
//
// Canonical JSON (profile js-json-stringify-sorted-utf16-ascii-v1): keys
// sorted by UTF-16 code units at every level, no whitespace, every code unit
// from U+007F up as lowercase \uXXXX, numbers as JSON.stringify writes them,
// UTF-8 bytes. Python's json.dumps matches only for ASCII keys and integers; a
// Python equivalent: github.com/Fizzl13/presign-guard/blob/main/examples/canonical.py

import { createHash } from "node:crypto";
import { recoverMessageAddress, type Hex } from "viem";

// The published signers, pinned: a list fetched from the service it vouches for
// would not protect against that service being compromised.
export const SIGNERS = {
  doctor: ["0xAaE66eF9Ee234397df33901568c8FBc36d43277d"],
  presign: ["0xf084Ea47Ca4D99BB4De3ECB0332b316bE6521EaE"],
} as const;

export type SignedService = keyof typeof SIGNERS;

// The payout wallet (the payTo of every Fizzl payment) certifies signing keys:
// a key it authorised for the service is accepted too, so a rotated key keeps
// working without a plugin update. The certificate travels inside the receipt
// (receipt.cert) as a personal_sign over certMessage.
export const AUTHORITY = "0x6B0F4651eD42893ab58139938175E4a69f175F25";
export const SERVICE_NAMES: Record<SignedService, string> = { doctor: "x402-doctor", presign: "presign-guard" };

export function certMessage(c: { service: string; signer: string; valid_from: string }): string {
  return `fizzl receipt signer\nservice: ${c.service}\nsigner: ${c.signer}\nvalid_from: ${c.valid_from}`;
}

async function certified(r: Record<string, unknown>, recovered: string, authority: string, service: string): Promise<boolean> {
  const c = r.cert as { service?: string; signer?: string; valid_from?: string; authority?: string; signature?: string } | undefined;
  if (!c || c.service !== service || String(c.signer).toLowerCase() !== recovered.toLowerCase()) return false;
  if (String(c.authority).toLowerCase() !== authority.toLowerCase()) return false;
  if (!(String(r.signed_at).slice(0, 10) >= String(c.valid_from))) return false;
  try {
    const by = await recoverMessageAddress({ message: certMessage(c as { service: string; signer: string; valid_from: string }), signature: c.signature as Hex });
    return by.toLowerCase() === authority.toLowerCase();
  } catch {
    return false;
  }
}

export function canonicalJson(value: unknown): string {
  const ascii = (s: string) => JSON.stringify(s).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const walk = (v: unknown): string | undefined => {
    if (v === null || typeof v !== "object") return v === undefined ? undefined : typeof v === "string" ? ascii(v) : JSON.stringify(v);
    const maybe = v as { toJSON?: () => unknown };
    if (typeof maybe.toJSON === "function") return walk(maybe.toJSON());
    if (Array.isArray(v)) return `[${v.map((x) => walk(x) ?? "null").join(",")}]`;
    const obj = v as Record<string, unknown>;
    const parts = Object.keys(obj).sort().flatMap((k) => {
      const inner = walk(obj[k]);
      return inner === undefined ? [] : [`${ascii(k)}:${inner}`];
    });
    return `{${parts.join(",")}}`;
  };
  return walk(value) ?? "null";
}

export const inputHash = (route: string, input: unknown): string =>
  createHash("sha256").update(canonicalJson({ route, input: input ?? {} })).digest("hex");

export interface ReceiptCheck { valid: boolean; signer?: string; reason?: string }

/** Checks a signed answer: signed by one of `signers`, and (with route and input) for exactly that request. */
export async function verifyReceipt(body: unknown, { signers, route, input, authority = AUTHORITY, service }: { signers: readonly string[]; route?: string; input?: unknown; authority?: string | null; service?: string }): Promise<ReceiptCheck> {
  const b = body as { receipt?: Record<string, unknown> } | null;
  const r = b?.receipt;
  if (!r || typeof r.signature !== "string") return { valid: false, reason: "no signed receipt" };
  const { signature, ...rest } = r;
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: canonicalJson({ ...b, receipt: rest }), signature: signature as Hex });
  } catch {
    return { valid: false, reason: "the signature does not parse" };
  }
  if (recovered.toLowerCase() !== String(r.signer).toLowerCase()) return { valid: false, reason: "the signature does not match: the answer was changed" };
  const pinned = signers.some((s) => s.toLowerCase() === recovered.toLowerCase());
  if (!pinned && !(authority && service && (await certified(r, recovered, authority, service)))) return { valid: false, signer: recovered, reason: "signed by an unknown key" };
  if (route !== undefined && input !== undefined && inputHash(route, input) !== r.input_sha256) {
    return { valid: false, signer: recovered, reason: "signed for a different request" };
  }
  return { valid: true, signer: recovered };
}
