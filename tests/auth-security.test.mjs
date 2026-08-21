import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { issueSessionToken, verifySessionToken } from '../worker/index.js';

const AUTH_SECRET = 'test-auth-secret-at-least-32-characters';
const VERIFY_SECRET = 'test-verify-secret-at-least-32-characters';

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  return {
    async get(key, options) { const value = values.get(key); return value == null ? null : options?.type === 'json' ? JSON.parse(value) : value; },
    async put(key, value) { values.set(key, String(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) }; },
  };
}

function env(seed = {}) {
  return {
    AUTH_SECRET,
    VERIFY_SECRET,
    RESEND_API_KEY: 're_test',
    RESEND_FROM: 'CrewSwap <verify@notify.rufnekcrew.com>',
    POSTS: createKv(seed),
  };
}
async function authed(path, email, body, runtime) {
  const token = await issueSessionToken(runtime, email);
  return worker.fetch(new Request(`https://example.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), runtime, {});
}

test('signed sessions reject tampering and expiry', async () => {
  const runtime = env();
  const token = await issueSessionToken(runtime, 'pilot@jejuair.net', 1_000);
  assert.equal((await verifySessionToken(runtime, token, 2_000)).email, 'pilot@jejuair.net');
  assert.equal(await verifySessionToken(runtime, token + 'x', 2_000), null);
  assert.equal(await verifySessionToken(runtime, token, 1_000 + 31 * 24 * 60 * 60 * 1000), null);
});

test('protected APIs reject missing sessions', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/posts-get-mine'), env(), {});
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTH_REQUIRED');
});

test('authenticated identity overrides forged body and query emails', async () => {
  const runtime = env({
    'user:a@jejuair.net': { email:'a@jejuair.net', profile:{ nickname:'A' } },
    'user:b@jejuair.net': { email:'b@jejuair.net', profile:{ nickname:'B' } },
    'idx:requests': [
      { id:'A1', fromEmail:'a@jejuair.net', toEmail:'x@jejuair.net' },
      { id:'B1', fromEmail:'b@jejuair.net', toEmail:'x@jejuair.net' },
    ],
  });
  const update = await authed('/api/user-update', 'a@jejuair.net', { email:'b@jejuair.net', profile:{ nickname:'A2' } }, runtime);
  assert.equal(update.status, 200);
  assert.equal((await runtime.POSTS.get('user:a@jejuair.net', { type:'json' })).profile.nickname, 'A2');
  assert.equal((await runtime.POSTS.get('user:b@jejuair.net', { type:'json' })).profile.nickname, 'B');

  const requests = await authed('/api/requests-get?email=b%40jejuair.net', 'a@jejuair.net', undefined, runtime);
  const data = await requests.json();
  assert.deepEqual(data.sent.map(item => item.id), ['A1']);
});

test('signup returns a verifiable session and verification requests are rate limited', async () => {
  const runtime = env();
  const originalFetch = globalThis.fetch;
  let deliveredCode = '';
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    deliveredCode = payload.html.match(/>(\d{6})<\/div>/)?.[1] || '';
    return new Response(JSON.stringify({ id: 'email-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const verifyRequest = () => worker.fetch(new Request('https://example.test/api/send-verify', {
    method:'POST', headers:{ 'Content-Type':'application/json', 'CF-Connecting-IP':'203.0.113.1' },
    body:JSON.stringify({ email:'new@jejuair.net' }),
  }), runtime, {});
  try {
    const first = await verifyRequest();
    const verification = await first.json();
    assert.equal(first.status, 200);
    assert.equal('code' in verification, false);
    assert.match(deliveredCode, /^\d{6}$/);

    const signup = await worker.fetch(new Request('https://example.test/api/user-signup', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        email:'new@jejuair.net', code:deliveredCode, token:verification.token,
        username:'New', password:'secure-password', profile:{ nickname:'New' },
        policyConsent:{ privacyVersion:'2026-08-21', termsVersion:'2026-08-21' },
      }),
    }), runtime, {});
    assert.equal(signup.status, 200);
    const account = await signup.json();
    assert.equal((await verifySessionToken(runtime, account.sessionToken)).email, 'new@jejuair.net');
    assert.equal(account.premium.active, false);
    assert.equal(account.premium.trialAvailable, true);

    for (let i = 0; i < 4; i++) assert.equal((await verifyRequest()).status, 200);
    assert.equal((await verifyRequest()).status, 429);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the PRO pass starts only on request and cannot be claimed twice', async () => {
  const runtime = env({
    'user:pilot@jejuair.net': { email:'pilot@jejuair.net', profile:{ nickname:'Pilot' } },
  });

  const before = await authed('/api/premium-status', 'pilot@jejuair.net', undefined, runtime);
  const beforeData = await before.json();
  assert.equal(beforeData.premium.active, false);
  assert.equal(beforeData.premium.trialAvailable, true);

  const activation = await authed('/api/premium-trial-activate', 'pilot@jejuair.net', {}, runtime);
  const activationData = await activation.json();
  assert.equal(activation.status, 200);
  assert.equal(activationData.premium.active, true);
  assert.equal(activationData.premium.entitlement, 'trial');
  assert.equal(activationData.premium.trialAvailable, false);

  const stored = await runtime.POSTS.get('user:pilot@jejuair.net', { type:'json' });
  assert.ok(stored.proTrialStartedAt);
  assert.ok(stored.proTrialExpiresAt);

  const duplicate = await authed('/api/premium-trial-activate', 'pilot@jejuair.net', {}, runtime);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'PRO_TRIAL_ALREADY_USED');
});

test('verification fails closed when email delivery is not configured', async () => {
  const runtime = env();
  delete runtime.RESEND_API_KEY;
  delete runtime.RESEND_FROM;
  const response = await worker.fetch(new Request('https://example.test/api/send-verify', {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ email:'pilot@jejuair.net' }),
  }), runtime, {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal('code' in body, false);
  assert.equal('token' in body, false);
});

test('CORS is limited to the web app and native app origins', async () => {
  const allowed = await worker.fetch(new Request('https://example.test/api/posts-get', { headers:{ Origin:'https://rufnek737.github.io' } }), env({ 'idx:posts':[] }), {});
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://rufnek737.github.io');
  const blocked = await worker.fetch(new Request('https://example.test/api/posts-get', { headers:{ Origin:'https://evil.example' } }), env({ 'idx:posts':[] }), {});
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
});
