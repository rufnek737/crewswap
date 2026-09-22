// 등급에 따른 비행편조 — 판정 대상은 "내가 가져올 비행의 반대 좌석"이다.
//
// Kay가 짚었다: "실제로 규정은 편조인원에 대한 등급이 문제인데." 그 전까지는 글쓴이와 내
// 등급을 견주고 있었고, 그건 규정이 아니었다.
//
// 그리고 등급은 지어내지 않는다. 파서가 모든 비행에 captainGrade:"B", foGrade:"B" 를 박아
// 넣고 있어서, C등급 기장에게 "B등급 부기장이라 불가"라는 근거 없는 차단이 떴다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import gradePolicy from '../grade-policy.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

test('등급을 모르면 A등급만 통과하고 B·C는 확인이 필요하다', () => {
  assert.equal(gradePolicy.pairs('CAPTAIN_A', null), true);
  assert.equal(gradePolicy.pairs('FO_A', null), true);
  assert.equal(gradePolicy.pairs('CAPTAIN_B', null), null);
  assert.equal(gradePolicy.pairs('CAPTAIN_C', null), null);
});

test('등급을 알면 표대로 막는다', () => {
  assert.equal(gradePolicy.pairs('CAPTAIN_C', 'B'), false);
  assert.equal(gradePolicy.pairs('CAPTAIN_C', 'A'), true);
});

test('판정은 글쓴이가 아니라 그 글의 비행을 본다', () => {
  // postGradeCheck 이 post.offered 의 반대 좌석 등급을 읽어야 한다.
  assert.match(app, /post\?\.offered\?\.foGrade\s*:\s*post\?\.offered\?\.captainGrade/);
});

test('등급을 지어내지 않는다', () => {
  // 파서가 박아 넣던 가짜 B 가 남아 있으면 안 된다.
  assert.doesNotMatch(app, /captainGrade:\s*"B",\s*foGrade:\s*"B"/);
  // 주석의 예시 문자열은 놔두고 실제로 값을 넣는 자리만 본다.
  assert.doesNotMatch(app, /crewComposition: "PIC B/);
  assert.doesNotMatch(worker, /e\.captainGrade = 'B'/);
  assert.doesNotMatch(worker, /e\.foGrade = 'B'/);
});

test('편조 등급이 상대에게 전달된다', () => {
  // 스냅샷이 등급을 걸러내면 받는 쪽은 영영 판정할 수 없다.
  assert.match(app, /captainGrade: s\.captainGrade \|\| null/);
  assert.match(worker, /captainGrade: schedule\?\.captainGrade \|\| null/);
  assert.match(worker, /captainGrade: offered\.captainGrade \|\| null/);
});

test('경고 문구는 편조팀을 들먹이지 않는다', () => {
  // 앱이 남의 부서 선호를 단정할 자리가 아니다. 필요한 것은 "왜 반려될 수 있는가" 하나다.
  assert.doesNotMatch(app, /편조팀이 선호/);
  assert.match(app, /등급이 달라 최종 반려될 수 있습니다/);
});

test('CAT II/III 규정은 없앴다', () => {
  assert.doesNotMatch(app, /label:"CAT II\/III 조건"/);
  assert.doesNotMatch(app, /requiresCat2 && !state\.user\.cat2/);
});
