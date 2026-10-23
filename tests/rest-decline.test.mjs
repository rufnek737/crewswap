// 휴식시간 부족으로 거절할 때 상대에게 「개인적 사정」 대신 날짜·사유가 가야 한다(2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
const start = src.indexOf('async function handleRequestsDecline');
let d = 0, end = start;
for (let k = src.indexOf('{', start); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && !--d) { end = k + 1; break; } }
const store = new Map();
const ctx = {
  json: (body, status = 200) => ({ body, status }),
  updateRequestsIndexEntry: async () => {},
  validateMogijiExchange: () => null,
};
vm.createContext(ctx);
vm.runInContext(src.slice(start, end), ctx);
const env = { POSTS: {
  get: async k => store.get(k) ? JSON.parse(store.get(k)) : null,
  put: async (k, v) => store.set(k, v), delete: async k => store.delete(k) } };
const call = body => ctx.handleRequestsDecline({ json: async () => body }, env, 'me@x');

test('휴식 부족 거절은 내 일정 날짜와 함께, 상대 일정 문제는 아니라고 보낸다', async () => {
  store.set('req:1', JSON.stringify({ id: '1', toEmail: 'me@x' }));
  const r = await call({ id: '1', reason: 'REST_CONFLICT', conflict: { kind: 'rest', month: 11, day: 14 } });
  assert.equal(r.status, 200);
  const rec = JSON.parse(store.get('req:1'));
  assert.equal(rec.declineReason, 'REST_CONFLICT');
  assert.equal(rec.declineMsg, '요청하신 근무를 제가 받으면 제 11/14 근무와의 휴식시간이 규정보다 짧아져 진행할 수 없습니다. 보내주신 일정에는 문제가 없습니다.');
});

test('내 쪽 모기지 휴무 충돌', async () => {
  store.set('req:4', JSON.stringify({ id: '4', toEmail: 'me@x' }));
  await call({ id: '4', reason: 'REST_CONFLICT', conflict: { kind: 'mogiji', month: 11, day: 24 } });
  assert.match(JSON.parse(store.get('req:4')).declineMsg, /제 11\/24 근무가 모기지 필수 휴무와 겹쳐/);
});

test('날짜가 이상하면 날짜 없이 보낸다', async () => {
  store.set('req:5', JSON.stringify({ id: '5', toEmail: 'me@x' }));
  await call({ id: '5', reason: 'REST_CONFLICT', conflict: { kind: 'rest', month: 13, day: '<b>' } });
  assert.match(JSON.parse(store.get('req:5')).declineMsg, /^요청하신 근무를 제가 받으면 제 근무와의/);
});

test('일반 거절은 그대로 개인 사정 문구', async () => {
  store.set('req:3', JSON.stringify({ id: '3', toEmail: 'me@x' }));
  await call({ id: '3' });
  assert.match(JSON.parse(store.get('req:3')).declineMsg, /개인적 사정/);
});

test('앱은 휴식 부족일 때 「규정 불일치로 거절」 버튼을 띄운다', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /data-decline-reason="REST_CONFLICT"/);
  assert.match(app, /restDeclineInfo \? "규정 불일치로 거절" : "거절"/);
});
