import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSignalInput, parseWalletInput, parseApprovalPayload, parseDiagnoseInput } from "../dist/parse.js";

test("parseSignalInput: pairs, bare tickers and intervals", () => {
  const cases = [
    ["ichimoku for SOL/USDT on the 4h", { pair: "SOL-USDT", interval: "4h" }],
    ["What's the cloud on btcusdt 15 min?", { pair: "BTC-USDT", interval: "15m" }],
    ["Is ETH above the cloud on the daily?", { pair: "ETH-USDT", interval: "1d" }],
    ["ichimoku $jup weekly", { pair: "JUP-USDT", interval: "1w" }],
    ["ichimoku SOL-USDC 1M", { pair: "SOL-USDC", interval: "1M" }],
    ["ichimoku SOL-USDC 1m", { pair: "SOL-USDC", interval: "1m" }],
    ["ETH/BTC ichimoku 2 hours", { pair: "ETH-BTC", interval: "2h" }],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseSignalInput(text), expected, text);
  assert.equal(parseSignalInput("what does the ichimoku cloud mean"), null);
});

test("parseWalletInput: address, chain aliases and kind", () => {
  const address = "0x6B0F4651eD42893ab58139938175E4a69f175F25";
  assert.deepEqual(parseWalletInput(`approvals ${address}`), { address, chain: "ethereum", kind: "token" });
  assert.deepEqual(parseWalletInput(`nft approvals ${address} on matic`), { address, chain: "polygon", kind: "nft" });
  assert.deepEqual(parseWalletInput(`${address} on avax`), { address, chain: "avalanche", kind: "token" });
  assert.equal(parseWalletInput("no address here"), null);
});

test("parseApprovalPayload: fenced JSON, bare JSON, options", () => {
  assert.deepEqual(parseApprovalPayload('explain ```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseApprovalPayload('is this ok {"spender":"x","amount":"1"} thanks'), { spender: "x", amount: "1" });
  assert.deepEqual(parseApprovalPayload("", { data: { b: 2 } }), { b: 2 });
  assert.equal(parseApprovalPayload("no json"), null);
});

test("parseDiagnoseInput: first http(s) URL, trailing punctuation dropped, POST only when asked", () => {
  assert.deepEqual(parseDiagnoseInput("check https://api.example.com/paid."), { url: "https://api.example.com/paid" });
  assert.deepEqual(parseDiagnoseInput("POST endpoint (https://a.b/x?y=1)"), { url: "https://a.b/x?y=1", method: "POST" });
  assert.deepEqual(parseDiagnoseInput("anything", { url: "http://h.io/p", method: "get" }), { url: "http://h.io/p", method: "GET" });
  assert.equal(parseDiagnoseInput("no url here"), null);
  assert.equal(parseDiagnoseInput("x", { url: "ftp://h.io" }), null);
});
