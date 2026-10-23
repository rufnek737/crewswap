// 글을 나누는 기준 — 날짜가 붙어 있어도 패턴이 다르면 따로 (2026-10-23).
// 실제 글: 11/20 7C1301, 11/21 7C1703, 11/22 7C8503 퀵턴 3일이 한 글·1크레딧으로 묶이고
// 편조는 첫날 것만 보였다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const fn = name => { const i = app.indexOf(`function ${name}(`); let d = 0;
  for (let k = app.indexOf('{', i); k < app.length; k++) { if (app[k] === '{') d++; else if (app[k] === '}' && !--d) return app.slice(i, k + 1); } };
const ctx = { state: { currentMonth: '2026-11', schedules: [], user: { base: 'GMP' } }, SEOUL_BASES: ['GMP', 'ICN'] };
vm.createContext(ctx);
vm.runInContext(['parseDayKey', 'dayKey', 'areConsecCalendarDays', 'myBaseAirports', 'lastArrivalOf', 'samePatternDayKeys', 'groupConsecutiveDayKeys', 'dateKeyShift', 'tripKeysOf', 'partialTripCheck'].map(fn).join('\n'), ctx);
const M = '2026-11';
const k = d => `${M}-${String(d).padStart(2, '0')}`;
const groups = days => JSON.parse(JSON.stringify(ctx.groupConsecutiveDayKeys(days.map(k)))).map(g => g.map(x => Number(x.slice(8))));

test('퀵턴이 사흘 붙어 있어도 날마다 따로 — 글 3개 (인천·김포 복귀 모두 베이스)', () => {
  ctx.state.schedules = [
    { month: M, day: 20, type: '국제선', routeSummary: 'ICN→KIX→ICN' },
    { month: M, day: 21, type: '국제선', routeSummary: 'ICN→MYJ→ICN' },
    { month: M, day: 22, type: '국내선', routeSummary: 'GMP→CJU→GMP' },
  ];
  assert.deepEqual(groups([20, 21, 22]), [[20], [21], [22]]);
});

test('부산 레이오버(김포 베이스)는 한 글 — 근무표 패턴 번호가 날마다 달라도', () => {
  // 실제 Kay 근무표: P10·P11·P12 로 따로 저장돼 있었다.
  ctx.state.schedules = [
    { month: '2026-10', day: 15, patternId: 'P10', type: '국내선', routeSummary: 'GMP→CJU→PUS→CJU→PUS→PUS', arr: 'PUS' },
    { month: '2026-10', day: 16, patternId: 'P11', type: '국제선', routeSummary: 'PUS→KIX→PUS→PUS' },
    { month: '2026-10', day: 17, patternId: 'P12', type: '국내선', routeSummary: 'PUS→CJU→GMP' },
  ];
  const g = JSON.parse(JSON.stringify(ctx.groupConsecutiveDayKeys(['2026-10-15', '2026-10-16', '2026-10-17'])));
  assert.equal(g.length, 1);
});

test('부산 베이스 승무원에게 부산 복귀는 퀵턴', () => {
  ctx.state.user.base = 'PUS';
  ctx.state.schedules = [
    { month: M, day: 3, type: '국제선', routeSummary: 'PUS→KIX→PUS' },
    { month: M, day: 4, type: '국제선', routeSummary: 'PUS→NRT→PUS' },
  ];
  assert.deepEqual(groups([3, 4]), [[3], [4]]);
  ctx.state.user.base = 'GMP';
});

test('레이오버 패턴과 연속 RSV 는 한 글로 둔다', () => {
  ctx.state.schedules = [
    { month: M, day: 6, type: '국제선', routeSummary: 'ICN→DPS' }, { month: M, day: 7, type: 'LAYOV' },
    { month: M, day: 8, type: '국제선', routeSummary: 'DPS→ICN' },
    { month: M, day: 12, type: 'RSV' }, { month: M, day: 13, type: 'RSV' },
  ];
  assert.deepEqual(groups([6, 7, 8, 12, 13]), [[6, 7, 8], [12, 13]]);
});

