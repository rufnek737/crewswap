import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import worker, { issueSessionToken } from '../worker/index.js';
import { CREWSWAP_BUNDLE_ID, CREWSWAP_PRO_PRODUCT_ID } from '../worker/apple-iap.mjs';

const { privateKey } = generateKeyPairSync('ec', { namedCurve:'prime256v1' });

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    async get(key, options) { const value = values.get(key); return value == null ? null : options?.type === 'json' ? JSON.parse(value) : value; },
    async put(key, value) { values.set(key, String(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys:[...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) }; },
  };
}

function runtime(seed = {}) {
  return {
    AUTH_SECRET:'test-auth-secret-at-least-32-characters',
    VERIFY_SECRET:'test-verify-secret-at-least-32-characters',
    APPLE_IAP_KEY_ID:'KEY1234567',
    APPLE_IAP_ISSUER_ID:'11111111-2222-3333-4444-555555555555',
    APPLE_IAP_PRIVATE_KEY:privateKey.export({ type:'pkcs8', format:'pem' }),
    POSTS:createKv(seed),
  };
}

function signed(payload) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg:'ES256' })}.${b64(payload)}.signature`;
}

async function verifyPurchase(env, email, payload) {
  const token = await issueSessionToken(env, email);
  return worker.fetch(new Request('https://example.test/api/pro-purchase-verify', {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ transactionId:payload.transactionId, signedTransaction:signed(payload) }),
  }), env, {});
}

async function premiumStatus(env, email, environment = 'production') {
  const token = await issueSessionToken(env, email);
  return worker.fetch(new Request('https://example.test/api/premium-status', {
    headers:{
      Authorization:`Bearer ${token}`,
      'X-CrewSwap-Store-Environment':environment,
    },
  }), env, {});
}

test('Apple transaction grants lifetime PRO once and cannot be linked to another account', async () => {
  const payload = {
    bundleId:CREWSWAP_BUNDLE_ID, productId:CREWSWAP_PRO_PRODUCT_ID,
    transactionId:'200000000000101', originalTransactionId:'200000000000101',
    purchaseDate:Date.now(),
  };
  const env = runtime({
    'user:first@jejuair.net':{ email:'first@jejuair.net' },
    'user:second@jejuair.net':{ email:'second@jejuair.net' },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ signedTransactionInfo:signed(payload) });
  try {
    const first = await verifyPurchase(env, 'first@jejuair.net', payload);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).premium.entitlement, 'lifetime');
    assert.equal((await env.POSTS.get('user:first@jejuair.net', { type:'json' })).proLifetime, true);

    const duplicate = await verifyPurchase(env, 'second@jejuair.net', payload);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, 'PURCHASE_ALREADY_LINKED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a revoked Apple transaction removes lifetime PRO on re-verification', async () => {
  const payload = {
    bundleId:CREWSWAP_BUNDLE_ID, productId:CREWSWAP_PRO_PRODUCT_ID,
    transactionId:'200000000000102', originalTransactionId:'200000000000102',
    purchaseDate:Date.now(), revocationDate:Date.now(), revocationReason:1,
  };
  const env = runtime({
    'user:refund@jejuair.net':{ email:'refund@jejuair.net', proLifetime:true, proLifetimeSource:'apple' },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ signedTransactionInfo:signed(payload) });
  try {
    const response = await verifyPurchase(env, 'refund@jejuair.net', payload);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'PURCHASE_REVOKED');
    assert.equal((await env.POSTS.get('user:refund@jejuair.net', { type:'json' })).proLifetime, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a sandbox transaction grants temporary test PRO without creating production lifetime access', async () => {
  const payload = {
    bundleId:CREWSWAP_BUNDLE_ID, productId:CREWSWAP_PRO_PRODUCT_ID,
    transactionId:'200000000000103', originalTransactionId:'200000000000103',
    purchaseDate:Date.now(), environment:'Sandbox',
  };
  const env = runtime({ 'user:beta@jejuair.net':{ email:'beta@jejuair.net' } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('api.storekit.apple.com')
    ? new Response('{}', { status:404 })
    : Response.json({ signedTransactionInfo:signed(payload) });
  try {
    const purchase = await verifyPurchase(env, 'beta@jejuair.net', payload);
    const purchaseBody = await purchase.json();
    assert.equal(purchase.status, 200);
    assert.equal(purchaseBody.environment, 'sandbox');
    assert.equal(purchaseBody.premium.entitlement, 'sandbox');

    const stored = await env.POSTS.get('user:beta@jejuair.net', { type:'json' });
    assert.notEqual(stored.proLifetime, true);
    assert.ok(Date.parse(stored.proSandboxExpiresAt) > Date.now());

    assert.equal((await (await premiumStatus(env, 'beta@jejuair.net')).json()).premium.active, false);
    assert.equal((await (await premiumStatus(env, 'beta@jejuair.net', 'sandbox')).json()).premium.entitlement, 'sandbox');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
