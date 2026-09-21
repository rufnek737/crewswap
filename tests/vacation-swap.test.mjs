// 휴가는 남에게 넘길 수 없다 — 운항·객실 양쪽에서 막힌다.
//
// 규칙표에 changeableTypes: ["OFF","VAC"] 가 있었지만 읽는 코드가 없어, 실제로는 휴가를
// 올려 남과 바꿀 수 있었다. Kay가 2026-09-22 에 짚었다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/* app.js 는 모듈이 아니라 전역 스크립트다. 검사 함수만 떼어내 실제로 돌려본다 —
   소스에 문구가 있는지만 보면 판정이 맞는지는 알 수 없다. */
function loadCheck() {
  const types = app.match(/const VACATION_TYPES = new Set\(\[[^\]]*\]\);/)[0];
  const fn = app.match(/function vacationCheck\(ss\) \{[\s\S]*?\n\}/)[0];
  return new Function(`${types}\n${fn}\nreturn vacationCheck;`)();
}

test('휴가가 섞이면 불가다', () => {
  const check = loadCheck();
  const r = check([{ day: 21, type: '국제선' }, { day: 22, type: 'VAC' }]);
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /22일/);
});

test('추가 연차 코드도 막는다', () => {
  // VAC_A 전일 배정 추가 연차 / VAC_P 단기 추가 연차
  const check = loadCheck();
  for (const type of ['VAC', 'VAC_A', 'VAC_P', 'vac']) {
    assert.equal(check([{ day: 1, type }]).status, 'FAIL', `${type} 는 교환 불가다`);
  }
});

test('휴가가 없으면 통과한다', () => {
  const check = loadCheck();
  const r = check([{ day: 1, type: '국내선' }, { day: 2, type: 'OFF' }]);
  assert.equal(r.status, 'PASS');
});

test('OFF 는 막지 않는다', () => {
  // 휴무는 서로 바꿀 수 있다. 막히는 것은 본인에게 부여된 휴가뿐이다.
  assert.equal(loadCheck()([{ day: 1, type: 'OFF' }]).status, 'PASS');
});

test('운항·객실 두 목록 모두에서 검사한다', () => {
  // 한쪽에만 넣으면 직종에 따라 휴가가 새어 나간다.
  // 정의부(function vacationCheck)는 빼고 호출부만 센다.
  assert.equal((app.match(/^\s*vacationCheck\(ss\),$/gm) || []).length, 2);
});

test('규정 근거에 조항 번호나 쪽 번호를 쓰지 않는다', () => {
  const fn = app.match(/function vacationCheck\(ss\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(fn, /p\.\d+|FOM \d/);
});
