// Per-agent state: one paying client per runtime, so several agents in one
// process each use their own wallets and settings.

import type { IAgentRuntime } from "@elizaos/core";
import { FizzlClient } from "./client.js";
import { DEFAULT_URLS, type ServiceUrls } from "./services.js";
import { SIGNERS, AUTHORITY } from "./receipt.js";

export interface FizzlContext {
  client: FizzlClient;
  urls: ServiceUrls;
  /** Signed-verdict checks: "require" (default) or "off", and the accepted signers per service. */
  receipts: { mode: "require" | "off"; doctor: string[]; presign: string[]; authority: string | null };
}

const contexts = new WeakMap<IAgentRuntime, Promise<FizzlContext>>();

const list = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

function setting(runtime: IAgentRuntime, key: string): string | undefined {
  const value = runtime.getSetting?.(key);
  return value === undefined || value === null || value === "" ? undefined : String(value);
}

export function getContext(runtime: IAgentRuntime): Promise<FizzlContext> {
  let ctx = contexts.get(runtime);
  if (!ctx) {
    ctx = (async () => {
      const client = await FizzlClient.create({
        svmPrivateKey: setting(runtime, "SVM_PRIVATE_KEY"),
        evmPrivateKey: setting(runtime, "EVM_PRIVATE_KEY"),
        maxPaymentUsd: setting(runtime, "FIZZL_MAX_PAYMENT_USD"),
        solanaRpcUrl: setting(runtime, "SOLANA_RPC_URL"),
      });
      return {
        client,
        urls: {
          ichimoku: setting(runtime, "ICHIMOKU_SIGNAL_URL") ?? DEFAULT_URLS.ichimoku,
          plaintext: setting(runtime, "PLAINTEXT_URL") ?? DEFAULT_URLS.plaintext,
          doctor: setting(runtime, "X402_DOCTOR_URL") ?? DEFAULT_URLS.doctor,
          presign: setting(runtime, "PRESIGN_GUARD_URL") ?? DEFAULT_URLS.presign,
        },
        receipts: {
          mode: setting(runtime, "FIZZL_VERIFY_RECEIPTS") === "off" ? "off" : "require",
          doctor: list(setting(runtime, "FIZZL_DOCTOR_SIGNERS")) ?? [...SIGNERS.doctor],
          presign: list(setting(runtime, "FIZZL_PRESIGN_SIGNERS")) ?? [...SIGNERS.presign],
          authority: setting(runtime, "FIZZL_RECEIPT_AUTHORITY") === "none" ? null : setting(runtime, "FIZZL_RECEIPT_AUTHORITY") ?? AUTHORITY,
        },
      };
    })();
    contexts.set(runtime, ctx);
    ctx.catch(() => contexts.delete(runtime)); // retry setup on the next call
  }
  return ctx;
}
