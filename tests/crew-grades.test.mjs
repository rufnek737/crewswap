// 근무표에서 A등급을 확정적으로 읽어낸다.
//
// Kay의 제안: "C등급의 기장 부기장 들은 편조가 무조건 A등급이여야 하잖아. 그럼 가입이
// 되어 있지 않아도 A등급은 데이터화 할수 있지 않을까?"
//
// A만 모은다. B·C 는 언젠가 상향되는 과도기 등급이라 쌓아두면 시간이 지나며 틀린 답을
// 준다. A는 종착 등급이라 유지된다(Kay). 덕분에 명단에 오르는 것은 최상위 등급뿐이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../grade-policy.js');
const C = require('../crew-grades.js');

const entry = { crewComposition: '김제주(Capt), 이운항(FO), 김애경(PUR), 최크루(FA)' };

test('좌석 코드를 읽는다', () => {
  assert.equal(C.seatOf('Capt'), 'CAPTAIN');
  assert.equal(C.seatOf('C'), 'CAPTAIN');   // 근무표 Pos 코드
  assert.equal(C.seatOf('2C'), 'CAPTAIN');  // 3인 편조
  assert.equal(C.seatOf('FO'), 'FO');
  assert.equal(C.seatOf('2F'), 'FO');
  assert.equal(C.seatOf('PUR'), null);      // 객실 직책
  assert.equal(C.seatOf(''), null);
});

test('편조 문자열에서 이름과 좌석을 뽑는다', () => {
  assert.deepEqual(C.parseCrew(entry.crewComposition), [
    { name: '김제주', seat: 'CAPTAIN' },
    { name: '이운항', seat: 'FO' },
  ]);
});

test('C등급 기장의 근무표는 그 부기장이 A임을 증명한다', () => {
  assert.deepEqual(C.aGradesFromRoster([entry], 'CAPTAIN_C', G), ['이운항']);
});

test('C등급 부기장의 근무표는 그 기장이 A임을 증명한다', () => {
  assert.deepEqual(C.aGradesFromRoster([entry], 'FO_C', G), ['김제주']);
});

test('B·A 등급 사용자의 근무표로는 아무것도 확정하지 못한다', () => {
  // B기장의 부기장은 A 일 수도 B 일 수도 있다. 확정되지 않는 것은 모으지 않는다.
  assert.deepEqual(C.aGradesFromRoster([entry], 'CAPTAIN_B', G), []);
  assert.deepEqual(C.aGradesFromRoster([entry], 'CAPTAIN_A', G), []);
});

test('객실승무원은 대상이 아니다', () => {
  assert.deepEqual(C.aGradesFromRoster([entry], 'PS', G), []);
});

test('같은 사람이 여러 번 나와도 한 번만 센다', () => {
  assert.deepEqual(C.aGradesFromRoster([entry, entry, entry], 'CAPTAIN_C', G), ['이운항']);
});

test('아는 명단으로 반대 좌석을 판정한다', () => {
  assert.equal(C.oppositeIsKnownA(entry, 'CAPTAIN_C', ['이운항'], G), true);
  assert.equal(C.oppositeIsKnownA(entry, 'FO_C', ['김제주'], G), true);
});

test('명단에 없으면 확정하지 않는다 — 모른다고 답한다', () => {
  // 모르는 것을 "안 된다"로 답하면 멀쩡한 스왑이 막히고, "된다"로 답하면 규정을 어긴다.
  assert.equal(C.oppositeIsKnownA(entry, 'CAPTAIN_C', [], G), null);
  assert.equal(C.oppositeIsKnownA({ crewComposition: '' }, 'CAPTAIN_C', ['이운항'], G), null);
});

test('3인 편조는 기장 전원이 명단에 있어야 확정한다', () => {
  // 기장이 둘인 비행에서 한 명만 알면 나머지 한 명이 규정을 깨뜨릴 수 있다.
  const three = { crewComposition: '김제주(Capt), 최항공(2C), 이운항(FO)' };
  assert.equal(C.oppositeIsKnownA(three, 'FO_C', ['김제주'], G), null);
  assert.equal(C.oppositeIsKnownA(three, 'FO_C', ['김제주', '최항공'], G), true);
});
