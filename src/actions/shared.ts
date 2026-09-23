import type { ActionResult, HandlerCallback } from "@elizaos/core";
import type { PaidResult } from "../client.js";

export async function failure(callback: HandlerCallback | undefined, message: string): Promise<ActionResult> {
  await callback?.({ text: message });
  return { success: false, text: message, error: message };
}

export function paymentLine(payment: PaidResult<unknown>["payment"]): string {
  if (!payment) return "";
  return `\nPaid via x402${payment.explorer ? `: ${payment.explorer}` : ` (tx ${payment.transaction})`}`;
}
