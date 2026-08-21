import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import {
  CREWSWAP_BUNDLE_ID,
  CREWSWAP_PRO_PRODUCT_ID,
  createAppStoreServerToken,
  decodeAppleTransaction,
  fetchAppleTransaction,
  validateCrewSwapTransaction,
} from '../worker/apple-iap.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signed(payload) {
  return `${b64({ alg:'ES256' })}.${b64(payload)}.signature`;
}

function testEnv() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve:'prime256v1' });
  return {
    APPLE_IAP_KEY_ID:'KEY1234567',
    APPLE_IAP_ISSUER_ID:'11111111-2222-3333-4444-555555555555',
    APPLE_IAP_PRIVATE_KEY:privateKey.export({ type:'pkcs8', format:'pem' }),
  };
}

test('App Store server token is an ES256 JWT with the CrewSwap bundle', async () => {
  const token = await createAppStoreServerToken(testEnv(), 1_700_000_000_000);
  const [header, payload, signature] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).bid, CREWSWAP_BUNDLE_ID);
  assert.ok(signature.length > 40);
});

test('CrewSwap accepts only its permanent PRO transaction and rejects refunds', () => {
  const base = {
    bundleId:CREWSWAP_BUNDLE_ID, productId:CREWSWAP_PRO_PRODUCT_ID,
    transactionId:'200000000000001', originalTransactionId:'200000000000001',
  };
  assert.deepEqual(validateCrewSwapTransaction(base, base.transactionId), { ok:true });
  assert.equal(validateCrewSwapTransaction({ ...base, productId:'other' }, base.transactionId).code, 'PRODUCT_MISMATCH');
  assert.equal(validateCrewSwapTransaction({ ...base, revocationDate:Date.now() }, base.transactionId).code, 'PURCHASE_REVOKED');
});

test('transaction lookup falls back to sandbox and decodes Apple response', async () => {
  const payload = {
    bundleId:CREWSWAP_BUNDLE_ID, productId:CREWSWAP_PRO_PRODUCT_ID,
    transactionId:'200000000000002', originalTransactionId:'200000000000002', environment:'Sandbox',
  };
  const calls = [];
  const result = await fetchAppleTransaction(testEnv(), payload.transactionId, async url => {
    calls.push(url);
    if (url.includes('api.storekit.apple.com')) return new Response('{}', { status:404 });
    return Response.json({ signedTransactionInfo:signed(payload) });
  });
  assert.equal(calls.length, 2);
  assert.equal(result.environment, 'sandbox');
  assert.equal(result.ok, true);
  assert.equal(decodeAppleTransaction(result.signedTransactionInfo).transactionId, payload.transactionId);
});
