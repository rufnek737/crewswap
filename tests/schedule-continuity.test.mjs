import assert from "node:assert/strict";
import test from "node:test";
import continuity from "../schedule-continuity.js";

const { normalizeScheduleContinuity } = continuity;

test("first day of a month becomes ARRIVAL after a previous-month overnight flight", () => {
  const schedules = [
    { month:"2026-07", day:31, type:"국제선", title:"7C5304", dep:"DPS", arr:"ICN", reportTime:"18:10", arrivalTime:"02:20", patternId:"P1" },
    { month:"2026-08", day:1, type:"UNKNOWN", title:"-" },
  ];
  assert.equal(normalizeScheduleContinuity(schedules), 1);
  assert.equal(schedules[1].type, "ARRIVAL");
  assert.equal(schedules[1].arrivalAirport, "ICN");
  assert.equal(schedules[1].arrivalTime, "02:20");
});

test("unknown middle day between outbound and inbound flights becomes LAYOV", () => {
  const schedules = [
    { month:"2026-08", day:7, type:"국제선", title:"7C5303", dep:"ICN", arr:"DPS", patternId:"P2" },
    { month:"2026-08", day:8, type:"UNKNOWN", title:"-" },
    { month:"2026-08", day:9, type:"국제선", title:"7C5304", dep:"DPS", arr:"ICN", patternId:"P3" },
  ];
  assert.equal(normalizeScheduleContinuity(schedules), 1);
  assert.equal(schedules[1].type, "LAYOV");
  assert.equal(schedules[1].layoverAirport, "DPS");
});

test("CJU can be a layover inside a connected three-day pattern", () => {
  const schedules = [
    { month:"2026-08", day:7, type:"국내선", title:"7C141", dep:"GMP", arr:"CJU", reportTime:"19:15" },
    { month:"2026-08", day:8, type:"UNKNOWN", title:"-", arrivalTime:"24:00" },
    { month:"2026-08", day:9, type:"국내선", title:"7C141", dep:"CJU", arr:"GMP", reportTime:"17:45" },
  ];
  assert.equal(normalizeScheduleContinuity(schedules), 1);
  assert.equal(schedules[1].type, "LAYOV");
  assert.equal(schedules[1].title, "LAYOV CJU");
  assert.equal(schedules[1].layoverAirport, "CJU");
  assert.equal(schedules[1].routeSummary, "CJU 체류");
  assert.equal(schedules[1].arrivalTime, null);
});

test("ordinary unknown days remain unknown", () => {
  const schedules = [
    { month:"2026-08", day:14, type:"OFF", title:"OFF" },
    { month:"2026-08", day:15, type:"UNKNOWN", title:"-" },
    { month:"2026-08", day:16, type:"OFF", title:"OFF" },
  ];
  assert.equal(normalizeScheduleContinuity(schedules), 0);
  assert.equal(schedules[1].type, "UNKNOWN");
});
