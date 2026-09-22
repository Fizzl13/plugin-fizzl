// Per-agent state: one paying client per runtime, so several agents in one
// process each use their own wallets and settings.

import type { IAgentRuntime } from "@elizaos/core";
import { FizzlClient } from "./client.js";
import { DEFAULT_URLS, type ServiceUrls } from "./services.js";

export interface FizzlContext {
  client: FizzlClient;
  urls: ServiceUrls;
}

const contexts = new WeakMap<IAgentRuntime, Promise<FizzlContext>>();

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
        },
      };
    })();
    contexts.set(runtime, ctx);
    ctx.catch(() => contexts.delete(runtime)); // retry setup on the next call
  }
  return ctx;
}
