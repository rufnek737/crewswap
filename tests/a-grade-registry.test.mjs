// 서버가 A등급 명단을 모으고, 판정만 내려보낸다.
//
// 명단 자체는 기기로 나가지 않는다 — 가입하지 않은 사람의 이름을 다루는 일이라
// 밖으로 흘릴 이유가 없다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

test('근무표를 올릴 때 A등급을 모은다', () => {
  assert.match(worker, /crewGrades\.aGradesFromRoster\(schedules, profile\?\.roleType, gradePolicy\)/);
  assert.match(worker, /if \(names\.length\) await recordAGrades/);
});

test('판정은 서버가 하고 참/거짓만 내려간다', () => {
  // 명단을 통째로 내려보내면 가입하지 않은 사람들의 이름이 모든 기기에 퍼진다.
  assert.match(worker, /crewGrades\.oppositeIsKnownA\(p\.offered, viewer\.roleType, known, gradePolicy\)/);
  assert.match(worker, /if \(verdict === true\) p\.offered\.oppositeGrades = \['A'\]/);
  assert.doesNotMatch(worker, /json\(\{\s*aGrades/);
});

test('확정된 것만 기록한다 — A 말고는 저장하지 않는다', () => {
  // B·C 는 언젠가 상향되는 과도기 등급이라 쌓으면 썩는다.
  const fn = worker.match(/async function recordAGrades[\s\S]*?\n\}/)[0];
  assert.match(fn, /grade: 'A'/);
  assert.doesNotMatch(fn, /grade: '[BC]'/);
});

test('조회량에 상한을 둔다', () => {
  // 글이 많은 날 이름 수백 개를 하나씩 조회하면 응답이 무너진다.
  assert.match(worker, /\.slice\(0, 200\)/);   // 기록
  assert.match(worker, /\.slice\(0, 50\)/);    // 조회
});

test('조종사이고 등급이 있는 사람에게만 판정한다', () => {
  // 객실승무원과 등급 없는 계정에는 헛일이다.
  assert.match(worker, /viewer\?\.crewType === 'PILOT' && gradePolicy\.gradeOf\(viewer\.roleType\)/);
});
