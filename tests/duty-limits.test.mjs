// 누적 한도(28일·365일 승무시간, 7일·28일 근무시간).
// 값만 RULES에 있고 읽는 코드가 없어서 앱이 "통과"라고 답하던 항목이다.
// 제일 중요한 성질은 "데이터가 없으면 통과라고 하지 않는다"이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../duty-limits.js');

const block = s => s.blockMinutes || 0;
// 2026-09의 day..day 범위를 채운다
const days = (from, to, minutes) => {
  const out = [];
  for (let d = from; d <= to; d++) out.push({ month: '2026-09', day: d, blockMinutes: minutes });
  return out;
};

test('창을 덮을 데이터가 없으면 통과가 아니라 확인 불가다', () => {
  // 10일치로 28일 한도를 "통과"라고 답하면, 앱을 믿은 사람이 규정 위반으로 반려된다.
  const r = L.check({ entries: days(1, 10, 300), minutesOf: block, windowDays: 28, limitHours: 100 });
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.reason, 'short-range');
  assert.equal(r.coveredDays, 10);
  assert.match(L.detailText(r), /확인 불가/);
});

test('근무표가 아예 없어도 확인 불가다', () => {
  const r = L.check({ entries: [], minutesOf: block, windowDays: 7, limitHours: 60 });
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(r.reason, 'no-data');
});

test('창을 덮으면 한도를 실제로 판정한다', () => {
  // 28일 × 3시간 = 84h → 100h 미만
  const ok = L.check({ entries: days(1, 28, 180), minutesOf: block, windowDays: 28, limitHours: 100 });
  assert.equal(ok.status, 'PASS');
  assert.equal(ok.hours, 84);

  // 28일 × 3.6시간 = 100.8h → 초과
  const over = L.check({ entries: days(1, 28, 216), minutesOf: block, windowDays: 28, limitHours: 100 });
  assert.equal(over.status, 'FAIL');
  assert.match(L.detailText(over), /100\.8h \/ 100h/);
});

test('한도에 임박하면 경고한다', () => {
  // 7일 × 7.7시간 = 53.9h → 60h의 89% 이상
  const warn = L.check({ entries: days(1, 7, 462), minutesOf: block, windowDays: 7, limitHours: 60 });
  assert.equal(warn.status, 'WARN');
});

test('창을 굴려 가장 무거운 구간을 찾는다', () => {
  // 앞 7일은 가볍고 뒤 7일이 무겁다 — 평균이 아니라 최대를 봐야 한다
  const entries = [...days(1, 7, 60), ...days(8, 14, 600)];
  const r = L.check({ entries, minutesOf: block, windowDays: 7, limitHours: 60 });
  assert.equal(r.hours, 70);          // 뒤 7일 = 70h
  assert.equal(r.status, 'FAIL');
});

test('같은 날 여러 건은 더한다', () => {
  // 퀵턴 2레그가 각각 한 줄로 들어오는 경우
  const entries = [];
  for (let d = 1; d <= 7; d++) {
    entries.push({ month: '2026-09', day: d, blockMinutes: 300 });
    entries.push({ month: '2026-09', day: d, blockMinutes: 300 });
  }
  const r = L.check({ entries, minutesOf: block, windowDays: 7, limitHours: 60 });
  assert.equal(r.hours, 70);
});

test('달을 넘는 창도 이어서 센다', () => {
  const entries = [
    ...Array.from({ length: 20 }, (_, i) => ({ month: '2026-09', day: 11 + i, blockMinutes: 240 })),
    ...Array.from({ length: 8 },  (_, i) => ({ month: '2026-10', day: 1 + i,  blockMinutes: 240 })),
  ];
  const r = L.check({ entries, minutesOf: block, windowDays: 28, limitHours: 100 });
  assert.equal(r.coveredDays, 28);
  assert.equal(r.hours, 112);
  assert.equal(r.status, 'FAIL');
});

test('날짜를 읽을 수 없는 항목은 무시한다', () => {
  const entries = [...days(1, 7, 300), { month: 'bad', day: 3, blockMinutes: 9999 }, { day: null }];
  const r = L.check({ entries, minutesOf: block, windowDays: 7, limitHours: 60 });
  assert.equal(r.hours, 35);
});
