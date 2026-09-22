// 등급에 따른 승무원 비행편조 — 운항본부 인사관리 지침의 편조표.
//
//   기장 A → 부기장 A·B·C    기장 B → 부기장 A·B    기장 C → 부기장 A
//
// 예전에는 여기에 사용자끼리의 등급 궁합표(C는 C끼리)가 있었는데 출처가 없었고,
// app.js 의 편조표와 C등급이 정반대라 같은 화면이 서로 다른 답을 냈다. 규정은 사람 대
// 사람이 아니라 조종석 안의 조합이다.

import assert from "node:assert/strict";
import test from "node:test";
import gradePolicy from "../grade-policy.js";

const { positionOf, gradeOf, samePosition, allowedOpposite, pairs, check, PAIRING } = gradePolicy;

test("역할 코드에서 포지션과 등급을 읽는다", () => {
  assert.equal(positionOf("CAPTAIN_A"), "CAPTAIN");
  assert.equal(positionOf("FO_C"), "FO");
  assert.equal(positionOf("PS"), null); // 객실 직급
  assert.equal(gradeOf("CAPTAIN_B"), "B");
  assert.equal(gradeOf("CC"), null);
});

test("편조표가 지침 그대로다", () => {
  assert.deepEqual({ ...PAIRING }, { A: ["A", "B", "C"], B: ["A", "B"], C: ["A"] });
});

test("기장은 표를 그대로 읽는다", () => {
  assert.deepEqual(allowedOpposite("CAPTAIN_A"), ["A", "B", "C"]);
  assert.deepEqual(allowedOpposite("CAPTAIN_B"), ["A", "B"]);
  assert.deepEqual(allowedOpposite("CAPTAIN_C"), ["A"]);
});

test("부기장은 표를 거꾸로 읽는다", () => {
  // A등급 부기장은 세 줄 모두에 있으므로 어느 등급 기장과도 편조된다.
  assert.deepEqual(allowedOpposite("FO_A"), ["A", "B", "C"]);
  assert.deepEqual(allowedOpposite("FO_B"), ["A", "B"]);
  assert.deepEqual(allowedOpposite("FO_C"), ["A"]);
});

test("상대 좌석 등급을 모르면 A등급만 통과다", () => {
  // A등급은 어느 등급과도 편조되므로 확인할 것이 없다. B·C 는 확인이 필요해 null.
  assert.equal(pairs("CAPTAIN_A", null), true);
  assert.equal(pairs("FO_A", null), true);
  assert.equal(pairs("CAPTAIN_B", null), null);
  assert.equal(pairs("CAPTAIN_C", null), null);
});

test("등급을 알면 표대로 가린다", () => {
  assert.equal(pairs("CAPTAIN_C", "A"), true);
  assert.equal(pairs("CAPTAIN_C", "B"), false);
  assert.equal(pairs("CAPTAIN_B", "C"), false);
  assert.equal(pairs("FO_C", "A"), true);
  assert.equal(pairs("FO_C", "B"), false);
});

test("등급 판정 대상이 아니면 아무것도 답하지 않는다", () => {
  assert.deepEqual(allowedOpposite("PS"), []);
  assert.equal(pairs("PS", "A"), null);
});

test("포지션이 다르면 교환할 수 없다", () => {
  assert.equal(samePosition("CAPTAIN_A", "CAPTAIN_C"), true);
  assert.equal(samePosition("CAPTAIN_A", "FO_A"), false);
  const result = check("CAPTAIN_A", "FO_A");
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /기장↔기장/);
});

test("등급이 달라도 상대를 가리지 않는다", () => {
  // 사용자끼리의 등급 궁합은 규정이 아니다. C등급 기장이 A등급 기장 글에 요청할 수 있다.
  assert.equal(check("CAPTAIN_C", "CAPTAIN_A").status, "PASS");
  assert.equal(check("CAPTAIN_A", "CAPTAIN_C").status, "PASS");
});

test("가입 전에는 판정하지 않는다", () => {
  assert.equal(check("CAPTAIN_A", "CAPTAIN_B", { known: false }).status, "NA");
  assert.equal(check("CC", "CC").status, "NA");
});
