import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker, { issueSessionToken } from '../worker/index.js';
import { createStore } from '../worker/store.js';
import { createEmailChallenge, verifyEmailChallenge } from '../worker/email-verification.mjs';
import { createTestD1 } from './helpers/d1.mjs';

async function runtime() {
  const DB = createTestD1();
  const env = { DB, POSTS: { get: async () => null }, AUTH_SECRET: 'local-test-auth', VERIFY_SECRET: 'local-test-verify', BETA_ALL_PREMIUM: 'true' };
  const store = createStore(DB);
  for (const email of ['owner@jejuair.net', 'a@jejuair.net', 'b@jejuair.net'])
    await store.put(`user:${email}`, JSON.stringify({ email, profile: { roleType: 'FO_C', crewType: 'PILOT' } }));
  const call = async (path, email, body, explicitToken) => {
    const token = explicitToken || (email ? await issueSessionToken(env, email) : null);
    return worker.fetch(new Request(`https://test.invalid/api/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, {});
  };
  return { env, store, call };
}
const post = (id = 'P') => ({ id, ownerEmail: 'owner@jejuair.net', ownerRole: 'FO_C', deleteToken: 'test', status: 'active', offered: { days: [], patternName: 'Test', summary: 'Test', type: 'OFF' }, wanted: {} });

test('verification limits are shared by check, signup, reset and reissue', async () => {
  const { env, store, call } = await runtime();
  const e = { ...env, POSTS: store };
  const challenge = await createEmailChallenge(e, 'a@jejuair.net');
  const wrong = challenge.code === '111111' ? '222222' : '111111';
  const body = { email: 'a@jejuair.net', code: wrong, token: challenge.token, password: 'password-new', username: 'A', policyConsent: { privacyVersion: '2026-08-21', termsVersion: '2026-08-21' } };
  for (const route of ['check-verify', 'user-signup', 'user-reset-password', 'check-verify', 'user-reset-password'])
    assert.equal((await call(route, null, body)).status, 400);
  assert.equal((await call('check-verify', null, { ...body, code: challenge.code })).status, 429);
  assert.equal((await createEmailChallenge(e, body.email)).ok, false);
});

test('parallel guesses cannot exceed the database attempt budget', async () => {
  const { env, store } = await runtime(); const e = { ...env, POSTS: store };
  const c = await createEmailChallenge(e, 'a@jejuair.net');
  await Promise.all(Array.from({ length: 20 }, () => verifyEmailChallenge(e, 'a@jejuair.net', 'invalid', c.token)));
  assert.equal((await store.get('verify:a@jejuair.net', { type: 'json' })).attempts, 5);
});

test('reset consumes the challenge once and invalidates pre-reset sessions', async () => {
  const { env, store, call } = await runtime();
  const oldToken = await issueSessionToken(env, 'a@jejuair.net');
  const c = await createEmailChallenge({ ...env, POSTS: store }, 'a@jejuair.net');
  const body = { email: 'a@jejuair.net', token: c.token, code: c.code, password: 'new-password' };
  assert.equal((await call('check-verify', null, body)).status, 200);
  assert.equal((await call('user-reset-password', null, body)).status, 200);
  assert.equal((await call('user-reset-password', null, body)).status, 400);
  assert.equal((await call('schedules-sync', null, { schedules: [] }, oldToken)).status, 401);
  assert.equal((await call('user-login', null, { email: body.email, password: body.password })).status, 200);
});

test('deleted accounts cannot use previously issued sessions', async () => {
  const { env, store, call } = await runtime();
  const token = await issueSessionToken(env, 'a@jejuair.net');
  await store.delete('user:a@jejuair.net');
  assert.equal((await call('schedules-sync', null, { schedules: [] }, token)).status, 401);
});

test('challenge expires, and old stateless verification tokens are rejected', async () => {
  const { env, store } = await runtime(); const e = { ...env, POSTS: store };
  const c = await createEmailChallenge(e, 'a@jejuair.net', 1000);
  assert.equal((await verifyEmailChallenge(e, 'a@jejuair.net', c.code, c.token, true, 601000)).ok, false);
  assert.equal((await verifyEmailChallenge(e, 'a@jejuair.net', c.code, 'old-hmac-token')).ok, false);
});

test('contacts are absent before mutual acceptance, even for PRO users', async () => {
  const { store, call } = await runtime();
  const r = { id: 'R', fromEmail: 'a@jejuair.net', toEmail: 'owner@jejuair.net', stage: 2, fromRealName: 'Alice', fromEmployeeId: 'A1', fromPhone: '010-test', toRealName: 'Owner', toEmployeeId: 'B1', toPhone: '020-test' };
  await store.put('req:R', JSON.stringify(r));
  const fields = ['fromRealName','fromEmployeeId','fromPhone','toRealName','toEmployeeId','toPhone','fromEmail','toEmail'];
  for (const email of ['a@jejuair.net', 'owner@jejuair.net']) {
    const d = await (await call('requests-get', email)).json(); const result = [...d.sent, ...d.received][0];
    for (const field of fields) assert.equal(field in result, false, field);
  }
  await store.put('req:R', JSON.stringify({ ...r, stage: 3 }));
  assert.equal((await (await call('requests-get', 'owner@jejuair.net')).json()).received[0].fromPhone, '010-test');
});

for (const parallel of [false, true]) test(`one post accepts only one request (${parallel ? 'parallel' : 'sequential'})`, async () => {
  const { store, call } = await runtime(); await store.put('post:P', JSON.stringify(post()));
  for (const id of ['a','b']) await store.put(`req:${id}`, JSON.stringify({ id, postId: 'P', fromEmail: `${id}@jejuair.net`, toEmail: 'owner@jejuair.net', stage: 2, posterSelected: true, offered: { days: [] } }));
  const accept = id => call('requests-requester-accept', `${id}@jejuair.net`, { id });
  const responses = parallel ? await Promise.all(['a','b'].map(accept)) : [await accept('a'), await accept('b')];
  assert.deepEqual(responses.map(r => r.status).sort(), [200,409]);
});

test('concurrent urgent posts cannot spend one coupon twice (D1)', async () => {
  const { call, store } = await runtime();
  const results = await Promise.all(['A','B'].map(id => call('posts-create', 'a@jejuair.net', { ...post(id), urgent: true })));
  assert.deepEqual(results.map(r => r.status).sort(), [200,402]);
  const saved = await store.get('wallet:a@jejuair.net', { type: 'json' });
  assert.equal(saved.urgentCoupons, 0);
});

test('A-grade collection persists in D1 and inference works without disclosing names', async () => {
  const { call, store, env } = await runtime(); env.BETA_ALL_PREMIUM = 'false';
  assert.equal((await call('schedules-sync', 'a@jejuair.net', { schedules: [{ crewComposition: 'TestCaptain(Capt), TestFO(FO)' }] })).status, 200);
  assert.equal((await store.get('agrade:TestCaptain', { type: 'json' })).grade, 'A');
  await store.put('post:P', JSON.stringify({ ...post(), offered: { ...post().offered, crewPublic: 'TestCaptain(Capt)' } }));
  const response = await (await call('posts-get', 'b@jejuair.net')).json();
  assert.deepEqual(response.posts[0].offered.oppositeGrades, ['A']);
  assert.equal(JSON.stringify(response).includes('TestCaptain'), false);
});

test('rendered match cards escape stored HTML, including attribute-breaking IDs', () => {
  const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const escape = code.slice(code.indexOf('function escapeHtml('), code.indexOf('\nfunction showToast('));
  const start = code.indexOf('function renderMatches()');
  const render = code.slice(start, code.indexOf('/* ====== 공유 포스트 API 로드', start));
  const payload = '<img src=x onerror="alert(1)">';
  const p = { ...post(), id: '\" onclick=\"alert(1)', wanted: { memo: payload }, offered: { ...post().offered, patternName: payload } };
  const list = { innerHTML: '', querySelectorAll: () => [] };
  vm.runInNewContext(escape + render + ';renderMatches()', {
    $: s => s === '#matchList' ? list : {}, visiblePosts: () => [{ post: p, score: { dDay: { days: 5 } } }], state: { user: {} },
    AIRLINE_LABELS: {}, CREWTYPE_LABELS: {}, ROLE_LABELS: {}, CABIN_ROLE_LABELS: {}, GRADE_POLICY: { positionLabelOf: () => '' }, wantedSummary: w => w.memo,
    postGradeCheck: () => ({ status: 'PASS' }), positionLabel: () => '', companyDeadlineDueText: () => '', matchPostDetailsHtml: () => '', isPremiumUser: () => true,
  });
  assert.equal(list.innerHTML.includes(payload), false);
  assert.ok(list.innerHTML.includes('&lt;img'));
  assert.equal(list.innerHTML.includes('data-post="" onclick='), false);
});
