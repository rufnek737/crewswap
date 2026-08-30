import assert from "node:assert/strict";
import test from "node:test";
import gradePolicy from "../grade-policy.js";

const { positionOf, gradeOf, samePosition, isCompatible, mutualGrades, check } = gradePolicy;

test("reads position and grade out of a role code", () => {
  assert.equal(positionOf("CAPTAIN_A"), "CAPTAIN");
  assert.equal(positionOf("FO_C"), "FO");
  assert.equal(positionOf("PS"), null); // 객실 직급
  assert.equal(gradeOf("CAPTAIN_B"), "B");
  assert.equal(gradeOf("FO_A"), "A");
  assert.equal(gradeOf("CC"), null);
});

test("only pairs the same position", () => {
  assert.equal(samePosition("CAPTAIN_A", "CAPTAIN_B"), true);
  assert.equal(samePosition("CAPTAIN_A", "FO_A"), false);
  assert.equal(samePosition("PS", "PS"), false); // 등급 정책 대상 아님
});

test("A and B swap with each other, C only with C", () => {
  // 양방향 상호 허용: 둘 다 서로를 허용해야 통과
  assert.equal(isCompatible("CAPTAIN_A", "CAPTAIN_A"), true);
  assert.equal(isCompatible("CAPTAIN_A", "CAPTAIN_B"), true);
  assert.equal(isCompatible("CAPTAIN_B", "CAPTAIN_A"), true);
  assert.equal(isCompatible("CAPTAIN_B", "CAPTAIN_B"), true);
  assert.equal(isCompatible("CAPTAIN_C", "CAPTAIN_C"), true);
  // C는 A/B와 불가 — 어느 쪽에서 보든 같은 결과여야 한다
  assert.equal(isCompatible("CAPTAIN_C", "CAPTAIN_A"), false);
  assert.equal(isCompatible("CAPTAIN_A", "CAPTAIN_C"), false);
  assert.equal(isCompatible("CAPTAIN_C", "CAPTAIN_B"), false);
  assert.equal(isCompatible("CAPTAIN_B", "CAPTAIN_C"), false);
});

test("the same table applies to first officers", () => {
  assert.equal(isCompatible("FO_A", "FO_B"), true);
  assert.equal(isCompatible("FO_C", "FO_A"), false);
  assert.equal(isCompatible("FO_C", "FO_C"), true);
});

test("blocks a C captain from requesting an A captain's post", () => {
  const result = check("CAPTAIN_C", "CAPTAIN_A");
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /C등급 기장/);
  assert.match(result.reason, /C등급 기장과만/);
  assert.match(result.detail, /A등급 기장/);
});

test("passes a B captain onto an A captain's post", () => {
  const result = check("CAPTAIN_B", "CAPTAIN_A");
  assert.equal(result.status, "PASS");
  assert.equal(result.reason, "");
});

test("blocks across positions", () => {
  const result = check("CAPTAIN_A", "FO_A");
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /기장↔기장/);
});

test("does not judge cabin crew or unknown roles", () => {
  assert.equal(check("PS", "CC").status, "NA");
  assert.equal(check("CAPTAIN_A", null).status, "NA");
  assert.equal(check("CAPTAIN_A", "CAPTAIN_A", { known: false }).status, "NA");
  // 판정할 수 없으면 막지 않는다
  assert.equal(isCompatible("CAPTAIN_A", undefined), true);
});

test("reports the grades I can actually swap with", () => {
  assert.deepEqual(mutualGrades("CAPTAIN_A"), ["A", "B"]);
  assert.deepEqual(mutualGrades("CAPTAIN_B"), ["A", "B"]);
  assert.deepEqual(mutualGrades("CAPTAIN_C"), ["C"]);
  assert.deepEqual(mutualGrades("PS"), []);
});
