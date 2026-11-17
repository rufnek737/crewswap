// 받은 요청에 답이 없으면 2일 뒤 한 번만 다시 알린다. 끝난 글이면 알리지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { remindStalledRequests, requestArrivalMessage } from '../worker/index.js';

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, o) { const v = values.get(key); return v == null ? null : o?.type === 'json' ? JSON.parse(v) : v; },
    async put(key, v) { values.set(key, String(v)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const NOW = Date.parse('2026-11-17T01:00:00Z');
const req = (id, extra) => ({ id, postId: 'P1', type: 'ask', status: '상대가 바꿀 날 고르는 중', toEmail: 'owner@jejuair.net', fromNick: '하준', postTitle: '11/25 국내선', createdAt: '2026-11-14T00:00:00Z', ...extra });

test('2일 지난 요청은 한 번만 표시하고, 다시 돌려도 또 보내지 않는다', async () => {
  const r = req('R1');
  const env = { POSTS: createKv({ 'req:R1': r, 'idx:requests': [r], 'post:P1': { id: 'P1', status: 'active', deadlineMonth: '2099-01', deadlineDay: 1 } }) };
  await remindStalledRequests(env, NOW);
  const after = await env.POSTS.get('req:R1', { type: 'json' });
  assert.ok(after.remindedAt);
  const idx = await env.POSTS.get('idx:requests', { type: 'json' });
  assert.ok(idx[0].remindedAt);
  await remindStalledRequests(env, NOW + 864e5);
  assert.equal((await env.POSTS.get('req:R1', { type: 'json' })).remindedAt, after.remindedAt);
});

test('하루밖에 안 된 요청과 이미 진행된 요청은 건드리지 않는다', async () => {
  const fresh = req('R2', { createdAt: '2026-11-16T12:00:00Z' });
  const done = req('R3', { status: '✅ 회사 상신 완료' });
  const env = { POSTS: createKv({ 'req:R2': fresh, 'req:R3': done, 'idx:requests': [fresh, done] }) };
  await remindStalledRequests(env, NOW);
  assert.equal((await env.POSTS.get('req:R2', { type: 'json' })).remindedAt, undefined);
  assert.equal((await env.POSTS.get('req:R3', { type: 'json' })).remindedAt, undefined);
});

test('도착 알림 문구는 의향과 요청을 구분하고 이메일을 담지 않는다', () => {
  const ask = requestArrivalMessage(req('R4'));
  assert.match(ask.title, /양도 의향/);
  assert.doesNotMatch(JSON.stringify(ask), /@/);
  assert.match(requestArrivalMessage(req('R5', { type: 'request' })).title, /스왑 요청/);
});
