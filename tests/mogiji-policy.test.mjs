import assert from "node:assert/strict";
import test from "node:test";
import policy from "../mogiji-policy.js";

const { requiredRestDays, collectProtectedDays, findProtectedRestViolation, markerForEntry } = policy;

test("uses the JPUF article 51 mortgage-rest table", () => {
  assert.equal(requiredRestDays(2), 0);
  assert.equal(requiredRestDays(3), 1);
  assert.equal(requiredRestDays(5), 1);
  assert.equal(requiredRestDays(6), 2);
  assert.equal(requiredRestDays(7), 3);
  assert.equal(requiredRestDays(8), 4);
  assert.equal(requiredRestDays(10), 4);
  assert.equal(requiredRestDays(11), 5);
  assert.equal(requiredRestDays(13), 5);
  assert.equal(requiredRestDays(14), 6);
});

test("the day after a three-day trip arrival is protected mortgage rest", () => {
  const roster = [
    { month: "2026-08", day: 20, type: "OFF" },
    { month: "2026-08", day: 21, type: "국제선", dep: "ICN", arr: "DPS" },
    { month: "2026-08", day: 22, type: "국제선", dep: "DPS", arr: "ICN" },
    { month: "2026-08", day: 23, type: "ARRIVAL", arrivalAirport: "ICN" },
    { month: "2026-08", day: 24, type: "OFF" },
  ];
  const protectedDays = collectProtectedDays(roster);
  assert.deepEqual(protectedDays.get("2026-08-24"), {
    dayKey: "2026-08-24",
    arrivalDate: "2026-08-23",
    tripStartDate: "2026-08-21",
    tripDays: 3,
    requiredDays: 1,
  });
});

test("incoming work on protected mortgage rest fails but OFF remains valid", () => {
  const roster = [
    { month: "2026-08", day: 21, type: "국제선" },
    { month: "2026-08", day: 22, type: "국제선" },
    { month: "2026-08", day: 23, type: "ARRIVAL" },
    { month: "2026-08", day: 24, type: "OFF" },
  ];
  const workViolation = findProtectedRestViolation(roster, [
    { month: "2026-08", day: 24, type: "국내선", title: "7C129" },
  ]);
  assert.equal(workViolation?.dayKey, "2026-08-24");
  assert.equal(workViolation?.arrivalDate, "2026-08-23");
  assert.equal(findProtectedRestViolation(roster, [
    { month: "2026-08", day: 24, type: "OFF" },
  ]), null);
});

test("embedded protection marker survives a roster snapshot missing the trip", () => {
  const marker = {
    dayKey: "2026-08-24",
    arrivalDate: "2026-08-23",
    tripStartDate: "2026-08-21",
    tripDays: 3,
    requiredDays: 1,
  };
  const roster = [{ month: "2026-08", day: 24, type: "OFF", mogijiRest: marker }];
  assert.deepEqual(markerForEntry(roster[0], collectProtectedDays(roster)), marker);
  assert.equal(findProtectedRestViolation(roster, [
    { month: "2026-08", day: 24, type: "RSV" },
  ])?.requiredDays, 1);
});