test('베이스를 모르면 예전처럼 날짜로만 묶는다', () => {
  ctx.state.user.base = '';
  ctx.state.schedules = [{ month: M, day: 1, type: '국제선', routeSummary: 'ICN→KIX→ICN' }, { month: M, day: 2, type: '국제선', routeSummary: 'ICN→KIX→ICN' }];
  assert.deepEqual(groups([1, 2]), [[1, 2]]);
  ctx.state.user.base = 'GMP';
});

test('퀵턴 다음날 RSV, 신체검사 다음날 레이오버 출발은 따로', () => {
  ctx.state.schedules = [
    { month: M, day: 12, type: '국제선', routeSummary: 'ICN→NRT→ICN' }, { month: M, day: 13, type: 'RSV' },
    { month: M, day: 7, type: 'GND', title: '신체검사' }, { month: M, day: 8, type: '국제선', routeSummary: 'ICN→DPS→DPS' },
    { month: M, day: 9, type: '국제선', routeSummary: 'DPS→ICN' }, { month: M, day: 10, type: 'ARRIVAL' },
  ];
  assert.deepEqual(groups([7, 8, 9, 10, 12, 13]), [[7], [8, 9, 10], [12], [13]]);
});

test('부산 레이오버 14~16 중 15·16만 고르면 막는다, 전체를 고르면 통과', () => {
  ctx.state.user.base = 'GMP';
  ctx.state.schedules = [
    { month: M, day: 13, type: '국제선', routeSummary: 'ICN→HIJ→ICN' },
    { month: M, day: 14, type: '국내선', routeSummary: 'GMP→CJU→CJJ→CJU→PUS→PUS' },
    { month: M, day: 15, type: '국제선', routeSummary: 'PUS→NRT→PUS→PUS' },
    { month: M, day: 16, type: '국내선', routeSummary: 'PUS→CJU→GMP' },
    { month: M, day: 17, type: 'OFF' },
  ];
  ctx.state.selectedDays = new Set([k(15), k(16)]);
  let r = ctx.partialTripCheck();
  assert.equal(r.status, 'FAIL'); assert.equal(r.blocking, true);
  assert.match(r.detail, /11\/14~11\/16 패턴 전체/);
  ctx.state.selectedDays = new Set([k(14)]);
  assert.equal(ctx.partialTripCheck().status, 'FAIL');
  ctx.state.selectedDays = new Set([k(14), k(15), k(16)]);
  assert.equal(ctx.partialTripCheck().status, 'PASS');
  ctx.state.selectedDays = new Set([k(13)]);                 // 앞날 퀵턴은 트립에 안 붙는다
  assert.equal(ctx.partialTripCheck().status, 'PASS');
});

test('해외 레이오버(발리) 일부만 고르면 막는다, 퀵턴 하루는 통과', () => {
  ctx.state.schedules = [
    { month: M, day: 8, type: '국제선', routeSummary: 'ICN→DPS→DPS' },
    { month: M, day: 9, type: '국제선', title: 'DPS-ICN', dep: 'DPS', arr: 'ICN' },
    { month: M, day: 10, type: 'ARRIVAL' },
    { month: M, day: 11, type: '국제선', routeSummary: 'ICN→KIX→ICN' },
    { month: M, day: 12, type: '국제선', routeSummary: 'ICN→NRT→ICN' },
  ];
  ctx.state.selectedDays = new Set([k(8), k(9)]);
  assert.equal(ctx.partialTripCheck().status, 'FAIL');        // 도착일(10) 빠짐
  ctx.state.selectedDays = new Set([k(8), k(9), k(10)]);
  assert.equal(ctx.partialTripCheck().status, 'PASS');
  ctx.state.selectedDays = new Set([k(12)]);                  // 퀵턴 하루
  assert.equal(ctx.partialTripCheck().status, 'PASS');
});
