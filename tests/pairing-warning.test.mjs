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

/* 편조표가 양방향이라, 글쓴이 등급이 그 비행의 반대 좌석을 좁혀 준다.
   Kay가 제안했다 — "C등급의 기장 부기장 들은 편조가 무조건 A등급이여야 하잖아.
   그럼 가입이 되어 있지 않아도 A등급은 데이터화 할수 있지 않을까?" */

test('C등급이 타고 있으면 반대 좌석은 A로 확정된다', () => {
  assert.deepEqual(gradePolicy.narrowOpposite('CAPTAIN_C'), ['A']);
  assert.deepEqual(gradePolicy.narrowOpposite('FO_C'), ['A']);
});

test('B등급은 두 가지로 좁혀지고 A등급은 좁혀지지 않는다', () => {
  assert.deepEqual(gradePolicy.narrowOpposite('CAPTAIN_B'), ['A', 'B']);
  assert.equal(gradePolicy.narrowOpposite('CAPTAIN_A'), null);
});

test('C등급끼리는 경고 없이 통과한다', () => {
  // C기장의 비행은 부기장이 반드시 A다. 내가 C기장이어도 편조가 성립한다.
  const posted = gradePolicy.narrowOpposite('CAPTAIN_C');
  assert.equal(gradePolicy.pairsWithin('CAPTAIN_C', posted), true);
  assert.equal(gradePolicy.pairsWithin('CAPTAIN_B', posted), true);
});

test('후보가 섞이면 확인이 필요하다', () => {
  // B기장의 부기장은 A 이거나 B 다. B 이면 C기장은 편조할 수 없다.
  assert.equal(gradePolicy.pairsWithin('CAPTAIN_C', gradePolicy.narrowOpposite('CAPTAIN_B')), null);
  // A기장의 부기장은 좁혀지지 않는다.
  assert.equal(gradePolicy.pairsWithin('CAPTAIN_C', gradePolicy.narrowOpposite('CAPTAIN_A')), null);
});

test('후보가 전부 불가하면 막는다', () => {
  assert.equal(gradePolicy.pairsWithin('CAPTAIN_C', ['B']), false);
  assert.equal(gradePolicy.pairsWithin('CAPTAIN_C', ['B', 'C']), false);
});

test('추론 결과를 글에 실어 보낸다', () => {
  assert.match(app, /oppositeGrades: state\.user\.crewType === "PILOT"/);
  assert.match(app, /GRADE_POLICY\.narrowOpposite\(state\.user\.roleType\)/);
  assert.match(worker, /oppositeGrades: Array\.isArray\(offered\.oppositeGrades\)/);
});

test('내가 올리는 스케줄에는 편조 기준을 걸지 않는다', () => {
  // Kay: "내가 c등급인데 당연히 A등급 부기장이잖아. 저건 적절하지 않지 — 상대방이
  // 스왑을 하려고 할 때 필요한 거지." 내가 이미 그 비행에 편성돼 있으니 적법한 것이 당연하다.
  // 판정이 필요한 것은 내가 **가져올** 비행이고, 그건 postGradeCheck 이 한다.
  assert.doesNotMatch(app, /label:"등급에 따른 비행편조"/);
  assert.doesNotMatch(app, /crewPairingCheck/);
  assert.doesNotMatch(app, /<dt>편조기준<\/dt>/);
  assert.match(app, /function postGradeCheck\(post\)/);
});

test('상호 합의 스왑 수당 안내는 넣지 않는다', () => {
  // Kay 지시. 규정에 있다고 전부 앱에 넣을 일은 아니다.
  assert.doesNotMatch(app, /상호 합의 스왑 수당/);
});
