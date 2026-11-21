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
    // CrewConnex 는 복귀편 출두가 전날 밤이면 그 시각을 전날 LAYOV 칸에 적고 복귀편 출두는 비운다.
    // 그대로 두면 복귀 근무가 통째로 휴식으로 계산된다(2026-11-21, PQC·CNX). 전날 시각으로 옮겨 적는다.
    // 전날 칸이 LAYOV·ARRIVAL 이거나, 해제 시각 없이 밤새 이어지는 비행(PUS-TAG→TAG-PUS 같은 야간 왕복)이면 같은 근무다.
    schedules.forEach(entry => {
      if (!entry || !FLIGHT_TYPES.has(entry.type) || entry.reportTime || entry.reportPrevDay) return;
      const previous = byDate.get(shiftedKey(entry, -1));
      const carriesReport = previous && minuteOf(previous.reportTime) != null && (
        previous.type === "LAYOV" || previous.type === "ARRIVAL" ||
        (FLIGHT_TYPES.has(previous.type) && !previous.releaseTime));
      if (carriesReport) {
        entry.reportPrevDay = previous.reportTime;
        // 전날 비행은 이 근무의 앞부분 — 따로 체크아웃을 추정하면 근무시간이 두 번 더해진다.
        if (FLIGHT_TYPES.has(previous.type)) previous.continuesNextDay = true;
        changed++;
      }
    });
    // 외지에 내리는 편은 CrewConnex 가 체크아웃을 비워 두는 일이 많다. 그대로 두면 그 근무가 휴식으로 센다.
    // 실제 기록상 외지 체크아웃은 램프인 +20분이라(2026-11 실비행, DPS·VTE·CEB·PQC·CNX) 그 값으로 추정한다.
    schedules.forEach(entry => {
      if (!entry || !FLIGHT_TYPES.has(entry.type) || entry.releaseTime || entry.releaseEst || entry.continuesNextDay) return;
      if (!entry.arr || HOME_BASES.has(entry.arr)) return;
      const m = /^(\d{1,2}):(\d{2})(\+1)?$/.exec(String(entry.arrivalTime || "").trim());
      if (!m) return;
      let total = Number(m[1]) * 60 + Number(m[2]) + 20 + (m[3] ? 1440 : 0);
      const plus = total >= 1440; total %= 1440;
      entry.releaseEst = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}${plus ? "+1" : ""}`;
      changed++;
    });
    // 야간 SIM(20:45~02:45) 다음 날은 예전 가져오기에서 「← R_SIM2 도착」으로 저장됐다. 비행 도착이 아니므로 「SIM 종료」로 보인다.
    schedules.forEach(entry => {
      if (!entry || entry.type !== "ARRIVAL") return;
      const previous = byDate.get(shiftedKey(entry, -1));
      if (previous?.type !== "GND") return;
      const label = /SIM/i.test(`${previous.title || ""} ${previous.activityCode || ""} ${entry.title || ""}`) ? "SIM 종료" : `${previous.title || "지상근무"} 종료`;
      if (entry.title === label) return;
      entry.title = label;
      entry.routeSummary = null;   // 제목과 같은 글자가 두 줄로 나오지 않게
      entry.arrivalAirport = null;
      changed++;
    });
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
