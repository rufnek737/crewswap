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
const ctx = { state: { currentMonth: '2026-11', schedules: [] } };
vm.createContext(ctx);
vm.runInContext(['parseDayKey', 'areConsecCalendarDays', 'samePatternDayKeys', 'groupConsecutiveDayKeys'].map(fn).join('\n'), ctx);
const M = '2026-11';
const k = d => `${M}-${String(d).padStart(2, '0')}`;
const groups = days => JSON.parse(JSON.stringify(ctx.groupConsecutiveDayKeys(days.map(k)))).map(g => g.map(x => Number(x.slice(8))));

test('퀵턴이 사흘 붙어 있어도 패턴마다 따로 — 글 3개', () => {
  ctx.state.schedules = [
    { month: M, day: 20, patternId: 'P10', type: '국제선', title: '7C1301' },
    { month: M, day: 21, patternId: 'P11', type: '국제선', title: '7C1703' },
    { month: M, day: 22, patternId: 'P12', type: '국제선', title: '7C8503' },
  ];
  assert.deepEqual(groups([20, 21, 22]), [[20], [21], [22]]);
});

test('레이오버 패턴과 연속 RSV 는 한 글로 둔다', () => {
  ctx.state.schedules = [
    { month: M, day: 6, patternId: 'P3', type: '국제선' }, { month: M, day: 7, patternId: 'P3', type: 'LAYOV' },
    { month: M, day: 8, patternId: 'P3', type: '국제선' },
    { month: M, day: 12, patternId: 'P5', type: 'RSV' }, { month: M, day: 13, patternId: 'P5', type: 'RSV' },
  ];
  assert.deepEqual(groups([6, 7, 8, 12, 13]), [[6, 7, 8], [12, 13]]);
});

test('패턴 정보가 없으면 예전처럼 날짜로만 묶는다', () => {
  ctx.state.schedules = [{ month: M, day: 1, patternId: null }, { month: M, day: 2, patternId: null }];
  assert.deepEqual(groups([1, 2]), [[1, 2]]);
});
