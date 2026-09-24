import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import plugin from "../dist/index.js";
import { startFixtures, closeAll, fakeRuntime, message, newSolanaKey, newEvmKey, SOLANA, BASE } from "./fixtures.mjs";

const action = (name) => plugin.actions.find((a) => a.name === name);
const ICHIMOKU = action("FIZZL_ICHIMOKU_SIGNAL");
const CHECK = action("FIZZL_CHECK_WALLET_APPROVALS");
const EXPLAIN = action("FIZZL_EXPLAIN_APPROVAL");
const DOCTOR = action("FIZZL_DIAGNOSE_X402");
const PREFLIGHT = action("FIZZL_PREFLIGHT_X402");
const PRESIGN = action("FIZZL_PRESIGN_CHECK");
const PERMIT = JSON.stringify({
  primaryType: "Permit",
  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  message: { owner: "0x1111111111111111111111111111111111111111", spender: "0xbad0000000000000000000000000000000000001", value: "1000000000", nonce: 0, deadline: "9999999999" },
});

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
    PRESIGN_GUARD_URL: fx.presignUrl,
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

test("preflight: pays $0.001 on Solana, passes url, budget and network, replies with the verdict", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(
    PREFLIGHT,
    runtimeWith({ SVM_PRIVATE_KEY: sol.secret, EVM_PRIVATE_KEY: evm.secret }),
    "Is it safe to pay https://api.example.com/paid/1? Max $0.05 on solana."
  );
  assert.equal(result.success, true, result.error);
  const query = new URLSearchParams({ url: "https://api.example.com/paid/1", max_usd: "0.05", network: SOLANA });
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.valid, p.path]), [[SOLANA, true, `/api/v1/preflight?${query}`]]);
  const lines = replies[0].text.split("\n");
  assert.equal(lines[0], "✅ GO https://api.example.com/paid/1");
  assert.equal(lines[1], "OK to pay: $0.02 on Solana.");
  assert.equal(lines[2], "Recommended: $0.02 USDC on Solana → SoLPayTo");
  assert.match(replies[0].text, /option 2 \(Polygon\): accepts\[2\]: extra\.name/);
  assert.doesNotMatch(replies[0].text, /not listed/, "info reasons stay out of the reply");
  assert.equal(result.values.x402Verdict, "go");
  assert.equal(result.values.x402SafeToPay, true);
});

test("preflight: over budget is NO-GO without a recommendation line", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(PREFLIGHT, runtimeWith({ EVM_PRIVATE_KEY: evm.secret }), "should I pay https://api.example.com/paid/1 with a budget of $0.01");
  assert.equal(result.success, true, result.error);
  assert.equal(fx.state.payments[0].network, BASE);
  assert.match(replies[0].text, /^⛔ NO-GO /);
  assert.doesNotMatch(replies[0].text, /Recommended:/);
  assert.equal(result.values.x402SafeToPay, false);
});

test("presign: pasted typed data is wrapped as a signature request, paid $0.01 on Base (even with a Solana wallet too), red first", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(PRESIGN, runtimeWith({ SVM_PRIVATE_KEY: sol.secret, EVM_PRIVATE_KEY: evm.secret }), `Is it safe to sign this? ${PERMIT}`);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.payments.map((p) => [p.network, p.valid, p.payer, p.path]), [[BASE, true, evm.address, "/v1/check"]]);
  assert.equal(fx.state.lastPresign.input.type, "signature");
  assert.equal(fx.state.lastPresign.input.chainId, 8453);
  assert.equal(fx.state.lastPresign.input.typedData.primaryType, "Permit");
  assert.match(replies[0].text, /^🔴 RED: do not sign\.\n· red: SIGNATURE_GRANT_TO_EOA \(0xbad0…0001\)\n· info: OFFCHAIN_SIGNATURE/);
  assert.equal(result.values.presignVerdict, "red");
  assert.equal(result.values.safeToSign, false);
});

test("presign: 'explain in Dutch' uses /v1/check/explain ($0.03) with lang nl", async () => {
  fx.state.payments.length = 0;
  const { result, replies } = await run(PRESIGN, runtimeWith({ EVM_PRIVATE_KEY: evm.secret }), `Should I sign this? Explain in Dutch. ${PERMIT}`);
  assert.equal(result.success, true, result.error);
  assert.equal(fx.state.lastPresign.path, "/v1/check/explain");
  assert.equal(fx.state.lastPresign.input.lang, "nl");
  assert.match(replies[0].text, /Tekenen geeft deze wallet toegang/);
});

test("presign: a transaction from handler options, green is safe to sign", async () => {
  const { result } = await run(PRESIGN, runtimeWith({ EVM_PRIVATE_KEY: evm.secret }), "check this before I sign", {
    transaction: { to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x", value: 0, chainId: "0x2105" },
  });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(fx.state.lastPresign.input, { type: "transaction", chainId: 8453, to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x", value: "0" });
  assert.equal(result.values.safeToSign, true);
});

test("presign: only a Solana wallet refuses before paying, and says what to set", async () => {
  fx.state.payments.length = 0;
  const { result } = await run(PRESIGN, runtimeWith({ SVM_PRIVATE_KEY: sol.secret }), `Is it safe to sign this? ${PERMIT}`);
  assert.equal(result.success, false);
  assert.match(result.error, /Base only.*EVM_PRIVATE_KEY/);
  assert.equal(fx.state.payments.length, 0);
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
  assert.equal(await v(PREFLIGHT, "is it safe to pay https://api.example.com/paid"), true);
  assert.equal(await v(PREFLIGHT, "check before paying https://api.example.com/paid"), true);
  assert.equal(await v(PREFLIGHT, "is it safe to pay?"), false);
  assert.equal(await v(DOCTOR, "check if this x402 endpoint is safe to pay https://api.example.com/paid"), false, "buyer intent goes to preflight, not diagnose");
  assert.equal(await v(PRESIGN, `is it safe to sign this? ${PERMIT}`), true);
  assert.equal(await v(PRESIGN, 'check this tx {"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x095ea7b3"}'), true);
  assert.equal(await v(PRESIGN, "is it safe to sign this?"), false);
  assert.equal(await v(PRESIGN, 'explain this approval {"spender":"0xabc","amount":"1"}'), false, "loose approval JSON stays with FIZZL_EXPLAIN_APPROVAL");
});

test("provider lists the tools, prices and paying wallets", async () => {
  const provider = plugin.providers.find((p) => p.name === "FIZZL_SERVICES");
  const out = await provider.get(runtimeWith({ SVM_PRIVATE_KEY: sol.secret }), message("hi"), {});
  assert.match(out.text, /FIZZL_ICHIMOKU_SIGNAL: .*\$0\.02/);
  assert.match(out.text, /FIZZL_PRESIGN_CHECK: .*\$0\.01 \(Base\)/);
  assert.match(out.text, new RegExp(`Solana ${sol.address}`));
  assert.equal(out.values.fizzlCanPay, true);
});
