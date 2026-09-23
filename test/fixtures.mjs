// Fixture x402 services shaped like the real ones, a mock Solana RPC and a
// fake ElizaOS runtime. The fixture verifies payments like a facilitator
// would: the payer's Ed25519 signature on the Solana transaction, and the
// EIP-3009 TransferWithAuthorization signature on Base.

import http from "node:http";
import * as kit from "@solana/kit";
import { verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const BASE = "eip155:8453";
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const servers = [];
export function closeAll() {
  for (const s of servers) s.close();
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = http
      .createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        await handler(req, res, body);
      })
      .listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
    servers.push(server);
  });
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

export async function newSolanaKey() {
  const signer = await kit.generateKeyPairSigner(true);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", signer.keyPair.privateKey));
  const secret = new Uint8Array(64);
  secret.set(pkcs8.slice(-32), 0);
  secret.set(kit.getAddressEncoder().encode(signer.address), 32);
  return { address: signer.address, secret: kit.getBase58Decoder().decode(secret) };
}

export function newEvmKey() {
  const key = generatePrivateKey();
  return { address: privateKeyToAccount(key).address, secret: key };
}

async function verifySolanaPayment(payload) {
  const tx = kit.getTransactionDecoder().decode(kit.getBase64Encoder().encode(payload.payload.transaction));
  const msg = kit.getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const signers = msg.staticAccounts.slice(0, msg.header.numSignerAccounts);
  for (const address of signers) {
    const sig = tx.signatures[address];
    if (!sig) continue; // the fee payer (facilitator) signs later
    const key = await crypto.subtle.importKey("raw", kit.getAddressEncoder().encode(address), { name: "Ed25519" }, false, ["verify"]);
    if (!(await crypto.subtle.verify("Ed25519", key, sig, tx.messageBytes))) return { ok: false };
    return { ok: true, payer: address };
  }
  return { ok: false };
}

async function verifyEvmPayment(payload, requirements) {
  const { authorization, signature } = payload.payload;
  const ok = await verifyTypedData({
    address: authorization.from,
    domain: { name: requirements.extra.name, version: requirements.extra.version, chainId: 8453, verifyingContract: requirements.asset },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
    signature,
  });
  const matches = ok && authorization.to.toLowerCase() === requirements.payTo.toLowerCase() && BigInt(authorization.value) >= BigInt(requirements.amount);
  return { ok: matches, payer: authorization.from };
}

// A paid route: 402 with the challenge, or verify the payment and answer.
function paidRoute({ accepts, resourceUrl, respond, state }) {
  return async (req, res, body) => {
    const header = req.headers["payment-signature"];
    const challenge = { x402Version: 2, error: "Payment required", resource: { url: resourceUrl(req), mimeType: "application/json" }, accepts };
    if (!header) {
      res.statusCode = 402;
      res.setHeader("PAYMENT-REQUIRED", b64(challenge));
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ x402Version: 2, accepts }));
    }
    const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const requirements = accepts.find((a) => a.network === payload.accepted.network);
    const verdict = payload.accepted.network === SOLANA ? await verifySolanaPayment(payload) : await verifyEvmPayment(payload, requirements);
    state.payments.push({ network: payload.accepted.network, valid: verdict.ok, payer: verdict.payer, path: req.url });
    if (!verdict.ok || state.reject) {
      res.statusCode = 402;
      res.setHeader("PAYMENT-REQUIRED", b64({ ...challenge, error: state.reject || "invalid_signature" }));
      return res.end("{}");
    }
    const tx = payload.accepted.network === SOLANA ? "5SolanaSettlementTx" : "0xbasesettlementtx";
    res.setHeader("PAYMENT-RESPONSE", b64({ success: true, transaction: tx, network: payload.accepted.network, payer: verdict.payer }));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(respond(req, body ? JSON.parse(body) : null)));
  };
}

export async function startFixtures() {
  const state = { payments: [], reject: null };
  const solanaPayTo = (await kit.generateKeyPairSigner()).address;
  const solanaFeePayer = (await kit.generateKeyPairSigner()).address;
  const basePayTo = newEvmKey().address;

  const rpc = await listen((_req, res, body) => {
    const call = JSON.parse(body);
    const result = (value) => res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: value }));
    res.setHeader("content-type", "application/json");
    if (call.method === "getLatestBlockhash") return result({ context: { slot: 1 }, value: { blockhash: "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZAMdL4VZHirAn", lastValidBlockHeight: 1000 } });
    if (call.method === "getAccountInfo") {
      const mint = new Uint8Array(82);
      mint[44] = 6;
      mint[45] = 1;
      return result({ context: { slot: 1 }, value: { data: [Buffer.from(mint).toString("base64"), "base64"], executable: false, lamports: 1, owner: TOKEN_PROGRAM, rentEpoch: 0, space: 82 } });
    }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: -32601, message: call.method } }));
  });

  const solanaOption = (amount) => ({ scheme: "exact", network: SOLANA, amount, asset: USDC_SOLANA, payTo: solanaPayTo, maxTimeoutSeconds: 300, extra: { feePayer: solanaFeePayer } });
  const baseOption = (amount) => ({ scheme: "exact", network: BASE, amount, asset: USDC_BASE, payTo: basePayTo, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } });

  let ichimokuUrl;
  const ichimokuPrice = { amount: "20000" };
  ichimokuUrl = await listen(async (req, res, body) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/signal/")) {
      res.statusCode = 404;
      return res.end("{}");
    }
    return paidRoute({
      // Base first, like the live service; the plugin should still pick Solana when it can.
      accepts: [baseOption(ichimokuPrice.amount), solanaOption(ichimokuPrice.amount)],
      resourceUrl: (r) => `${ichimokuUrl}${r.url}`,
      state,
      respond: () => ({
        pair: decodeURIComponent(url.pathname.split("/")[2]).toUpperCase(),
        interval: url.searchParams.get("interval") || "1h",
        timestamp: "2026-09-22T22:00:00.000Z",
        price: 159,
        tenkan_sen: 155,
        kijun_sen: 146.5,
        senkou_span_a: 150.75,
        senkou_span_b: 133.5,
        cloud_position: "above_cloud",
        tenkan_kijun_cross: "bullish_cross",
        signal: "bullish",
      }),
    })(req, res, body);
  });

  let plaintextUrl;
  plaintextUrl = await listen(async (req, res, body) => {
    const routes = {
      "/api/check-wallet": { amount: "100000", respond: (_r, input) => ({ verdict: "CAUTION", explanation: `Unlimited USDC approval on ${input.chain} (${input.kind}).`, raw: [] }) },
      "/api/explain": { amount: "50000", respond: (_r, input) => ({ verdict: input.data.amount === "unlimited" ? "RISK" : "SAFE", explanation: "The spender can move your tokens." }) },
    };
    const route = routes[req.url];
    if (!route || req.method !== "POST") {
      res.statusCode = 404;
      return res.end("{}");
    }
    return paidRoute({ accepts: [baseOption(route.amount)], resourceUrl: (r) => `${plaintextUrl}${r.url}`, state, respond: route.respond })(req, res, body);
  });

  return { state, rpc, ichimokuUrl, plaintextUrl, ichimokuPrice };
}

// Minimal stand-in for an ElizaOS IAgentRuntime: settings only.
export function fakeRuntime(settings) {
  return { agentId: `agent-${Math.random()}`, getSetting: (key) => settings[key] };
}

export function message(text) {
  return { id: "m1", entityId: "u1", roomId: "r1", content: { text, source: "test" } };
}
