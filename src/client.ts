// Pays Fizzl's x402 endpoints. One x402 client with whichever wallets are
// configured: Solana (SVM_PRIVATE_KEY) and/or Base (EVM_PRIVATE_KEY). When a
// service accepts both, Solana is preferred. Every payment is capped by
// FIZZL_MAX_PAYMENT_USD.

import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import type { PaymentRequirements } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const BASE_MAINNET = "eip155:8453";

export interface FizzlClientConfig {
  svmPrivateKey?: string;
  evmPrivateKey?: string;
  maxPaymentUsd?: string;
  solanaRpcUrl?: string;
  fetchFn?: typeof fetch;
}

export interface PaidResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** Settlement transaction and network, when the payment went through. */
  payment?: { network: string; transaction: string; explorer?: string };
}

function explorerUrl(network: string, tx: string): string | undefined {
  if (network === SOLANA_MAINNET) return `https://solscan.io/tx/${tx}`;
  if (network === BASE_MAINNET) return `https://basescan.org/tx/${tx}`;
  return undefined;
}

function parseSvmKey(value: string): Uint8Array {
  const trimmed = value.trim();
  const bytes = trimmed.startsWith("[") ? Uint8Array.from(JSON.parse(trimmed)) : getBase58Encoder().encode(trimmed);
  if (bytes.length !== 64) throw new Error(`SVM_PRIVATE_KEY must be a 64-byte keypair, got ${bytes.length} bytes`);
  return new Uint8Array(bytes);
}

export class FizzlClient {
  readonly wallets: { solana?: string; base?: string } = {};
  private readonly fetchWithPayment: typeof fetch | null;

  private constructor(fetchWithPayment: typeof fetch | null, wallets: { solana?: string; base?: string }) {
    this.fetchWithPayment = fetchWithPayment;
    this.wallets = wallets;
  }

  static async create(config: FizzlClientConfig): Promise<FizzlClient> {
    const baseFetch = config.fetchFn ?? globalThis.fetch;
    const wallets: { solana?: string; base?: string } = {};
    const networks: string[] = [];

    // Prefer Solana when a service offers both networks and we can pay both.
    const selector = (_version: number, requirements: PaymentRequirements[]) =>
      requirements.find((r) => r.network === SOLANA_MAINNET && networks.includes(SOLANA_MAINNET)) ??
      requirements.find((r) => networks.includes(r.network)) ??
      requirements[0];

    const client = new x402Client(selector);
    if (config.svmPrivateKey) {
      const signer = await createKeyPairSignerFromBytes(parseSvmKey(config.svmPrivateKey));
      client.register(SOLANA_MAINNET, new ExactSvmScheme(signer, config.solanaRpcUrl ? { rpcUrl: config.solanaRpcUrl } : undefined));
      wallets.solana = signer.address;
      networks.push(SOLANA_MAINNET);
    }
    if (config.evmPrivateKey) {
      const key = config.evmPrivateKey.trim();
      const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
      client.register(BASE_MAINNET, new ExactEvmScheme(account));
      wallets.base = account.address;
      networks.push(BASE_MAINNET);
    }
    if (networks.length === 0) return new FizzlClient(null, wallets);

    const cap = Number(config.maxPaymentUsd ?? "0.25");
    client.setSpendControls({ maxAmountPerPayment: `$${Number.isFinite(cap) && cap > 0 ? cap : 0.25}` });
    return new FizzlClient(wrapFetchWithPayment(baseFetch, client), wallets);
  }

  get canPay(): boolean {
    return this.fetchWithPayment !== null;
  }

  async request<T>(url: string, init: RequestInit = {}): Promise<PaidResult<T>> {
    if (!this.fetchWithPayment) {
      return { ok: false, status: 0, error: "No wallet configured. Set SVM_PRIVATE_KEY (Solana) and/or EVM_PRIVATE_KEY (Base) to pay in USDC." };
    }
    let res: Response;
    try {
      res = await this.fetchWithPayment(url, init);
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
    }

    let payment: PaidResult<T>["payment"];
    const header = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
    if (header) {
      try {
        const settlement = decodePaymentResponseHeader(header);
        if (settlement.success && settlement.transaction) {
          payment = { network: settlement.network, transaction: settlement.transaction, explorer: explorerUrl(settlement.network, settlement.transaction) };
        }
      } catch {
        // no settlement details
      }
    }

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      // keep the raw text
    }

    if (res.ok) return { ok: true, status: res.status, data: body as T, payment };

    let error = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : text.slice(0, 200);
    if (res.status === 402) {
      try {
        const challenge = JSON.parse(Buffer.from(res.headers.get("PAYMENT-REQUIRED") ?? "", "base64").toString("utf8"));
        if (challenge.error) error = `payment rejected: ${challenge.error}`;
      } catch {
        // keep the body error
      }
    }
    return { ok: false, status: res.status, error: error || `HTTP ${res.status}` };
  }
}
