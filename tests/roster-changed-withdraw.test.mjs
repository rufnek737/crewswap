/* 회사가 근무표를 바꿔 글이 유효하지 않게 된 경우의 자동 내림.
 * 앱이 근무표를 다시 불러오면서 posts-delete 를 reason:'roster-changed' 로 부른다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import rawWorker, { issueSessionToken } from '../worker/index.js';
import { creditMonthKey } from '../worker/credit-wallet.mjs';

const OWNER = 'owner@jejuair.net';

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    async get(key, options) {
      const value = values.get(key);
      if (value == null) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, String(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}

function makeEnv({ credits = 0, urgent = false, creditSpent = 1 } = {}) {
  const post = {
    id: 'POST-1', deleteToken: 'TOK', status: 'active', ownerEmail: OWNER,
    creditSpent, urgent, offered: { days: [26, 27, 28] },
  };
  return {
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    VERIFY_SECRET: 'test-verify-secret-at-least-32-characters',
    POSTS: createKv({
      'post:POST-1': post,
      'idx:posts': [post],
      [`user:${OWNER}`]: { email: OWNER },
      [`wallet:${OWNER}`]: { credits, creditMonth: creditMonthKey(), adCreditsThisMonth: 0, urgentCoupons: 0 },
    }),
  };
}

async function withdraw(env, reason) {
  const token = await issueSessionToken(env, OWNER);
  const res = await rawWorker.fetch(new Request('https://example.test/api/posts-delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: 'POST-1', deleteToken: 'TOK', reason }),
  }), env, {});
  return { res, body: await res.json() };
}

test('근무표가 바뀌어 내린 글은 목록에서 빠지고 사유가 남는다', async () => {
  const env = makeEnv();
  const { res } = await withdraw(env, 'roster-changed');
  assert.equal(res.status, 200);
  const stored = await env.POSTS.get('post:POST-1', { type: 'json' });
  assert.equal(stored.status, 'withdrawn');
  assert.equal(stored.withdrawReason, 'roster-changed');

  // 다른 사용자 목록에서 즉시 사라져야 한다 — 이게 이 기능의 핵심이다.
  const list = await rawWorker.fetch(new Request('https://example.test/api/posts-get'), env, {});
  const { posts } = await list.json();
  assert.deepEqual(posts.map(p => p.id), []);
});

test('쓴 크레딧을 전액 돌려준다 — 월 상한(3)에 묶이지 않는다', async () => {
  // 지갑에 이미 3개가 있어도 되돌려 받아야 한다. 회사가 바꾼 것이지 본인이
  // 마음을 바꾼 게 아니다.
  const env = makeEnv({ credits: 3, creditSpent: 1 });
  const { body } = await withdraw(env, 'roster-changed');
  assert.equal(body.refunded, 1);
  assert.equal(body.wallet.credits, 4);
});

test('직접 취소는 종전대로 상한에 묶인다 — 이번 변경이 새게 하지 않았다', async () => {
  const env = makeEnv({ credits: 3, creditSpent: 1 });
  const { body } = await withdraw(env, 'cancelled');
  assert.equal(body.refunded, 0);
  assert.equal(body.wallet.credits, 3);
});

test('마감은 종전대로 50% 환급', async () => {
  const env = makeEnv({ credits: 0, creditSpent: 1 });
  const { body } = await withdraw(env, 'expired');
  assert.equal(body.refunded, 0.5);
});

test('급구 쿠폰도 돌려준다 — 알림은 나갔지만 본인이 벌인 일이 아니다', async () => {
  const env = makeEnv({ urgent: true });
  const { body } = await withdraw(env, 'roster-changed');
  assert.equal(body.couponRefunded, 1);
});

test('두 번 불려도 크레딧이 두 번 들어오지 않는다', async () => {
  const env = makeEnv({ credits: 0, creditSpent: 1 });
  const first = await withdraw(env, 'roster-changed');
  assert.equal(first.body.refunded, 1);
  const second = await withdraw(env, 'roster-changed');
  assert.equal(second.body.alreadyClosed, true);
  assert.equal(second.body.wallet.credits, 1);
});
