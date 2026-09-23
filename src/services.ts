// Typed calls to each paid endpoint.

import type { FizzlClient, PaidResult } from "./client.js";
import type { DiagnoseInput, EvmChain, SignalInput, WalletInput } from "./parse.js";

export interface IchimokuSignal {
  pair: string;
  interval: string;
  timestamp: string;
  price: number;
  tenkan_sen: number;
  kijun_sen: number;
  senkou_span_a: number;
  senkou_span_b: number;
  cloud_position: "above_cloud" | "below_cloud" | "in_cloud";
  tenkan_kijun_cross: "bullish_cross" | "bearish_cross" | "flat";
  signal: "bullish" | "bearish" | "neutral";
}

export interface ApprovalVerdict {
  verdict: "SAFE" | "CAUTION" | "RISK";
  explanation: string;
  raw?: unknown[];
}

export interface DiagnosisCheck {
  id: string;
  group?: string;
  status: "pass" | "warn" | "fail" | "skip" | "info";
  message: string;
  hint?: string;
}

export interface Diagnosis {
  url: string;
  method: "GET" | "POST" | null;
  overall: "pass" | "warn" | "fail";
  checks: DiagnosisCheck[];
}

export interface ServiceUrls {
  ichimoku: string;
  plaintext: string;
  doctor: string;
}

export const DEFAULT_URLS: ServiceUrls = {
  ichimoku: "https://ichimoku-signal.onrender.com",
  plaintext: "https://smartcontractexplainer.onrender.com",
  doctor: "https://x402-doctor.onrender.com",
};

const trim = (url: string) => url.replace(/\/+$/, "");

export function getIchimokuSignal(client: FizzlClient, urls: ServiceUrls, input: SignalInput): Promise<PaidResult<IchimokuSignal>> {
  const query = new URLSearchParams({ interval: input.interval });
  return client.request<IchimokuSignal>(`${trim(urls.ichimoku)}/signal/${encodeURIComponent(input.pair)}?${query}`);
}

export function checkWalletApprovals(client: FizzlClient, urls: ServiceUrls, input: WalletInput): Promise<PaidResult<ApprovalVerdict>> {
  return client.request<ApprovalVerdict>(`${trim(urls.plaintext)}/api/check-wallet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: input.address, chain: input.chain as EvmChain, kind: input.kind }),
  });
}

export function explainApproval(client: FizzlClient, urls: ServiceUrls, data: Record<string, unknown>): Promise<PaidResult<ApprovalVerdict>> {
  return client.request<ApprovalVerdict>(`${trim(urls.plaintext)}/api/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data }),
  });
}

export function diagnoseX402(client: FizzlClient, urls: ServiceUrls, input: DiagnoseInput): Promise<PaidResult<Diagnosis>> {
  const query = new URLSearchParams({ url: input.url, ...(input.method ? { method: input.method } : {}) });
  return client.request<Diagnosis>(`${trim(urls.doctor)}/api/v1/diagnose?${query}`);
}
