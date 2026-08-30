import test from 'node:test';
import assert from 'node:assert/strict';
import rawWorker, { issueSessionToken } from '../worker/index.js';

const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-characters';
const worker = {
  async fetch(request, env, ctx) {
    env.AUTH_SECRET ||= TEST_AUTH_SECRET;
    env.VERIFY_SECRET ||= 'test-verify-secret-at-least-32-characters';
    const url = new URL(request.url);
    if (request.headers.has('Authorization')) return rawWorker.fetch(request, env, ctx);
    let email = url.searchParams.get('email');
    if (!email && request.method !== 'GET') {
      const body = await request.clone().json().catch(() => ({}));
      email = body.email;
    }
    if (!email) throw new Error(`테스트 인증 이메일 누락: ${url.pathname}`);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${await issueSessionToken(env, email)}`);
    return rawWorker.fetch(new Request(request, { headers }), env, ctx);
  },
};

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [
    key,
    typeof value === 'string' ? value : JSON.stringify(value),
  ]));
  return {
    async get(key, options) {
      const value = values.get(key);
      if (value == null) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, String(value)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) };
    },
  };
}

function api(path, body) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 상호 수락까지 끝나 회사 상신을 기다리는 상태
function acceptedEnv(overrides = {}) {
  const rec = {
    id: 'REQ-1',
    postId: 'POST-1',
    postTitle: '8/24 국제선',
    postOffered: { type: '국제선', patternName: '8/24 국제선' },
    postOwnerRole: 'CAPTAIN_B',
    aircraft: 'NG',
    base: 'GMP',
    type: 'request',
    fromEmail: 'requester@jejuair.net',
    toEmail: 'poster@jejuair.net',
    stage: 3,
    status: '상호 수락 — 회사 상신 필요',
    ...overrides,
  };
  const post = { id: 'POST-1', ownerEmail: 'poster@jejuair.net', status: 'submitting', matched: true, matchedAt: '2026-08-29T00:00:00.000Z' };
  return {
    POSTS: createKv({
      'req:REQ-1': rec,
      'idx:requests': [rec],
      'post:POST-1': post,
      'idx:posts': [post],
    }),
  };
}

test('records the rejection reason and reopens the locked post', async () => {
  const env = acceptedEnv();
  const res = await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
    reason: '편조 기준 미충족으로 반려',
  }), env, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).postReopened, true);

  const rec = await env.POSTS.get('req:REQ-1', { type: 'json' });
  assert.equal(rec.submitRejected, true);
  assert.equal(rec.submitRejectedReason, '편조 기준 미충족으로 반려');
  assert.equal(rec.status, '⛔ 회사 상신 반려됨');
  assert.ok(rec.submitRejectedAt);

  // 반려됐으면 스왑은 없던 일 — 잠가둔 글이 다시 요청 가능해져야 한다
  const post = await env.POSTS.get('post:POST-1', { type: 'json' });
  assert.equal(post.status, 'active');
  assert.equal(post.matched, false);
  assert.equal(post.matchedAt, undefined);
});

test('keeps the reason in an analysis log without personal data', async () => {
  const env = acceptedEnv();
  await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'poster@jejuair.net', reason: '신청 마감 시각 경과',
  }), env, {});

  const log = await env.POSTS.get('idx:submit-rejections', { type: 'json' });
  assert.equal(log.length, 1);
  assert.equal(log[0].reason, '신청 마감 시각 경과');
  assert.equal(log[0].reqId, 'REQ-1');
  assert.equal(log[0].offeredType, '국제선');
  assert.equal(log[0].ownerRole, 'CAPTAIN_B');
  assert.equal(log[0].wasSubmitted, false);
  const serialized = JSON.stringify(log[0]);
  assert.ok(!serialized.includes('@'), '이메일이 로그에 남으면 안 된다');
});

test('works after the poster already marked the submission done', async () => {
  const env = acceptedEnv({ submitted: true, submittedAt: '2026-08-29T01:00:00.000Z' });
  // 상신 완료 표시 때 글은 이미 지워진 상태
  await env.POSTS.delete('post:POST-1');
  const res = await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'poster@jejuair.net', reason: '상대방 자격 미달',
  }), env, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).postReopened, false);

  const log = await env.POSTS.get('idx:submit-rejections', { type: 'json' });
  assert.equal(log[0].wasSubmitted, true);
});

test('only the poster may record a rejection, and only after mutual accept', async () => {
  const env = acceptedEnv();
  const asRequester = await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'requester@jejuair.net', reason: '아무거나',
  }), env, {});
  assert.equal(asRequester.status, 403);

  const early = acceptedEnv({ stage: 1 });
  const tooEarly = await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'poster@jejuair.net', reason: '아무거나',
  }), early, {});
  assert.equal(tooEarly.status, 400);
});

test('requires a reason and caps its length', async () => {
  const env = acceptedEnv();
  const blank = await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'poster@jejuair.net', reason: '   ',
  }), env, {});
  assert.equal(blank.status, 400);

  const long = acceptedEnv();
  await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'poster@jejuair.net', reason: 'ㄱ'.repeat(500),
  }), long, {});
  const rec = await long.POSTS.get('req:REQ-1', { type: 'json' });
  assert.equal(rec.submitRejectedReason.length, 300);
});

test('a second rejection does not double-log', async () => {
  const env = acceptedEnv();
  const body = { id: 'REQ-1', email: 'poster@jejuair.net', reason: '편조 불가' };
  await worker.fetch(api('/api/requests-submit-rejected', body), env, {});
  const again = await worker.fetch(api('/api/requests-submit-rejected', body), env, {});
  assert.equal(again.status, 200);
  assert.equal((await again.json()).alreadyRejected, true);
  const log = await env.POSTS.get('idx:submit-rejections', { type: 'json' });
  assert.equal(log.length, 1);
});

test('the rejection log is readable only by configured viewers', async () => {
  const env = acceptedEnv();
  await worker.fetch(api('/api/requests-submit-rejected', {
    id: 'REQ-1', email: 'poster@jejuair.net', reason: '편조 불가',
  }), env, {});

  const denied = await worker.fetch(
    new Request('https://example.test/api/submit-rejections?email=poster@jejuair.net'), env, {});
  assert.equal(denied.status, 403);

  env.SUBMIT_REJECTION_VIEWERS = 'ops@jejuair.net, poster@jejuair.net';
  const allowed = await worker.fetch(
    new Request('https://example.test/api/submit-rejections?email=poster@jejuair.net'), env, {});
  assert.equal(allowed.status, 200);
  const data = await allowed.json();
  assert.equal(data.count, 1);
  assert.equal(data.rejections[0].reason, '편조 불가');
});
