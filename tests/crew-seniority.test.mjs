// 사번 → 입사 연월. 입사일을 따로 받지 않기 위한 유도라, 잘못 읽으면
// 자격 판정이 통째로 틀어진다. 실제 사번 형태로 확인한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const seniority = require('../crew-seniority.js');

const NOW = new Date('2026-09-05T00:00:00Z');

test('사번 앞 4자리가 입사 연월이다', () => {
  assert.deepEqual(seniority.hireYearMonth('1707007'), { year: 2017, month: 7 });
  assert.deepEqual(seniority.hireYearMonth('1602001'), { year: 2016, month: 2 });
});

test('근속 개월과 연차를 센다', () => {
  // 2017년 7월 → 2026년 9월 = 110개월
  assert.equal(seniority.monthsOfService('1707007', NOW), 110);
  assert.equal(seniority.serviceYear('1707007', NOW), 10);   // 입사 첫 해가 1년차
  assert.equal(seniority.serviceYear('2609001', NOW), 1);    // 이번 달 입사 = 1년차
});

test('AL 13개월 · AR 6개월 자격을 판정한다', () => {
  const recent = '2604001';                                   // 2026년 4월 입사 = 5개월
  assert.equal(seniority.meetsMonths(recent, 6, NOW), false); // AR 미충족
  assert.equal(seniority.meetsMonths(recent, 13, NOW), false);// AL 미충족
  assert.equal(seniority.meetsMonths('2503001', 13, NOW), true);
});

test('사번을 못 읽으면 막지 않고 판정 불가로 둔다', () => {
  // 형식이 다른 사번을 자격 미달로 처리하면 멀쩡한 사람이 기능을 못 쓴다.
  for (const bad of ['', null, undefined, '12', 'ABCD123', '1799001']) {   // 99월은 없음
    assert.equal(seniority.hireYearMonth(bad), null, String(bad));
    assert.equal(seniority.meetsMonths(bad, 6, NOW), null, String(bad));
  }
});

test('설립(2005년) 이전 연도나 미래 사번은 읽지 않는다', () => {
  assert.equal(seniority.hireYearMonth('0412001'), null);      // 2004년
  assert.equal(seniority.monthsOfService('2712001', NOW), null); // 2027년 = 미래
});

test('화면에 쓸 문구를 만든다', () => {
  assert.equal(seniority.label('1707007', NOW), '2017년 7월 입사 · 10년차');
  assert.equal(seniority.label('오류', NOW), null);
});
