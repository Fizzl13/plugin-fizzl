// Typed calls to each paid endpoint.

import type { FizzlClient, PaidResult } from "./client.js";
import type { DiagnoseInput, EvmChain, PreflightInput, PresignInput, SignalInput, WalletInput } from "./parse.js";

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

export interface PreflightOption {
  index: number;
  network: string | null;
  network_name: string | null;
  asset_symbol: string | null;
  amount: string | null;
  usd: number | null;
  pay_to: string | null;
  payable: boolean;
  problems: string[];
}

export interface Preflight {
  url: string;
  verdict: "go" | "caution" | "no_go";
  safe_to_pay: boolean;
  summary: string;
  recommended_option: number | null;
  options: PreflightOption[];
  reasons: Array<{ level: "no_go" | "caution" | "info"; code: string; message: string }>;
  cached?: boolean;
}

export interface PresignReason {
  code: string;
  severity: "red" | "orange" | "info";
  subject?: string;
  details?: unknown;
}

export interface PresignVerdict {
  verdict: "green" | "orange" | "red";
  reasons: PresignReason[];
  subject?: Record<string, unknown>;
  explanation?: { lang: string; text: string };
}

export interface ServiceUrls {
  ichimoku: string;
  plaintext: string;
  doctor: string;
  presign: string;
}

export const DEFAULT_URLS: ServiceUrls = {
  ichimoku: "https://ichimoku-signal.onrender.com",
  plaintext: "https://smartcontractexplainer.onrender.com",
  doctor: "https://x402-doctor.onrender.com",
  presign: "https://presign-guard.onrender.com",
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

export function preflightX402(client: FizzlClient, urls: ServiceUrls, input: PreflightInput): Promise<PaidResult<Preflight>> {
  const query = new URLSearchParams({ url: input.url });
  if (input.method) query.set("method", input.method);
  if (input.maxUsd !== undefined) query.set("max_usd", String(input.maxUsd));
  if (input.network) query.set("network", input.network);
  return client.request<Preflight>(`${trim(urls.doctor)}/api/v1/preflight?${query}`);
}

export function presignCheck(client: FizzlClient, urls: ServiceUrls, input: PresignInput): Promise<PaidResult<PresignVerdict>> {
  const path = input.explain ? "/v1/check/explain" : "/v1/check";
  const body = input.explain ? { ...input.request, lang: input.lang } : input.request;
  return client.request<PresignVerdict>(`${trim(urls.presign)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
