import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import plugin from "../dist/index.js";
import { startFixtures, closeAll, fakeRuntime, message, newSolanaKey, newEvmKey, SOLANA, BASE } from "./fixtures.mjs";

const action = (name) => plugin.actions.find((a) => a.name === name);
const ICHIMOKU = action("FIZZL_ICHIMOKU_SIGNAL");
const CHECK = action("FIZZL_CHECK_WALLET_APPROVALS");
const EXPLAIN = action("FIZZL_EXPLAIN_APPROVAL");
const DOCTOR = action("FIZZL_DIAGNOSE_X402");

let fx;
let sol;
let evm;
before(async () => {
  fx = await startFixtures();
  sol = await newSolanaKey();
  evm = newEvmKey();
});
after(closeAll);

function runtimeWith(keys) {
  return fakeRuntime({
    ICHIMOKU_SIGNAL_URL: fx.ichimokuUrl,
    PLAINTEXT_URL: fx.plaintextUrl,
    X402_DOCTOR_URL: fx.doctorUrl,
    SOLANA_RPC_URL: fx.rpc,
    ...keys,
  });
}

async function run(act, runtime, text, options) {
  const replies = [];
  const result = await act.handler(runtime, message(text), undefined, options, async (content) => {
    replies.push(content);
    return [];
  });
  return { result, replies };
}

test("Ichimoku: pays on Solana (preferred even though Base is listed first) and reports the signal", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(ICHIMOKU, runtimeWith({ SVM_PRIVATE_KEY: sol.secret, EVM_PRIVATE_KEY: evm.secret }), "What does the ichimoku cloud say for SOL/USDT on the 4h?");
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments, [{ network: SOLANA, valid: true, payer: sol.address, path: "/signal/SOL-USDT?interval=4h" }]);
  assert.match(replies[0].text, /^SOL-USDT 4h: BULLISH/);
  assert.match(replies[0].text, /above the cloud; tenkan above kijun/);
  assert.match(replies[0].text, /https:\/\/solscan\.io\/tx\/5SolanaSettlementTx/);
  assert.equal(result.values.ichimokuSignal, "bullish");
});

test("Ichimoku: pays on Base when only an EVM wallet is configured", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(ICHIMOKU, runtimeWith({ EVM_PRIVATE_KEY: evm.secret }), "Is BTC above the cloud on the daily?");
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.valid, p.payer, p.path]), [[BASE, true, evm.address, "/signal/BTC-USDT?interval=1d"]]);
  assert.match(replies[0].text, /basescan\.org\/tx\/0xbasesettlementtx/);
});

test("Ichimoku: explicit handler options override the text", async () => {
  fx.state.payments.length = 0;
  const { result } = await run(ICHIMOKU, runtimeWith({ SVM_PRIVATE_KEY: sol.secret }), "ichimoku please", { pair: "eth-usdc", interval: "15m" });
  assert.equal(result.success, true, result.error);
  assert.equal(fx.state.payments[0].path, "/signal/ETH-USDC?interval=15m");
});

test("spend cap: a price above FIZZL_MAX_PAYMENT_USD is refused before signing", async () => {
  fx.state.payments.length = 0;
  fx.ichimokuPrice.amount = "500000"; // $0.50
  try {
    const { result } = await run(ICHIMOKU, runtimeWith({ SVM_PRIVATE_KEY: sol.secret, FIZZL_MAX_PAYMENT_USD: "0.25" }), "ichimoku for SOL-USDT");
    assert.equal(result.success, false);
    assert.match(result.error, /maxAmountPerPayment|spend/i);
    assert.equal(fx.state.payments.length, 0, "nothing was signed");
  } finally {
    fx.ichimokuPrice.amount = "20000";
  }
});

test("a rejected payment surfaces the facilitator's reason", async () => {
  fx.state.reject = "insufficient_funds";
  try {
    const { result } = await run(ICHIMOKU, runtimeWith({ SVM_PRIVATE_KEY: sol.secret }), "ichimoku for SOL-USDT");
    assert.equal(result.success, false);
    assert.match(result.error, /payment rejected: insufficient_funds/);
  } finally {
    fx.state.reject = null;
  }
});

