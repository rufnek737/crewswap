import assert from "node:assert/strict";
import test from "node:test";
import cabinPolicy from "../cabin-policy.js";

const {
  preserveRestrictedType,
  minimumRestGapMinutes,
  findRestViolation,
} = cabinPolicy;

test("preserves cabin-only UV_ML and OFFMED schedule codes", () => {
  assert.equal(preserveRestrictedType("UV_ML", ""), "UV_ML");
  assert.equal(preserveRestrictedType("OFFMED", ""), "OFFMED");
  assert.equal(preserveRestrictedType("OFF", ""), null);
});

test("uses the cabin Swap Guide base-pair rest table", () => {
  const previous = {
    month: "2026-08",
    day: 1,
    type: "국제선",
    reportTime: "10:00",
    releaseTime: "20:00",
  };
  assert.equal(minimumRestGapMinutes({ ...previous, arr: "ICN" }, { dep: "ICN" }), 900);
  assert.equal(minimumRestGapMinutes({ ...previous, arr: "ICN" }, { dep: "GMP" }), 850);
  assert.equal(minimumRestGapMinutes({ ...previous, arr: "GMP" }, { dep: "ICN" }), 860);
  assert.equal(minimumRestGapMinutes({ ...previous, arr: "GMP" }, { dep: "GMP" }), 810);
  assert.equal(minimumRestGapMinutes({ ...previous, arr: "PUS" }, { dep: "PUS" }), 810);
});

test("infers STD from report time when the roster omits the STD column", () => {
  const original = [
    {
      month: "2026-08", day: 1, type: "국제선",
      dep: "NRT", arr: "ICN",
      reportTime: "16:00", arrivalTime: "22:00", releaseTime: "22:30",
    },
    { month: "2026-08", day: 2, type: "OFF" },
  ];
  const incoming = [{
    month: "2026-08", day: 2, type: "국제선",
    dep: "ICN", arr: "KIX", reportTime: "10:40",
  }];
  assert.equal(findRestViolation(original, [original[1]], incoming), null);
});

test("recalculates cabin rest after replacing an outgoing day with incoming work", () => {
  const original = [
    {
      month: "2026-08", day: 1, type: "국제선", title: "7C101",
      dep: "NRT", arr: "ICN",
      reportTime: "16:00", arrivalTime: "22:00", releaseTime: "22:30",
    },
    { month: "2026-08", day: 2, type: "OFF", title: "OFF" },
  ];
  const outgoing = [{ month: "2026-08", day: 2, type: "OFF" }];
  const tooEarly = [{
    month: "2026-08", day: 2, type: "국제선", title: "7C102",
    dep: "ICN", arr: "KIX",
    reportTime: "10:10", departureTime: "12:30",
    arrivalTime: "16:00", releaseTime: "16:30",
  }];
  const allowed = [{ ...tooEarly[0], reportTime: "10:40", departureTime: "13:00" }];

  const violation = findRestViolation(original, outgoing, tooEarly);
  assert.equal(violation?.routeKey, "ICN-ICN");
  assert.equal(violation?.gapMinutes, 870);
  assert.equal(violation?.requiredMinutes, 900);
  assert.equal(findRestViolation(original, outgoing, allowed), null);
});
