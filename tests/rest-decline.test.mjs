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

test('휴식 부족 거절은 날짜와 시간을 담아 보낸다', async () => {
  store.set('req:1', JSON.stringify({ id: '1', toEmail: 'me@x' }));
  const r = await call({ id: '1', reason: 'REST_CONFLICT', restInfo: { side: 'after', label: '14일 7C107', gapMin: 365, needMin: 660 } });
  assert.equal(r.status, 200);
  const rec = JSON.parse(store.get('req:1'));
  assert.equal(rec.declineReason, 'REST_CONFLICT');
  assert.match(rec.declineMsg, /직후 근무\(14일 7C107\)까지 휴식이 6시간 5분뿐이라 최소 11시간에 못 미쳐/);
  assert.match(rec.declineMsg, /개인적인 사유가 아닌 휴식시간 규정/);
});

test('부족하지 않은 값이나 이상한 값은 받지 않는다', async () => {
  store.set('req:2', JSON.stringify({ id: '2', toEmail: 'me@x' }));
  const r = await call({ id: '2', reason: 'REST_CONFLICT', restInfo: { side: 'after', label: '<b>x</b>', gapMin: 700, needMin: 660 } });
  assert.equal(r.status, 400);
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