test("wallet approvals: pays $0.10 (Solana preferred when both wallets are set) and returns the verdict", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(
    CHECK,
    runtimeWith({ SVM_PRIVATE_KEY: sol.secret, EVM_PRIVATE_KEY: evm.secret }),
    "Are the NFT approvals on 0x6B0F4651eD42893ab58139938175E4a69f175F25 safe on arbitrum?"
  );
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.valid, p.path]), [[SOLANA, true, "/api/check-wallet"]]);
  assert.match(replies[0].text, /0x6B0F…5F25 nft approvals on arbitrum: CAUTION/);
  assert.match(replies[0].text, /Unlimited USDC approval on arbitrum \(nft\)/);
});

test("wallet approvals with only a Solana wallet: pays on Solana", async () => {
  fx.state.payments.length = 0;
  const { result } = await run(CHECK, runtimeWith({ SVM_PRIVATE_KEY: sol.secret }), "check approvals on 0x6B0F4651eD42893ab58139938175E4a69f175F25");
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.valid, p.payer]), [[SOLANA, true, sol.address]]);
});

test("explain approval: parses the JSON payload and pays $0.05 on Base", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(
    EXPLAIN,
    runtimeWith({ EVM_PRIVATE_KEY: evm.secret }),
    'Is this approval safe? ```json\n{"spender":"0x1111111254eeb25477b68fb85ed929f73a960582","amount":"unlimited","token":"USDC"}\n```'
  );
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.path]), [[BASE, "/api/explain"]]);
  assert.match(replies[0].text, /This approval: RISK/);
});

test("x402 doctor: pays $0.01 on Solana, passes url and method, lists failures before warnings with hints", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(
    DOCTOR,
    runtimeWith({ SVM_PRIVATE_KEY: sol.secret, EVM_PRIVATE_KEY: evm.secret }),
    "Can you diagnose my x402 endpoint? It's a POST at https://api.example.com/paid?x=1."
  );
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.valid, p.path]), [
    [SOLANA, true, `/api/v1/diagnose?url=${encodeURIComponent("https://api.example.com/paid?x=1")}&method=POST`],
  ]);
  const lines = replies[0].text.split("\n");
  assert.match(lines[0], /^⛔ https:\/\/api\.example\.com\/paid\?x=1 \(POST\): FAIL$/);
  assert.equal(lines[1], "1 passed, 1 warnings, 1 failed");
  assert.match(lines[2], /^⛔ accepts\[0\]: amount/);
  assert.match(lines[3], /→ Use 10000/);
  assert.match(lines[4], /^⚠️ Payment challenge/);
  assert.equal(result.values.x402Overall, "fail");
});

test("no wallet configured: every action explains what to set", async () => {
  const { result } = await run(ICHIMOKU, runtimeWith({}), "ichimoku for SOL-USDT");
  assert.equal(result.success, false);
  assert.match(result.error, /SVM_PRIVATE_KEY.*EVM_PRIVATE_KEY/);
});

test("validate: only triggers on relevant messages that contain the needed input", async () => {
  const rt = runtimeWith({});
  const v = (act, text) => act.validate(rt, message(text));
  assert.equal(await v(ICHIMOKU, "ichimoku for SOL-USDT"), true);
  assert.equal(await v(ICHIMOKU, "is $JUP above the cloud?"), true);
  assert.equal(await v(ICHIMOKU, "what's the weather like"), false);
  assert.equal(await v(ICHIMOKU, "tell me about ichimoku in general"), false);
  assert.equal(await v(CHECK, "revoke check 0x6B0F4651eD42893ab58139938175E4a69f175F25"), true);
  assert.equal(await v(CHECK, "check approvals"), false);
  assert.equal(await v(EXPLAIN, 'explain this approval {"spender":"0xabc","amount":"1"}'), true);
  assert.equal(await v(EXPLAIN, "explain this approval"), false);
  assert.equal(await v(DOCTOR, "why is my x402 paywall broken? https://api.example.com/paid"), true);
  assert.equal(await v(DOCTOR, "check https://example.com"), false);
  assert.equal(await v(DOCTOR, "why is my x402 paywall broken?"), false);
});

test("provider lists the tools, prices and paying wallets", async () => {
  const provider = plugin.providers.find((p) => p.name === "FIZZL_SERVICES");
  const out = await provider.get(runtimeWith({ SVM_PRIVATE_KEY: sol.secret }), message("hi"), {});
  assert.match(out.text, /FIZZL_ICHIMOKU_SIGNAL: .*\$0\.02/);
  assert.match(out.text, new RegExp(`Solana ${sol.address}`));
  assert.equal(out.values.fizzlCanPay, true);
});
