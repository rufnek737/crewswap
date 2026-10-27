import test from 'node:test';
import assert from 'node:assert/strict';
import rawWorker, { issueSessionToken } from '../worker/index.js';
import { avoidNamesOfRecord, normalizeAvoidName, crewNames, dutyHasPerson, dateKeysOf } from '../worker/avoid-person.mjs';

const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-characters';
const worker = {
  async fetch(request, env, ctx) {
    env.AUTH_SECRET ||= TEST_AUTH_SECRET;
    env.VERIFY_SECRET ||= 'test-verify-secret-at-least-32-characters';
    const url = new URL(request.url);
    const publicPath = ['/api/posts-get', '/api/premium-alert-config'].includes(url.pathname);
    if (publicPath || request.headers.has('Authorization')) return rawWorker.fetch(request, env, ctx);
    let email = url.searchParams.get('email');
    if (!email && request.method !== 'GET') {
      const body = await request.clone().json().catch(() => ({}));
      email = body.email || body.fromEmail || body.ownerEmail;
    }
    if (!email) throw new Error(`테스트 인증 이메일 누락: ${url.pathname}`);
    if (!await env.POSTS.get(`user:${email}`)) await env.POSTS.put(`user:${email}`, JSON.stringify({ email }));
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


// 나만의 편조 알림 (PRO) — 막지 않고 최종 단계 전에 한 번 묻는다. 이름은 응답에 실리지 않는다.

const POSTER = 'poster@jejuair.net', REQUESTER = 'requester@jejuair.net';
const postDuty = { id: 'POST-1', status: 'active', ownerEmail: POSTER, deadlineMonth: '2026-11',
  offered: { days: [20], dateKeys: ['2026-11-20'], type: '국제선' } };
const posterSchedule = { schedules: [{ month: '2026-11', day: 20, type: '국제선', crewComposition: '강경태(Capt), 이운항(FO), 김애경(PUR)' }] };
const authed = async (env, email, path, body) => {
  if (!await env.POSTS.get(`user:${email}`)) await env.POSTS.put(`user:${email}`, JSON.stringify({ email }));
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${await issueSessionToken(env, email)}` };
  return rawWorker.fetch(new Request(`https://example.test${path}`, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers }), env, {});
};
const baseEnv = seed => ({ AUTH_SECRET: TEST_AUTH_SECRET, VERIFY_SECRET: 'test-verify-secret-at-least-32-characters', BETA_ALL_PREMIUM: 'true', POSTS: createKv(seed) });

test('이름은 입력한 그대로, 편조 문자열에서 이름만 뽑는다', () => {
  assert.equal(normalizeAvoidName(' 김정민A '), '김정민A');
  assert.equal(normalizeAvoidName('<b>'), '');
  assert.deepEqual(crewNames('김제주(Capt), 이운항(FO), 김정민A(PUR)'), ['김제주', '이운항', '김정민A']);
  assert.equal(dutyHasPerson(posterSchedule.schedules, ['2026-11-20'], '강경태'), true);
  assert.equal(dutyHasPerson(posterSchedule.schedules, ['2026-11-21'], '강경태'), false);
  assert.equal(dutyHasPerson(posterSchedule.schedules, ['2026-11-20'], ['홍길동', '김애경']), true, '2명 중 한 명만 있어도 알린다');
  assert.deepEqual(avoidNamesOfRecord({ name: '강경태' }), ['강경태'], '예전 1명 기록도 읽는다');
  assert.deepEqual(dateKeysOf({ days: [3], month: '2026-12' }), ['2026-12-03']);
});

test('글 목록: 등록한 분이 있는 글은 표시만 하고 이름은 내려가지 않는다', async () => {
  const env = baseEnv({ 'idx:posts': [postDuty], [`schedule:${POSTER}`]: posterSchedule, [`avoid:${REQUESTER}`]: { name: '강경태' } });
  const res = await authed(env, REQUESTER, '/api/posts-get');
  const text = await res.text();
  const post = JSON.parse(text).posts[0];
  assert.equal(post.avoidBlocked, true);
  assert.doesNotMatch(text, /강경태/, '응답 어디에도 피할 이름이 없어야 한다');
  // 등록 안 한 사람에게는 표시 없음
  const other = JSON.parse(await (await authed(env, 'someone@jejuair.net', '/api/posts-get')).text()).posts[0];
  assert.equal(other.avoidBlocked, undefined);
});

test('최종 승인: 등록한 분이 있으면 한 번 묻고(409), 확인하면 진행된다', async () => {
  const rec = { id: 'REQ-9', postId: 'POST-1', fromEmail: REQUESTER, toEmail: POSTER, stage: 2, posterSelected: true,
    offered: { days: [21], dateKeys: ['2026-11-21'], type: 'OFF' }, openRoster: [{ month: '2026-11', day: 21, type: 'OFF' }] };
  const env = baseEnv({ 'post:POST-1': postDuty, 'req:REQ-9': rec, 'idx:requests': [rec], [`schedule:${POSTER}`]: posterSchedule, [`avoid:${REQUESTER}`]: { name: '강경태' } });
  const first = await authed(env, REQUESTER, '/api/requests-requester-accept', { id: 'REQ-9' });
  assert.equal(first.status, 409);
  const body = await first.json();
  assert.equal(body.code, 'AVOID_PERSON');
  assert.equal(body.error, '등록하신 분과 같은 편조 비행입니다');
  const second = await authed(env, REQUESTER, '/api/requests-requester-accept', { id: 'REQ-9', avoidAck: true });
  assert.equal(second.status, 200);
  assert.equal((await env.POSTS.get('req:REQ-9', { type: 'json' })).stage, 3);
});

test('등록은 최대 2명, 조회는 본인만, 삭제하면 사라진다', async () => {
  const env = baseEnv({});
  assert.equal((await authed(env, REQUESTER, '/api/avoid-set', { names: ['강경태', '김애경'] })).status, 200);
  assert.deepEqual((await (await authed(env, REQUESTER, '/api/avoid-get')).json()).names, ['강경태', '김애경']);
  assert.equal((await authed(env, REQUESTER, '/api/avoid-set', { names: ['가나', '다라', '마바'] })).status, 400);
  assert.deepEqual((await (await authed(env, POSTER, '/api/avoid-get')).json()).names, []);
  await authed(env, REQUESTER, '/api/avoid-set', { names: [] });
  assert.deepEqual((await (await authed(env, REQUESTER, '/api/avoid-get')).json()).names, []);
});
