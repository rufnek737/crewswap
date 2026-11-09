// 이미 올린 글을 수정 화면에서 급구로 바꾸기 — 쿠폰은 한 번만, 알림도 한 번만.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { issueSessionToken } from '../worker/index.js';
import { applyWalletCommand } from '../worker/credit-wallet.mjs';

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, o) { const v = values.get(key); return v == null ? null : o?.type === 'json' ? JSON.parse(v) : v; },
    async put(key, v) { values.set(key, String(v)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const EMAIL = 'owner@jejuair.net';
const base = { id: 'P1', ownerEmail: EMAIL, deleteToken: 'tok', status: 'active', wanted: { memo: 'old' }, offered: { patternName: '11/13' } };
const envWith = post => ({
  AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
  VERIFY_SECRET: 'test-verify-secret-at-least-32-characters',
  POSTS: createKv({ 'post:P1': post, [`user:${EMAIL}`]: { email: EMAIL } }),
});
async function update(env, body) {
  const token = await issueSessionToken(env, EMAIL);
  const res = await worker.fetch(new Request('https://example.test/api/posts-update', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'P1', deleteToken: 'tok', wanted: { memo: 'new' }, ...body }),
  }), env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}
const stored = env => env.POSTS.get('post:P1', { type: 'json' });

test('급구를 체크하지 않으면 문구만 바뀐다', async () => {
  const env = envWith(base);
  const r = await update(env, {});
  assert.equal(r.status, 200);
  const post = await stored(env);
  assert.equal(post.wanted.memo, 'new');
  assert.ok(!post.urgent);
});

test('마감된 글은 급구로 바꿀 수 없고 문구도 저장되지 않는다', async () => {
  const env = envWith({ ...base, status: 'expired' });
  const r = await update(env, { urgent: true });
  assert.equal(r.status, 409);
  assert.equal((await stored(env)).wanted.memo, 'old');
});

test('이미 급구인 글은 쿠폰을 다시 쓰지 않는다', async () => {
  const env = envWith({ ...base, urgent: true });
  const r = await update(env, { urgent: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.wallet, undefined);
});

const withCoupons = async (env, amount) => env.POSTS.put(`wallet:${EMAIL}`, JSON.stringify(
  applyWalletCommand(null, { type: 'grant-coupon', operationId: 'buy', amount }, Date.now()).wallet));

test('쿠폰이 없으면 전환을 막고 글을 그대로 둔다', async () => {
  const env = envWith(base);
  const r = await update(env, { urgent: true });
  assert.equal(r.status, 402);
  const post = await stored(env);
  assert.ok(!post.urgent);
  assert.equal(post.wanted.memo, 'old');
});

test('전환하면 쿠폰 1장을 쓰고, 다시 보내도 또 걷지 않는다', async () => {
  const env = envWith(base);
  await withCoupons(env, 2);
  const first = await update(env, { urgent: true });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.wallet.urgentCoupons, 1);
  assert.equal((await stored(env)).urgent, true);
  const again = await update(env, { urgent: true });
  assert.equal(again.status, 200);
  assert.equal(again.body.wallet, undefined);
  const wallet = await env.POSTS.get(`wallet:${EMAIL}`, { type: 'json' });
  assert.equal(wallet.urgentCoupons, 1);
});
