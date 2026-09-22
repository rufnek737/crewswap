// 누적 한도 — 연속 28일 승무시간 100h, 연속 7일 근무 60h, 연속 28일 근무 190h.
//
// 값은 FOM 비행근무시간 제한 표와 대조해 맞다. 문제는 데이터가 없을 때의 답이었다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../duty-limits.js');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('한도 값이 규정 표와 같다', () => {
  assert.match(app, /consecutive28dLimit: 100/);  // 연속 28일 승무시간 (2인 편조)
  assert.match(app, /duty7dLimit: 60/);           // 연속 7일 근무시간
  assert.match(app, /duty28dLimit: 190/);         // 연속 28일 근무시간
});

test('승무시간이 없는 비행이 섞이면 통과라고 하지 않는다', () => {
  // 붙여넣기로 불러온 근무표에는 BLH 가 없어 모든 비행이 0h 로 통과하고 있었다.
  // 날짜는 다 있으니 창은 덮이고 합계만 낮게 나온다 — 가장 나쁜 종류의 오답이다.
  assert.match(app, /const blhMissing = entries\.some/);
  assert.match(app, /승무시간\(BLH\)이 없는 비행이 있습니다/);
});

test('근무시간 검사는 BLH 와 무관하다', () => {
  // 근무시간은 출두~해제 시각으로 재므로 BLH 가 없어도 판정할 수 있다.
  assert.match(app, /const isFlightTime = r\.minutes === flightMinutesOf/);
});

test('창을 덮지 못하면 통과가 아니라 확인 불가다', () => {
  const entries = [{ month: '2026-10', day: 1 }, { month: '2026-10', day: 2 }];
  const r = L.check({ entries, minutesOf: () => 60, windowDays: 28, limitHours: 100 });
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.reason, 'short-range');
});

test('창을 덮으면 최대 합계로 판정한다', () => {
  // 28일 창을 굴려 가장 많이 쌓인 구간을 찾는다. 달력상의 월이 아니다.
  const entries = Array.from({ length: 40 }, (_, i) => ({ month: '2026-10', day: i + 1 }));
  const r = L.check({ entries, minutesOf: () => 4 * 60, windowDays: 28, limitHours: 100 });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.hours, 112);   // 28일 × 4h
});
