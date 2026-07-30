(function attachCrewSwapScheduleContinuity(root) {
  const HOME_BASES = new Set(["GMP", "ICN", "PUS", "CJU"]);
  const FLIGHT_TYPES = new Set(["국내선", "국제선"]);

  function minuteOf(time) {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(time || "").trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function entryDate(entry) {
    if (!entry || !/^\d{4}-\d{2}$/.test(entry.month || "") || !entry.day) return null;
    return new Date(`${entry.month}-${String(entry.day).padStart(2, "0")}T00:00:00`);
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function shiftedKey(entry, delta) {
    const date = entryDate(entry);
    if (!date) return null;
    date.setDate(date.getDate() + delta);
    return dateKey(date);
  }

  function isOvernightArrival(previous) {
    if (!previous || !FLIGHT_TYPES.has(previous.type) || !previous.arr) return false;
    const report = minuteOf(previous.reportTime);
    const arrival = minuteOf(previous.arrivalTime);
    return report != null && arrival != null && arrival < report;
  }

  function normalizeScheduleContinuity(schedules) {
    if (!Array.isArray(schedules)) return 0;
    const byDate = new Map();
    schedules.forEach(entry => {
      const date = entryDate(entry);
      if (date) byDate.set(dateKey(date), entry);
    });

    let changed = 0;
    schedules.forEach(entry => {
      if (!entry || entry.type !== "UNKNOWN") return;
      const previous = byDate.get(shiftedKey(entry, -1));
      const next = byDate.get(shiftedKey(entry, 1));

      if (isOvernightArrival(previous)) {
        entry.type = "ARRIVAL";
        entry.title = `← ${previous.title || `${previous.dep || ""}-${previous.arr}`} 도착`;
        entry.arrivalAirport = previous.arr;
        entry.arrivalTime = previous.arrivalTime || null;
        entry.routeSummary = `${previous.dep || ""}→${previous.arr} 도착`.replace(/^→/, "");
        entry.patternId = previous.patternId || entry.patternId;
        changed++;
        return;
      }

      // 이미 발송된 공개 로스터는 현재 월만 담겨 전월 마지막 편조가 없을 수 있다.
      // CrewConnex의 월초 도착 shadow(24:00) 뒤가 OFF라면 전월 편조 도착일로 분류한다.
      if (!previous && Number(entry.day) === 1 && entry.arrivalTime === "24:00" && next?.type === "OFF") {
        entry.type = "ARRIVAL";
        entry.title = "← 전월 편조 도착";
        entry.arrivalTime = null;
        entry.routeSummary = "전월 편조 도착";
        changed++;
        return;
      }

      let layoverAirport = null;
      // 전날 도착지와 다음날 출발지가 같으면 중간 UNKNOWN은 체류일이다.
      // CJU처럼 다른 승무원의 베이스가 될 수 있는 공항도 현재 사용자의
      // 연속 편조 안에서는 layover일 수 있으므로 공항 목록으로 제외하지 않는다.
      if (previous?.arr && next?.dep && previous.arr === next.dep) {
        layoverAirport = previous.arr;
      } else if (previous?.type === "국제선" && previous.arr && !HOME_BASES.has(previous.arr)) {
        layoverAirport = previous.arr;
      } else if (next?.type === "국제선" && next.dep && !HOME_BASES.has(next.dep)) {
        layoverAirport = next.dep;
      }
      if (!layoverAirport) return;

      entry.type = "LAYOV";
      entry.title = `LAYOV ${layoverAirport}`;
      entry.layoverAirport = layoverAirport;
      entry.routeSummary = `${layoverAirport} 체류`;
      if (entry.arrivalTime === "24:00") entry.arrivalTime = null;
      entry.patternId = previous?.patternId || next?.patternId || entry.patternId;
      changed++;
    });
    return changed;
  }

  const api = { normalizeScheduleContinuity };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapScheduleContinuity = api;
})(typeof window !== "undefined" ? window : globalThis);
