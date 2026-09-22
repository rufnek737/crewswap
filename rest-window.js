/* 연속 7일마다 30시간 연속 휴식 — FOM 비행근무시간 제한
 *
 * 원래 이 자리에는 "연속 근무일 5일 미만" 검사가 있었다. 그런데 항공안전법 시행규칙
 * 별표18·JPU 단체협약·FOM 어디에도 그런 조항이 없다. 근거 없는 숫자가 사용자에게
 * "불가"를 띄우고 있었다(2026-09-21 확인).
 *
 * 실제 규정은 일수가 아니라 휴식이다. 근무가 8일 이어져도 그 안에 30시간 연속 휴식이
 * 있으면 적법하고, 5일만 이어져도 그 휴식이 없으면 위반이다.
 */
(function attachRestWindow(root) {
  const DAY = 1440;              // 분
  const WINDOW_MIN = 7 * DAY;
  const REQUIRED_MIN = 30 * 60;

  /* 휴식은 체크아웃 시각부터 바로 세지 않는다. 편조가 스왑을 볼 때 체크아웃에 1시간
     40분을 더한 시각부터 센다(Kay가 편조에 확인) — 1시간은 집까지 이동, 40분은 지연
     여유다. 체크아웃 자체는 CrewConnex 가 계산해 준다(인천 램프인+1시간, 김포 +20분).
     app.js 의 앞뒤 휴식 검사도 이 값을 쓴다 — 사본을 두면 어긋난다. */
  const REST_START_BUMPER_MIN = 100;

  function toMinutes(entry, time) {
    const m = /^(\d{1,2}):(\d{2})(\+1)?$/.exec(String(time || "").trim());
    if (!m || !entry) return null;
    const month = String(entry.month || "");
    if (!/^\d{4}-\d{2}$/.test(month) || !entry.day) return null;
    const date = new Date(`${month}-${String(entry.day).padStart(2, "0")}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    const dayIndex = Math.floor(date.getTime() / 86400000);
    return dayIndex * DAY + Number(m[1]) * 60 + Number(m[2]) + (m[3] ? DAY : 0);
  }

  /* 근무 구간 [출두, 해제] 목록. 시각이 없는 날(OFF·VAC·RSV 등)은 구간을 만들지 않아
     자연히 휴식으로 이어진다 — RSV를 근무로 세던 예전 방식과 다른 점이다. */
  function dutyIntervals(entries) {
    const out = [];
    for (const e of entries || []) {
      const start = toMinutes(e, e.reportTime);
      const end = toMinutes(e, e.releaseTime);
      if (start === null || end === null) continue;
      const close = end < start ? end + DAY : end;
      // 근무가 끝나도 범퍼만큼은 휴식으로 치지 않는다.
      out.push({ start, end: close + REST_START_BUMPER_MIN, entry: e });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /* 근무와 근무 사이의 빈 시간. 겹치는 근무는 하나로 합친다. */
  function restGaps(intervals) {
    const merged = [];
    for (const it of intervals) {
      const last = merged[merged.length - 1];
      if (last && it.start <= last.end) last.end = Math.max(last.end, it.end);
      else merged.push({ ...it });
    }
    const gaps = [];
    for (let i = 0; i < merged.length - 1; i++) {
      gaps.push({ start: merged[i].end, end: merged[i + 1].start });
    }
    return { merged, gaps };
  }

  /* 7일 창을 굴리며 30시간 연속 휴식이 들어 있는지 본다.
     창의 경계에 걸친 휴식은 창 안에 들어온 만큼만 인정한다 — 창 밖의 휴식으로
     창 안의 요건을 채울 수는 없다. */
  function check(entries, { windowMin = WINDOW_MIN, requiredMin = REQUIRED_MIN } = {}) {
    const intervals = dutyIntervals(entries);
    if (intervals.length < 2) {
      return { status: "PASS", reason: "no-duty", worstDay: null, worstRestMin: null, requiredMin };
    }
    const { merged, gaps } = restGaps(intervals);
    const first = merged[0].start;
    const last = merged[merged.length - 1].end;
    if (last - first < windowMin) {
      return { status: "UNKNOWN", reason: "short-range", coveredMin: last - first, worstRestMin: null, requiredMin };
    }

    let worst = null;
    for (let start = first; start + windowMin <= last; start += DAY) {
      const end = start + windowMin;
      let best = 0;
      for (const g of gaps) {
        const overlap = Math.min(g.end, end) - Math.max(g.start, start);
        if (overlap > best) best = overlap;
      }
      if (worst === null || best < worst.rest) worst = { rest: best, start };
    }
    const status = worst.rest >= requiredMin ? "PASS" : "FAIL";
    return {
      status,
      reason: null,
      worstRestMin: worst.rest,
      worstWindowStartMin: worst.start,
      requiredMin,
    };
  }

  function detailText(result) {
    const h = m => `${Math.floor(m / 60)}시간 ${m % 60 ? `${m % 60}분` : ""}`.trim();
    if (result.status === "UNKNOWN") return "확인 불가 — 근무표가 7일에 미치지 못합니다";
    if (result.reason === "no-duty") return "해당 없음";
    return `7일 중 가장 긴 연속 휴식 ${h(result.worstRestMin)} / ${h(result.requiredMin)} 필요`;
  }

  const api = { check, detailText, dutyIntervals, restGaps, REST_START_BUMPER_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapRestWindow = api;
})(typeof window !== "undefined" ? window : globalThis);
