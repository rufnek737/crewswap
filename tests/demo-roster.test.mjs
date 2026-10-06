/* 안드로이드 자동 백업이 예전 localStorage(데모 근무표 + 로그인 세션)를 되살려, 새로 깐
 * 폰에서 6월 가짜 근무표가 뜬 사고(2026-10-06). 데모는 버리되, 진짜 근무표는 절대
 * 데모로 오인하지 않아야 한다 — 오인하면 그 사람의 스케줄이 사라진다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const pick = re => src.match(re)[0];
const { createMockSchedules, isDemoRoster } = new Function(`
  ${pick(/function createMockSchedules\(\)[\s\S]*?\n}\n/)}
  ${pick(/let _demoRosterKeys = null;[\s\S]*?\n}\n/)}
  return { createMockSchedules, isDemoRoster };
`)();

test('예전 버전이 저장한 데모 근무표는 데모로 본다', () => {
  assert.equal(isDemoRoster(createMockSchedules()), true);
});

test('저장·복원을 거치며 필드가 붙어도 데모로 본다', () => {
  const restored = JSON.parse(JSON.stringify(createMockSchedules()))
    .map(e => ({ ...e, normalizedAt: 1, extra: 'x' }));
  assert.equal(isDemoRoster(restored), true);
});

test('진짜 근무표는 데모가 아니다', () => {
  const real = [
    { month: '2026-10', day: 1, type: '국제선', title: '7C1201' },
    { month: '2026-10', day: 5, type: 'OFF', title: 'OFF' },
  ];
  assert.equal(isDemoRoster(real), false);
});

test('6월 실제 근무표가 데모와 일부 겹쳐도 지우지 않는다', () => {
  const demo = createMockSchedules();
  const realJune = demo.map(e => ({ ...e }));
  realJune[3] = { ...realJune[3], title: '7C9999' };   // 한 건만 달라도 진짜다
  assert.equal(isDemoRoster(realJune), false);
  assert.equal(isDemoRoster(demo.slice(0, 20)), false);  // 개수가 달라도 진짜다
});

test('심사자 계정(9월에 심은 근무표)은 데모로 보지 않는다', () => {
  const review = createMockSchedules().map(e => ({ ...e, month: '2026-09' }));
  assert.equal(isDemoRoster(review), false);
});

test('비었거나 배열이 아니면 데모가 아니다', () => {
  assert.equal(isDemoRoster([]), false);
  assert.equal(isDemoRoster(null), false);
});
