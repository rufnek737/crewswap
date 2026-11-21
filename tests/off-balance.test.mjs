import test from 'node:test';
import assert from 'node:assert/strict';
import { offBalance } from '../worker/off-balance.mjs';

const r = (...xs) => xs.map(([day, type]) => ({ month: '2026-12', day, type }));
const k = d => `2026-12-${String(d).padStart(2, '0')}`;

test('같은 날 비행↔비행은 OFF 변화 없음', () => {
  assert.deepEqual(offBalance(r([5, '국제선']), r([5, '국내선']), [k(5)], [k(5)]), { aDelta: 0, bDelta: 0 });
});
test('내 OFF 를 주고 상대 비행을 받으면 내 OFF 가 하나 준다', () => {
  // A: 4일 OFF, 31일 OFF / B: 4일 OFF, 31일 비행. A 가 4일(OFF)을 주고 B 의 31일 비행을 받음
  const res = offBalance(r([4, 'OFF'], [31, 'OFF']), r([4, 'OFF'], [31, '국제선']), [k(4)], [k(31)]);
  assert.equal(res.aDelta, -1);
  assert.equal(res.bDelta, 1);
});
test('비행을 주고 OFF 날 비행을 받으면 맞교환', () => {
  // A: 24일 비행, 31일 OFF / B: 24일 OFF, 31일 비행 — A 24 ↔ B 31
  const res = offBalance(r([24, '국제선'], [31, 'OFF']), r([24, 'OFF'], [31, '국제선']), [k(24)], [k(31)]);
  assert.deepEqual(res, { aDelta: 0, bDelta: 0 });
});
