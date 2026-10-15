// 규칙 검사는 "고른 날짜"에 걸치는 구간만 봐야 한다.
// 2026-10-16 실기기: 10/26~28(STBY·RSV)을 골랐는데 연속 24시간 검사가
// "9/26 7C109 + 9/27 PUS-PUS = 7시간 40분"을 보여줬다 — 일(day)만 보고 월을 안 봐서
// 9월 25~29일 근무가 섞여 들어왔다. 누적·휴식 검사는 아예 근무표 전체의 최악 구간을 봤다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const L = require('../duty-limits.js');
const R = require('../rest-window.js');

test('누적 한도: 다른 달의 무거운 구간은 이번 선택에 걸리지 않는다', () => {
  const entries = [];
  // 9월 1~7일은 매일 10시간 근무(7일 70h — 60h 초과), 그 뒤로는 하루 2시간.
  for (let d = 1; d <= 30; d++) entries.push({ month: '2026-09', day: d, dutyMinutes: d <= 7 ? 600 : 120 });
  for (let d = 1; d <= 31; d++) entries.push({ month: '2026-10', day: d, dutyMinutes: 120 });
  const args = { entries, minutesOf: e => e.dutyMinutes, windowDays: 7, limitHours: 60 };

  assert.equal(L.check(args).status, 'FAIL');   // 전체로 보면 9월 초가 걸린다
  const focused = L.check({ ...args, focusEntries: [{ month: '2026-10', day: 26 }, { month: '2026-10', day: 28 }] });
  assert.equal(focused.status, 'PASS');          // 10월 말 선택과는 무관하다
  const septFocus = L.check({ ...args, focusEntries: [{ month: '2026-09', day: 3 }] });
  assert.equal(septFocus.status, 'FAIL');        // 그 구간을 고르면 여전히 잡는다
});

test('휴식: 다른 달의 휴식 부족은 이번 선택에 걸리지 않는다', () => {
  const duty = (month, day, ci, co) => ({ month, day, reportTime: ci, releaseTime: co });
  const entries = [];
  // 9월 1~10일 매일 06:00~22:00 근무 → 30시간 휴식 없음
  for (let d = 1; d <= 10; d++) entries.push(duty('2026-09', d, '06:00', '22:00'));
  // 10월은 이틀 일하고 이틀 쉼
  for (let d = 1; d <= 31; d++) if (d % 4 === 1 || d % 4 === 2) entries.push(duty('2026-10', d, '09:00', '17:00'));

  assert.equal(R.check(entries).status, 'FAIL');
  assert.equal(R.check(entries, { focusEntries: [{ month: '2026-10', day: 26 }] }).status, 'PASS');
  assert.equal(R.check(entries, { focusEntries: [{ month: '2026-09', day: 5 }] }).status, 'FAIL');
});

test('연속 24시간 검사의 앞뒤 근무는 월까지 맞춰 고른다', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function consecutive24hCheck'), src.indexOf('function vacationCheck'));
  assert.doesNotMatch(body, /days\.has\(Number\(s\.day\)\)/);   // 일(day)만 비교하던 코드
  assert.match(body, /dateIndex/);
});

test('규칙 검사에 선택 범위를 넘긴다', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(src, /cumulativeLimitChecks\(rules, ss\)/);
  assert.match(src, /restWindowCheck\(ss\)/);
  assert.match(src, /focusEntries: withMonth\(ss\)/);
});

test('연속 24시간: 앞뒤까지 근무표가 있고 비행이 없으면 통과, 비어 있으면 판정 불가', () => {
  const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function consecutive24hCheck'), src.indexOf('function vacationCheck'));
  assert.match(body, /result\.status === "NA" && covered && !hasFlight/);
});
