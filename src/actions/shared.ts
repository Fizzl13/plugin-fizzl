import type { ActionResult, HandlerCallback } from "@elizaos/core";
import type { PaidResult } from "../client.js";
import type { FizzlContext } from "../context.js";
import { verifyReceipt, SERVICE_NAMES, type SignedService } from "../receipt.js";

export async function failure(callback: HandlerCallback | undefined, message: string): Promise<ActionResult> {
  await callback?.({ text: message });
  return { success: false, text: message, error: message };
}

export function paymentLine(payment: PaidResult<unknown>["payment"]): string {
  if (!payment) return "";
  return `\nPaid via x402${payment.explorer ? `: ${payment.explorer}` : ` (tx ${payment.transaction})`}`;
}

// Checks the signed receipt on a Doctor or presign-guard answer (receipt.ts).
// ok = trusted (or checks off); line = what to show; reason = why not trusted.
export async function receiptCheck(ctx: FizzlContext, service: SignedService, result: PaidResult<unknown>): Promise<{ ok: boolean; line: string; reason?: string }> {
  if (ctx.receipts.mode === "off") return { ok: true, line: "" };
  const check = await verifyReceipt(result.data, { signers: ctx.receipts[service], route: result.request?.route, input: result.request?.input, authority: ctx.receipts.authority, service: SERVICE_NAMES[service] });
  const name = service === "doctor" ? "x402 Doctor" : "presign-guard";
  if (!check.valid) return { ok: false, line: "", reason: `the answer is not provably from ${name} (${check.reason})` };
  const id = (result.data as { receipt?: { request_id?: string } }).receipt?.request_id;
  return { ok: true, line: `\nSigned by ${name} ✓${id ? ` (receipt ${id.slice(0, 8)})` : ""}` };
}
