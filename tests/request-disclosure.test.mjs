import assert from "node:assert/strict";
import test from "node:test";
import disclosure from "../request-disclosure.js";

const { exactFlightEntries, disclosureHint } = disclosure;

const post = {
  offered: {
    dateKeys: ["2026-08-17", "2026-08-18", "2026-08-19"],
  },
};

test("same-date flight pattern is disclosed as a direct 1:1 offer", () => {
  const schedules = [
    { month:"2026-08", day:17, type:"국제선", title:"7C5303", patternId:"P1" },
    { month:"2026-08", day:18, type:"LAYOV", title:"LAYOV DPS", patternId:"P1" },
    { month:"2026-08", day:19, type:"국제선", title:"7C5304", patternId:"P1" },
    { month:"2026-08", day:20, type:"OFF", title:"OFF" },
  ];
  assert.deepEqual(exactFlightEntries(post, schedules, "2026-08"), schedules.slice(0, 3));
});

test("OFF on one of the target dates requires roster disclosure", () => {
  const schedules = [
    { month:"2026-08", day:17, type:"국제선", patternId:"P1" },
    { month:"2026-08", day:18, type:"OFF", patternId:null },
    { month:"2026-08", day:19, type:"국제선", patternId:"P2" },
  ];
  assert.equal(exactFlightEntries(post, schedules, "2026-08"), null);
});

test("missing target date requires roster disclosure", () => {
  const schedules = [
    { month:"2026-08", day:17, type:"국제선", patternId:"P1" },
    { month:"2026-08", day:19, type:"국제선", patternId:"P1" },
  ];
  assert.equal(exactFlightEntries(post, schedules, "2026-08"), null);
});

test("RSV and STBY are not treated as direct flight matches", () => {
  const oneDayPost = { offered: { dateKeys: ["2026-08-17"] } };
  assert.equal(exactFlightEntries(oneDayPost, [{ month:"2026-08", day:17, type:"RSV" }], "2026-08"), null);
  assert.equal(exactFlightEntries(oneDayPost, [{ month:"2026-08", day:17, type:"STBY" }], "2026-08"), null);
});

test("a partial overlap with a longer flight pattern is not a direct match", () => {
  const oneDayPost = { offered: { dateKeys: ["2026-08-17"] } };
  const schedules = [
    { month:"2026-08", day:17, type:"국제선", patternId:"P1" },
    { month:"2026-08", day:18, type:"LAYOV", patternId:"P1" },
    { month:"2026-08", day:19, type:"국제선", patternId:"P1" },
  ];
  assert.equal(exactFlightEntries(oneDayPost, schedules, "2026-08"), null);
});

test("roster disclosure guidance uses the approved plain-language wording", () => {
  assert.equal(
    disclosureHint("ask", false),
    "내 스케줄 전체가 상대에게 보여집니다. 상대가 바꿀 날을 고릅니다. 신상정보는 상호 수락 후 공개, 크레딧 사용 없음.",
  );
  assert.equal(
    disclosureHint("request", false),
    "내 스케줄 전체가 상대에게 보여집니다. 상대가 바꿀 날을 고릅니다. 신상정보는 상호 수락 후 공개, 1크레딧이 사용됩니다.",
  );
});
