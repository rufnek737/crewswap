import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

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

function pendingRequest() {
  return {
    id: 'REQ-1',
    fromEmail: 'requester@jejuair.net',
    toEmail: 'poster@jejuair.net',
    stage: 1,
    status: '상대가 바꿀 날 고르는 중',
    openRoster: [
      { month: '2026-08', day: 18, type: 'OFF' },
      { month: '2026-08', day: 24, type: '국제선' },
    ],
  };
}

test('poster selection waits for requester final approval', async () => {
  const original = pendingRequest();
  const env = { POSTS: createKv({ 'req:REQ-1': original, 'idx:requests': [original] }) };

  const selectResponse = await worker.fetch(api('/api/requests-poster-select', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
    offered: { patternName: '8/24 국제선', days: [24] },
  }), env, {});
  assert.equal(selectResponse.status, 200);

  const selected = await env.POSTS.get('req:REQ-1', { type: 'json' });
  assert.equal(selected.stage, 2);
  assert.equal(selected.posterSelected, true);
  assert.equal(selected.status, '요청자 최종 승인 대기');

  const wrongUser = await worker.fetch(api('/api/requests-requester-accept', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
  }), env, {});
  assert.equal(wrongUser.status, 403);

  const acceptResponse = await worker.fetch(api('/api/requests-requester-accept', {
    id: 'REQ-1',
    email: 'requester@jejuair.net',
    realName: '요청자',
    employeeId: 'A100',
    phone: '010-0000-0000',
  }), env, {});
  assert.equal(acceptResponse.status, 200);

  const accepted = await env.POSTS.get('req:REQ-1', { type: 'json' });
  assert.equal(accepted.stage, 3);
  assert.equal(accepted.status, '상호 수락 — 회사 상신 필요');
  assert.equal(accepted.fromRealName, '요청자');
});

test('requester can reject only the selected combination and ask for another date', async () => {
  const original = {
    ...pendingRequest(),
    offered: { patternName: '8/24 국제선', days: [24] },
    posterSelected: true,
    stage: 2,
  };
  const env = { POSTS: createKv({ 'req:REQ-1': original, 'idx:requests': [original] }) };

  const response = await worker.fetch(api('/api/requests-requester-decline', {
    id: 'REQ-1',
    email: 'requester@jejuair.net',
  }), env, {});
  assert.equal(response.status, 200);

  const reopened = await env.POSTS.get('req:REQ-1', { type: 'json' });
  assert.equal(reopened.stage, 1);
  assert.equal(reopened.posterSelected, false);
  assert.equal(reopened.offered, null);
  assert.match(reopened.status, /다른 날짜 선택 요청/);
});

test('poster cannot place work on the requester mortgage-rest day', async () => {
  const original = {
    ...pendingRequest(),
    postId: 'POST-1',
    openRoster: [
      { month: '2026-08', day: 21, type: '국제선' },
      { month: '2026-08', day: 22, type: '국제선' },
      { month: '2026-08', day: 23, type: 'ARRIVAL' },
      { month: '2026-08', day: 24, type: 'OFF' },
    ],
  };
  const post = {
    id: 'POST-1',
    offered: {
      days: [24, 25],
      daySchedules: [
        { month: '2026-08', day: 24, type: '국내선', title: '7C129' },
        { month: '2026-08', day: 25, type: 'OFF', title: 'OFF' },
      ],
    },
  };
  const env = {
    POSTS: createKv({
      'req:REQ-1': original,
      'post:POST-1': post,
      'idx:requests': [original],
    }),
  };

  const response = await worker.fetch(api('/api/requests-poster-select', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
    offered: { patternName: '8/24 OFF', days: [24] },
  }), env, {});

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'MOGIJI_REST_VIOLATION');
  assert.equal((await env.POSTS.get('req:REQ-1', { type: 'json' })).stage, 1);
});

test('mortgage-rest rejection tells the requester the verified rule reason', async () => {
  const original = {
    ...pendingRequest(),
    postId: 'POST-1',
    openRoster: [
      { month: '2026-08', day: 21, type: '국제선' },
      { month: '2026-08', day: 22, type: '국제선' },
      { month: '2026-08', day: 23, type: 'ARRIVAL' },
      { month: '2026-08', day: 24, type: 'OFF' },
    ],
  };
  const post = {
    id: 'POST-1',
    offered: {
      days: [24, 25],
      daySchedules: [
        { month: '2026-08', day: 24, type: '국내선', title: '7C129' },
        { month: '2026-08', day: 25, type: 'OFF', title: 'OFF' },
      ],
    },
  };
  const env = { POSTS: createKv({
    'req:REQ-1': original,
    'post:POST-1': post,
    'idx:requests': [original],
  }) };

  const response = await worker.fetch(api('/api/requests-decline', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
    reason: 'MOGIJI_REST_CONFLICT',
  }), env, {});
  assert.equal(response.status, 200);

  const declined = await env.POSTS.get('req:REQ-1', { type: 'json' });
  assert.equal(declined.declineReason, 'MOGIJI_REST_CONFLICT');
  assert.equal(declined.status, '⚠️ 모기지 휴무 규정 불일치');
  assert.match(declined.declineMsg, /8월 23일 모기지 도착/);
  assert.match(declined.declineMsg, /8월 24일 필수 휴무/);
  assert.match(declined.declineMsg, /7C129/);
  assert.match(declined.declineMsg, /자동 판정/);
});

test('a client cannot falsely label a normal rejection as a rule conflict', async () => {
  const original = pendingRequest();
  const env = { POSTS: createKv({
    'req:REQ-1': original,
    'idx:requests': [original],
  }) };

  const response = await worker.fetch(api('/api/requests-decline', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
    reason: 'MOGIJI_REST_CONFLICT',
  }), env, {});
  assert.equal(response.status, 409);
  assert.equal((await env.POSTS.get('req:REQ-1', { type: 'json' })).declined, undefined);
});
