import assert from "node:assert/strict";
import test from "node:test";
import dutyLimits from "../duty-limits.js";

const { offsetOf, utcMinutes, worstWindow, checkRolling24h, formatHours } = dutyLimits;

const M = "2026-09";
const flight = (day, title, dep, arr, departureTime, blockMinutes, extra = {}) => ({
  month: M, day, type: "국제선", title, dep, arr, departureTime, blockMinutes, ...extra,
});

test("공항별 UTC 오프셋을 안다", () => {
  assert.equal(offsetOf("ICN"), 540);
  assert.equal(offsetOf("DAD"), 420);   // 베트남 +7
  assert.equal(offsetOf("HKG"), 480);
  assert.equal(offsetOf("GUM"), 600);
  assert.equal(offsetOf("icn"), 540);   // 대소문자 무관
  assert.equal(offsetOf("ZZZ"), 540);   // 모르는 공항은 KST
});

test("서로 다른 공항의 로컬 시각을 같은 축에 올린다", () => {
  // ICN 09:06(KST) 과 DAD 07:06(+7) 은 같은 순간이다
  const icn = utcMinutes({ month: M, day: 11 }, "09:06", "ICN");
  const dad = utcMinutes({ month: M, day: 11 }, "07:06", "DAD");
  assert.equal(icn, dad);
  // 자정 넘김(+1) 처리
  const next = utcMinutes({ month: M, day: 11 }, "00:55+1", "ICN");
  assert.equal(next - icn, (24 * 60) - (9 * 60 + 6) + 55);
});

test("실제 반려 사례를 잡아낸다 — 10일 2leg + 11일 DAD", () => {
  // 2026-08-31 회사 반려: "연속 24시간내 승무시간 초과"
  const schedules = [
    flight(10, "7C1703", "ICN", "ICN", "12:35", 180),   // ICN→MYJ→ICN 2leg, 3:00
    flight(11, "7C2211", "ICN", "DAD", "09:06", 297),   // 4:57
    flight(12, "7C2212", "DAD", "ICN", "13:21", 262),   // 4:22
  ];
  const result = checkRolling24h(schedules, { limitHours: 7 });
  assert.equal(result.status, "FAIL");
  // 10일 12:35 ~ 11일 12:35 창에 두 비행이 함께 들어간다 → 3:00 + 4:57 = 7:57
  assert.equal(result.totalMinutes, 477);
  assert.match(result.detail, /7:57/);
  assert.match(result.detail, /한도 초과/);
  assert.deepEqual(result.entries.map(e => e.day), [10, 11]);
});

test("11·12일만 보면 한도 안이다 — 앞 근무를 빼면 놓친다", () => {
  // 선택한 날짜만 보던 기존 방식이 왜 놓쳤는지를 고정한다
  const onlySelected = [
    flight(11, "7C2211", "ICN", "DAD", "09:06", 297),
    flight(12, "7C2212", "DAD", "ICN", "13:21", 262),
  ];
  const result = checkRolling24h(onlySelected, { limitHours: 7 });
  assert.equal(result.status, "PASS");
  assert.equal(result.totalMinutes, 297); // 두 비행은 24시간 이상 떨어져 있다
});

test("시간대 차이가 판정을 바꾼다", () => {
  // DAD 13:21(+7) = KST 15:21. 전날 ICN 16:00(KST) 출발과는 23시간 21분 차이 →
  // 같은 24시간 창. KST로만 계산하면 25시간 21분으로 보여 놓친다.
  const schedules = [
    flight(11, "선행", "ICN", "ICN", "16:00", 240),
    flight(12, "7C2212", "DAD", "ICN", "13:21", 262),
  ];
  const result = checkRolling24h(schedules, { limitHours: 7 });
  assert.equal(result.status, "FAIL");
  assert.equal(result.totalMinutes, 502);
});

