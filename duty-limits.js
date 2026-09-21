/* 누적 한도 검사 — 연속 N일 창을 굴리며 최대 합계를 찾는다.
 *
 * FOM 비행근무시간 제한 표에는 24시간짜리 말고도 긴 창의 한도가 있다(28일·365일 승무시간,
 * 7일·28일 근무시간). 값은 RULES에 적혀 있었지만 읽는 코드가 없어서, 앱은 그 항목을
 * 보지도 않고 "통과"라고 답하고 있었다. 확인하지 않은 것을 확인했다고 말하는 쪽이
 * 아예 표시하지 않는 것보다 나쁘다 — 사용자는 앱을 믿고 스왑을 진행한다.
 *
 * 그래서 이 모듈은 세 가지 답만 낸다.
 *   - 한도를 넘었다 / 임박했다 / 여유 있다   (창 전체를 덮는 데이터가 있을 때)
 *   - 확인 불가                              (그 창을 덮을 근무표가 없을 때)
 * 근무표는 보통 한두 달치뿐이라 365일 창은 대개 '확인 불가'가 정상이다.
 */
(function attachDutyLimits(root) {
  const DAY_MS = 86400000;

  function toDate(entry) {
    if (!entry) return null;
    const month = String(entry.month || "");
    if (!/^\d{4}-\d{2}$/.test(month) || !entry.day) return null;
    const date = new Date(`${month}-${String(entry.day).padStart(2, "0")}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dayKey = date => Math.floor(date.getTime() / DAY_MS);

  /* 하루당 분을 모은다. 같은 날 여러 건이면 더한다(퀵턴 2레그 등). */
  function dailyTotals(entries, minutesOf) {
    const byDay = new Map();
    for (const entry of entries || []) {
      const date = toDate(entry);
      if (!date) continue;
      const minutes = Number(minutesOf(entry)) || 0;
      const key = dayKey(date);
      byDay.set(key, (byDay.get(key) || 0) + minutes);
    }
    return byDay;
  }

  /* 창 하나를 굴려 최대 합계를 찾는다. 창이 근무표 범위를 벗어나면 계산하지 않는다 —
     데이터가 없는 날을 0으로 치면 "여유 있다"는 틀린 답이 나온다. */
  function rollingMax(byDay, windowDays) {
    const keys = [...byDay.keys()].sort((a, b) => a - b);
    if (!keys.length) return null;
    const first = keys[0], last = keys[keys.length - 1];
    const coveredDays = last - first + 1;
    if (coveredDays < windowDays) return { coveredDays, maxMinutes: null };

    let maxMinutes = 0;
    for (let start = first; start + windowDays - 1 <= last; start++) {
      let sum = 0;
      for (let d = start; d < start + windowDays; d++) sum += byDay.get(d) || 0;
      if (sum > maxMinutes) maxMinutes = sum;
    }
    return { coveredDays, maxMinutes };
  }

  /* warnRatio: 한도의 몇 %부터 경고할지. 월 승무시간 검사가 80/90 = 0.89를 쓰므로 맞춘다. */
  function check({ entries, minutesOf, windowDays, limitHours, warnRatio = 0.89 }) {
    const result = rollingMax(dailyTotals(entries, minutesOf), windowDays);
    if (!result) {
      return { status: "UNKNOWN", reason: "no-data", coveredDays: 0, hours: null, limitHours, windowDays };
    }
    if (result.maxMinutes === null) {
      return { status: "UNKNOWN", reason: "short-range", coveredDays: result.coveredDays, hours: null, limitHours, windowDays };
    }
    const hours = Math.round((result.maxMinutes / 60) * 10) / 10;
    const status = hours >= limitHours ? "FAIL" : hours >= limitHours * warnRatio ? "WARN" : "PASS";
    return { status, reason: null, coveredDays: result.coveredDays, hours, limitHours, windowDays };
  }

  function detailText(result) {
    if (result.status === "UNKNOWN") {
      return result.reason === "no-data"
        ? "확인 불가 — 불러온 근무표가 없습니다"
        : `확인 불가 — ${result.windowDays}일치가 필요한데 ${result.coveredDays}일치만 있습니다`;
    }
    return `최대 ${result.hours.toFixed(1)}h / ${result.limitHours}h`;
  }

  const api = { check, detailText, dailyTotals, rollingMax };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapDutyLimits = api;
})(typeof window !== "undefined" ? window : globalThis);
