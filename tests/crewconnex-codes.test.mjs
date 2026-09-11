// CrewConnex 활동코드 분류. 코드 하나를 못 읽으면 그 근무가 통째로 다른 유형이 되고,
// 규정 검사(RSV 다음날 OFF 금지·SIM 훈련 SWAP 차단)가 조용히 빗나간다.
// 2026-09-11에 실제 코드표와 대조해 RSV_F·SA1/SA2·S_L+U가 안 잡히던 것을 고쳤다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function regexIn(marker) {
  // app.js 본문에서 실제 사용 중인 정규식을 그대로 꺼내 검증한다 —
  // 테스트에 사본을 적어두면 본문만 바뀌었을 때 통과해버린다.
  const line = app.split('\n').find(l => l.includes(marker));
  assert.ok(line, `${marker} 를 찾지 못했습니다`);
  const m = line.match(/\/((?:[^/\\]|\\.)+)\/([gimsuy]*)/);
  assert.ok(m, `정규식을 읽지 못했습니다: ${line.trim()}`);
  return new RegExp(m[1], m[2]);
}

test('RSV — 운항승무원 현행 코드 RSV_F를 읽는다', () => {
  const re = regexIn('if (/\\bRSV');
  assert.ok(re.test('RSV_F'), 'RSV_F (2025-07-01부 시행) 를 놓치면 안 된다');
  assert.ok(re.test('RSV'));
  assert.ok(re.test('Reserve'));
  assert.ok(!re.test('SCHLD'));
  assert.ok(!re.test('LAYOV'));
});

test('STBY — 활동코드가 SA1/SA2로만 와도 대기로 본다', () => {
  const re = regexIn('if (/\\bSTBY');
  assert.ok(re.test('SA1'), 'SA1 = Early standby (FLT)');
  assert.ok(re.test('SA2'));
  assert.ok(re.test('STBY SA1'));
  assert.ok(!re.test('SA'), '숫자 없는 SA는 대기 코드가 아니다');
  assert.ok(!re.test('LAYOV'));
});

test('SIM 훈련 — S_L+U(LOFT+UPRT)도 비행 아님으로 본다', () => {
  const re = regexIn('const isSim =');
  assert.ok(re.test('S_L+U'), 'LOFT+UPRT 조합 코드');
  assert.ok(re.test('UPRT'));
  assert.ok(re.test('SIM'));
  assert.ok(re.test('OPC'));
  assert.ok(!re.test('RSV_F'));
  assert.ok(!re.test('LAYOV'));
});