test("한도 근접은 WARN, 여유가 있으면 PASS", () => {
  const near = [flight(11, "A", "ICN", "DAD", "09:00", 6 * 60 + 30)];
  assert.equal(checkRolling24h(near, { limitHours: 7 }).status, "WARN");

  const fine = [flight(11, "A", "ICN", "CJU", "09:00", 70)];
  assert.equal(checkRolling24h(fine, { limitHours: 7 }).status, "PASS");
});

test("정확히 한도면 통과, 1분만 넘어도 FAIL", () => {
  const exact = [flight(11, "A", "ICN", "DAD", "09:00", 7 * 60)];
  assert.equal(checkRolling24h(exact, { limitHours: 7 }).status, "WARN"); // 초과는 아님
  const over = [flight(11, "A", "ICN", "DAD", "09:00", 7 * 60 + 1)];
  assert.equal(checkRolling24h(over, { limitHours: 7 }).status, "FAIL");
});

test("24시간을 벗어나면 합산하지 않는다", () => {
  const schedules = [
    flight(11, "A", "ICN", "DAD", "09:00", 4 * 60),
    flight(12, "B", "ICN", "DAD", "09:00", 4 * 60), // 정확히 24시간 뒤 → 다른 창
  ];
  const result = checkRolling24h(schedules, { limitHours: 7 });
  assert.equal(result.status, "PASS");
  assert.equal(result.totalMinutes, 240);
});

test("승무시간이 없는 근무는 대상이 아니다", () => {
  const schedules = [
    { month: M, day: 11, type: "RSV" },
    { month: M, day: 12, type: "STBY" },
    { month: M, day: 13, type: "OFF" },
    { month: M, day: 14, type: "LAYOV", layoverAirport: "DAD" },
  ];
  const result = checkRolling24h(schedules, { limitHours: 7 });
  assert.equal(result.status, "PASS");
  assert.equal(result.totalMinutes, 0);
});

test("판정할 수 없으면 PASS가 아니라 WARN이다", () => {
  // 오늘 반려의 교훈 — 못 본 것을 통과로 답하면 안 된다
  const broken = [{ month: M, day: 11, type: "국제선", title: "A", dep: "ICN", blockMinutes: 300 }];
  const result = checkRolling24h(broken, { limitHours: 7 });
  assert.equal(result.status, "WARN");
  assert.match(result.detail, /판정 불가/);

  // 읽을 수 있는 근무와 섞여 있어도 경고를 남긴다
  const mixed = [...broken, flight(12, "B", "ICN", "CJU", "09:00", 70)];
  const mixedResult = checkRolling24h(mixed, { limitHours: 7 });
  assert.equal(mixedResult.status, "WARN");
  assert.match(mixedResult.detail, /계산에서 빠짐/);
});

test("출발시각이 없으면 신고시각을 기준점으로 쓴다", () => {
  const schedules = [
    { month: M, day: 11, type: "국제선", title: "A", dep: "ICN", reportTime: "08:00", blockMinutes: 300 },
    { month: M, day: 11, type: "국제선", title: "B", dep: "ICN", departureTime: "20:00", blockMinutes: 180 },
  ];
  const result = checkRolling24h(schedules, { limitHours: 7 });
  assert.equal(result.status, "FAIL");
  assert.equal(result.totalMinutes, 480);
});

test("worstWindow는 가장 나쁜 창을 고른다", () => {
  const schedules = [
    flight(1, "A", "ICN", "CJU", "09:00", 60),
    flight(5, "B", "ICN", "DAD", "09:00", 300),
    flight(5, "C", "ICN", "DAD", "20:00", 300),
    flight(20, "D", "ICN", "CJU", "09:00", 60),
  ];
  const worst = worstWindow(schedules);
  assert.equal(worst.totalMinutes, 600);
  assert.deepEqual(worst.entries.map(e => e.title), ["B", "C"]);
});

test("시:분 표기", () => {
  assert.equal(formatHours(477), "7:57");
  assert.equal(formatHours(60), "1:00");
  assert.equal(formatHours(5), "0:05");
});
