/* 차단과 신고.
 *
 * 정책 요건이라 넣은 기능이지만, 요건을 채웠다는 것만으로는 부족하다.
 * 차단이 한 방향으로만 동작하면 차단당한 쪽이 계속 말을 걸 수 있어 차단이 아니다.
 * 그래서 양방향으로 가려지는지, 요청 자체가 막히는지를 본다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { issueSessionToken } from '../worker/index.js';
import { createStore } from '../worker/store.js';
import { createTestD1 } from './helpers/d1.mjs';

async function runtime() {
  const DB = createTestD1();
  const env = {
    DB, POSTS: { get: async () => null },
    AUTH_SECRET: 'local-test-auth', VERIFY_SECRET: 'local-test-verify', BETA_ALL_PREMIUM: 'true',
  };
  const store = createStore(DB);
  for (const email of ['owner@jejuair.net', 'a@jejuair.net', 'b@jejuair.net'])
    await store.put(`user:${email}`, JSON.stringify({ email, profile: { roleType: 'FO_C', crewType: 'PILOT' } }));
  const call = async (path, email, body) => {
    const token = email ? await issueSessionToken(env, email) : null;
    return worker.fetch(new Request(`https://test.invalid/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, {});
  };
  return { env, store, call };
}

const samplePost = (id = 'P1', ownerEmail = 'owner@jejuair.net') => ({
  id, ownerEmail, ownerRole: 'FO_C', deleteToken: 'test', status: 'active',
  offered: { days: [], patternName: 'Test', summary: 'Test', type: 'OFF' }, wanted: {},
});

async function listedIds(call, email) {
  const res = await call('posts-get', email);
  return ((await res.json()).posts || []).map(p => p.id);
}

test('차단하면 그 사람 글이 목록에서 사라진다', async () => {
  const { store, call } = await runtime();
  await store.put('post:P1', JSON.stringify(samplePost()));

  assert.deepEqual(await listedIds(call, 'a@jejuair.net'), ['P1']);
  const set = await call('blocks-set', 'a@jejuair.net', { postId: 'P1' });
  assert.equal(set.status, 200);
  assert.deepEqual(await listedIds(call, 'a@jejuair.net'), []);
});

test('차단은 양방향이다 — 차단당한 쪽에서도 안 보인다', async () => {
  const { store, call } = await runtime();
  await store.put('post:P1', JSON.stringify(samplePost('P1', 'a@jejuair.net')));

  // owner 가 a 를 차단한다. P1 의 주인이 a 다.
  await call('blocks-set', 'owner@jejuair.net', { postId: 'P1' });
  // 차단한 owner 에게 안 보이는 것은 당연하고,
  assert.deepEqual(await listedIds(call, 'owner@jejuair.net'), []);
  // 차단당한 a 에게도 owner 의 글이 보이면 안 된다.
  await store.put('post:P2', JSON.stringify(samplePost('P2', 'owner@jejuair.net')));
  assert.deepEqual(await listedIds(call, 'a@jejuair.net'), ['P1']);
});

test('차단한 상대에게는 요청을 보낼 수 없다', async () => {
  const { store, call } = await runtime();
  await store.put('post:P1', JSON.stringify(samplePost()));
  await call('blocks-set', 'a@jejuair.net', { postId: 'P1' });

  const res = await call('requests-create', 'a@jejuair.net', { postId: 'P1', fromNick: '테스터', type: 'request', offered: { days: [] } });
  assert.equal(res.status, 403);
});

test('차단은 해제된다', async () => {
  const { store, call } = await runtime();
  await store.put('post:P1', JSON.stringify(samplePost()));
  await call('blocks-set', 'a@jejuair.net', { postId: 'P1' });
  assert.deepEqual(await listedIds(call, 'a@jejuair.net'), []);

  await call('blocks-set', 'a@jejuair.net', { postId: 'P1', blocked: false });
  assert.deepEqual(await listedIds(call, 'a@jejuair.net'), ['P1']);
});

test('차단 목록에는 이메일이 아니라 닉네임과 해제용 id 만 나온다', async () => {
  const { store, call } = await runtime();
  await store.put('post:P1', JSON.stringify({ ...samplePost(), fromNick: '김제주' }));
  await call('blocks-set', 'a@jejuair.net', { postId: 'P1', nick: '김제주' });

  const { blocked } = await (await call('blocks-get', 'a@jejuair.net')).json();
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].nick, '김제주');
  assert.ok(blocked[0].id, '해제용 id 가 있어야 한다');
  assert.equal(JSON.stringify(blocked).includes('@'), false, '이메일이 새면 안 된다');

  // 그 id 로 해제된다.
  await call('blocks-set', 'a@jejuair.net', { id: blocked[0].id, blocked: false });
  assert.deepEqual((await (await call('blocks-get', 'a@jejuair.net')).json()).blocked, []);
});

test('자기 자신은 차단할 수 없다', async () => {
  const { store, call } = await runtime();
  await store.put('post:PA', JSON.stringify(samplePost('PA', 'a@jejuair.net')));
  const res = await call('blocks-set', 'a@jejuair.net', { postId: 'PA' });
  assert.equal(res.status, 400);
});

test('신고가 저장된다', async () => {
  const { store, call } = await runtime();
  const res = await call('report-create', 'a@jejuair.net', {
    targetType: 'post', targetId: 'P1', targetEmail: 'owner@jejuair.net',
    reason: 'harassment', detail: '부적절한 문구',
  });
  assert.equal(res.status, 200);
  const { id } = await res.json();
  const saved = await store.get(`report:${id}`, { type: 'json' });
  assert.equal(saved.reporterEmail, 'a@jejuair.net');
  assert.equal(saved.targetEmail, 'owner@jejuair.net');
  assert.equal(saved.reason, 'harassment');
  assert.equal(saved.status, 'open');
});

test('사유가 목록에 없으면 신고를 받지 않는다', async () => {
  const { call } = await runtime();
  const res = await call('report-create', 'a@jejuair.net', { targetType: 'post', targetId: 'P1', reason: 'whatever' });
  assert.equal(res.status, 400);
});

test('로그인하지 않으면 차단도 신고도 못 한다', async () => {
  const { call } = await runtime();
  assert.equal((await call('blocks-set', null, { postId: 'P1' })).status, 401);
  assert.equal((await call('report-create', null, { targetType: 'post', targetId: 'P1', reason: 'spam' })).status, 401);
});
