import assert from "node:assert/strict";
import test from "node:test";
import cabinPolicy from "../cabin-policy.js";
import { readFileSync } from "node:fs";

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

test('최소 휴식은 규칙표에서 읽는다', () => {
  // 숫자를 코드에 박아두면 설정을 고쳐도 반영되지 않는다 — restHoursMin 이 그런 상태였다.
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /currentRules\(\)\?\.restHoursMin \|\| 10/);
  assert.doesNotMatch(app, /\?\? 10 \* 60;/);

  const policy = readFileSync(new URL('../cabin-policy.js', import.meta.url), 'utf8');
  assert.match(policy, /minRestMinutes = DEFAULT_MIN_REST_MIN/);
});

test('넘겨준 최소 휴식이 실제로 쓰인다', () => {
  const previous = { type: '국제선', arr: 'ICN' };
  const next = { dep: 'PUS', type: '국제선' };   // 표에 없는 구간 → 기본값이 쓰인다
  assert.equal(cabinPolicy.minimumRestGapMinutes(previous, next), 600);
  assert.equal(cabinPolicy.minimumRestGapMinutes(previous, next, { minRestMinutes: 720 }), 720);
});

test('전날 사무 근무는 기본 휴식보다 1시간 길다', () => {
  const ofc = { type: 'OFC' };
  const next = { dep: 'GMP', type: '국내선' };
  assert.equal(cabinPolicy.minimumRestGapMinutes(ofc, next), 660);
  assert.equal(cabinPolicy.minimumRestGapMinutes(ofc, next, { minRestMinutes: 720 }), 780);
});
