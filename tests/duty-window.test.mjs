// 연속 24시간 승무시간 한도 검사.
// 2026-08-31 실제 반려("연속 24시간내 승무시간 초과")로 드러난 구멍을 막는 로직이라,
// 그 반려 상황을 그대로 재현하는 케이스를 기준으로 삼는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { check, worstWindow } = require('../duty-window.js');

const M = '2026-09';
const flight = (day, title, reportTime, blockMinutes, month = M) =>
  ({ month, day, title, type: '국제선', reportTime, blockMinutes });

test('24시간 안에 겹치는 두 비행의 승무시간을 합산한다', () => {
  // 10일 11:05 출두 3h + 11일 09:06 출두 4h57 → 두 출발이 22시간 간격이라 한 창에 든다
  const entries = [
    flight(10, '7C1703', '11:05', 180),
    flight(11, '7C2211', '09:06', 297),
  ];
  const worst = worstWindow(entries, M);
  assert.equal(worst.totalMinutes, 477);        // 7시간 57분
  assert.equal(worst.entries.length, 2);

  const r = check(entries, { limitHours: 7, fallbackMonth: M });
  assert.equal(r.status, 'FAIL');               // 7시간 초과
  assert.match(r.detail, /7시간 57분/);
});

test('24시간을 벗어나면 합산하지 않는다', () => {
  // 같은 두 비행이지만 두 번째가 이틀 뒤 → 창이 겹치지 않아 각각 판정
  const entries = [
    flight(10, '7C1703', '11:05', 180),
    flight(12, '7C2211', '09:06', 297),
  ];
  const worst = worstWindow(entries, M);
  assert.equal(worst.totalMinutes, 297);        // 큰 쪽 하나만
  assert.equal(check(entries, { limitHours: 7, fallbackMonth: M }).status, 'PASS');
});

test('경계: 정확히 24시간 뒤 출발은 창에 포함하지 않는다', () => {
  const entries = [
    flight(10, 'A', '09:00', 240),
    flight(11, 'B', '09:00', 240),   // 정확히 24시간 뒤
  ];
  assert.equal(worstWindow(entries, M).totalMinutes, 240);
});

test('한도의 85% 이상이면 WARN, 그 아래면 PASS', () => {
  const warn = check([flight(10, 'A', '09:00', 6 * 60)], { limitHours: 7, fallbackMonth: M });
  assert.equal(warn.status, 'WARN');            // 6h / 7h = 85.7%

  const pass = check([flight(10, 'A', '09:00', 4 * 60)], { limitHours: 7, fallbackMonth: M });
  assert.equal(pass.status, 'PASS');
});

test('승무시간이 없는 근무(OFF·RSV)는 합산 대상에서 빠진다', () => {
  const entries = [
    { month: M, day: 11, type: 'RSV', title: 'RSV', reportTime: '00:00', blockMinutes: 0 },
    { month: M, day: 11, type: 'OFF', title: 'OFF' },
    flight(11, '7C2211', '09:06', 297),
  ];
  assert.equal(worstWindow(entries, M).totalMinutes, 297);
});

test('승무시간 정보가 아예 없으면 통과가 아니라 판정 불가로 알린다', () => {
  // "검사하지 않은 것"을 "충족"으로 보이게 한 것이 이번 반려의 원인이었다
  const r = check([{ month: M, day: 11, type: 'RSV', title: 'RSV' }], { limitHours: 7, fallbackMonth: M });
  assert.equal(r.status, 'NA');
  assert.match(r.detail, /판정할 수 없습니다/);
});

test('월이 달라도 앞뒤 관계를 유지해 창을 계산한다', () => {
  // 8/31 비행 + 9/1 비행이 24시간 안에 들어오는 경우
  const entries = [
    flight(31, 'A', '20:00', 200, '2026-08'),
    flight(1,  'B', '10:00', 200, '2026-09'),
  ];
  const worst = worstWindow(entries, '2026-09');
  assert.equal(worst.totalMinutes, 400);
  assert.equal(worst.entries.length, 2);
});

test('출두 시각이 없으면 출발 시각으로 창을 잡는다', () => {
  const entries = [
    { month: M, day: 10, title: 'A', departureTime: '09:00', blockMinutes: 240 },
    { month: M, day: 10, title: 'B', departureTime: '18:00', blockMinutes: 180 },
  ];
  assert.equal(worstWindow(entries, M).totalMinutes, 420);
});

test('자정을 넘어가도 날짜가 달라 창을 놓치지 않는다', () => {
  const entries = [
    flight(10, '야간', '23:30', 300),
    flight(11, '다음날', '02:00', 120),   // 실제로는 2.5시간 뒤
  ];
  const worst = worstWindow(entries, M);
  assert.equal(worst.totalMinutes, 420);
  assert.equal(worst.entries.length, 2);
});

test('한도에 정확히 도달하는 것은 적법 — 초과해야 FAIL', () => {
  // FOM 5.5.2.2는 "연속 24시간 동안 최대 승무시간"이라 정확히 한도까지는 허용된다.
  const exact = check([flight(10, 'A', '09:00', 8 * 60)], { limitHours: 8, fallbackMonth: M });
  assert.equal(exact.status, 'WARN');   // 적법하되 여유가 없어 경고

  const over = check([flight(10, 'A', '09:00', 8 * 60 + 1)], { limitHours: 8, fallbackMonth: M });
  assert.equal(over.status, 'FAIL');
});

test('3인 편조(발리)는 12시간 한도를 적용한다', () => {
  // 실제 로스터: 9/6 7C5303L ICN-DPS 7h05(3NC), 9/7 DPS-ICN 7h30(3PC) — 둘 다 crewSet 3.
  // 2인 편조 한도 8h를 씌우면 발리 편도 하나만으로 FAIL이 되어 정상 비행이 통째로 막힌다.
  const bali = { month: M, day: 7, title: 'DPS-ICN', type: '국제선', reportTime: '10:00', blockMinutes: 450, crewSet: 3 };
  const r = check([bali], { limitHours: 8, augmentedLimitHours: 12, fallbackMonth: M });
  assert.equal(r.status, 'PASS');
  assert.equal(r.limitHours, 12);
  assert.match(r.detail, /3인 편조/);

  // 같은 7h30이라도 2인 편조면 8h 한도에 바짝 붙어 경고가 뜬다.
  const twoCrew = check([{ ...bali, crewSet: 2 }], { limitHours: 8, augmentedLimitHours: 12, fallbackMonth: M });
  assert.equal(twoCrew.limitHours, 8);
  assert.equal(twoCrew.status, 'WARN');
});

test('편조가 섞인 창은 더 엄격한 쪽(2인 편조)을 적용한다', () => {
  const entries = [
    { month: M, day: 6, title: 'ICN-DPS', reportTime: '20:00', blockMinutes: 425, crewSet: 3 },
    { month: M, day: 7, title: '국내선', reportTime: '10:00', blockMinutes: 120, crewSet: 2 },
  ];
  const r = check(entries, { limitHours: 8, augmentedLimitHours: 12, fallbackMonth: M });
  assert.equal(r.limitHours, 8);
  assert.equal(r.status, 'FAIL');   // 합계 9h05 > 8h
});

test('편조 정보가 없으면 2인 편조로 보수적으로 판정한다', () => {
  // 로스터의 Capt (PIC) 같은 코드는 crewSet이 비어 있고 실제로 2인 편조다.
  const r = check([flight(10, 'A', '09:00', 9 * 60)], { limitHours: 8, augmentedLimitHours: 12, fallbackMonth: M });
  assert.equal(r.limitHours, 8);
  assert.equal(r.status, 'FAIL');
});
