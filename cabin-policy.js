(function attachCrewSwapCabinPolicy(root) {
  const NON_DUTY_TYPES = new Set([
    "OFF", "VAC", "VAC_A", "VAC_P", "UV_ML", "OFFMED",
  ]);

  // 객실 생활 백과사전 Swap Guide p.47:
  // 전 근무 STA 22:00 기준 다음 국제선 STD 가능시각까지의 최소 간격.
  const BASE_GAP_MINUTES = new Map([
    ["ICN-ICN", 15 * 60],
    ["ICN-GMP", 14 * 60 + 10],
    ["GMP-ICN", 14 * 60 + 20],
    ["GMP-GMP", 13 * 60 + 30],
    ["PUS-PUS", 13 * 60 + 30],
  ]);

  function preserveRestrictedType(activity, pairing) {
    const text = `${activity || ""} ${pairing || ""}`.trim().toUpperCase();
    if (/(^|\s)UV_ML(\s|$)/.test(text)) return "UV_ML";
    if (/(^|\s)OFFMED(\s|$)/.test(text)) return "OFFMED";
    return null;
  }

  function entryDate(entry) {
    if (!entry || !/^\d{4}-\d{2}$/.test(entry.month || "") || !entry.day) return null;
    const date = new Date(`${entry.month}-${String(entry.day).padStart(2, "0")}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function entryKey(entry) {
    const date = entryDate(entry);
    if (!date) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function absoluteMinutes(entry, time) {
    const date = entryDate(entry);
    const match = /^(\d{1,2}):(\d{2})(\+1)?$/.exec(String(time || "").trim());
    if (!date || !match) return null;
    const dayMinutes = Math.round(date.getTime() / 60000);
    return dayMinutes
      + Number(match[1]) * 60
      + Number(match[2])
      + (match[3] ? 24 * 60 : 0);
  }

  function dutyMinutes(entry) {
    const start = absoluteMinutes(entry, entry?.reportTime);
    const end = absoluteMinutes(entry, entry?.releaseTime);
    return start == null || end == null ? 0 : Math.max(0, end - start);
  }

  function isWorkingEntry(entry) {
    return !!entry && !NON_DUTY_TYPES.has(String(entry.type || "").toUpperCase());
  }

  function minimumRestGapMinutes(previous, next) {
    if (!previous || !next) return 10 * 60;
    if (String(previous.type || "").toUpperCase() === "OFC") return 11 * 60;
    const routeKey = `${String(previous.arr || "").toUpperCase()}-${String(next.dep || "").toUpperCase()}`;
    const baseGap = BASE_GAP_MINUTES.get(routeKey) || 10 * 60;
    // 최소 객실승무원 수를 초과하는 장시간 비행근무는 규정상 휴식이 14시간이므로
    // 기본 10시간 대비 4시간을 추가한다.
    return dutyMinutes(previous) > 14 * 60 ? baseGap + 4 * 60 : baseGap;
  }

  function reportToDepartureMinutes(entry) {
    if (String(entry?.dep || "").toUpperCase() === "ICN") return 2 * 60 + 20;
    return String(entry?.type || "").toUpperCase() === "국제선" ? 90 : 80;
  }

  function endMinutes(entry) {
    return absoluteMinutes(entry, entry?.arrivalTime)
      ?? absoluteMinutes(entry, entry?.releaseTime);
  }

  function startMinutes(entry) {
    return absoluteMinutes(entry, entry?.reportTime);
  }

  function departureMinutes(entry) {
    const parsed = absoluteMinutes(entry, entry?.departureTime);
    const report = startMinutes(entry);
    return parsed ?? (report == null ? null : report + reportToDepartureMinutes(entry));
  }

  function findRestViolation(originalSchedules, outgoingSchedules, incomingSchedules) {
    const outgoingKeys = new Set((outgoingSchedules || []).map(entryKey).filter(Boolean));
    const incoming = (incomingSchedules || []).filter(Boolean);
    const incomingKeys = new Set(incoming.map(entryKey).filter(Boolean));
    const retained = (originalSchedules || []).filter(entry => {
      const key = entryKey(entry);
      return key && !outgoingKeys.has(key);
    });
    const hypothetical = [...retained, ...incoming]
      .filter(isWorkingEntry)
      .filter(entry => startMinutes(entry) != null || endMinutes(entry) != null)
      .sort((a, b) => {
        const aTime = startMinutes(a) ?? endMinutes(a);
        const bTime = startMinutes(b) ?? endMinutes(b);
        return aTime - bTime;
      });

    for (let index = 1; index < hypothetical.length; index += 1) {
      const previous = hypothetical[index - 1];
      const next = hypothetical[index];
      const previousEnd = endMinutes(previous);
      const nextStart = String(previous.type || "").toUpperCase() === "OFC"
        ? startMinutes(next)
        : departureMinutes(next);
      if (previousEnd == null || nextStart == null) continue;
      if (!incomingKeys.has(entryKey(previous)) && !incomingKeys.has(entryKey(next))) continue;
      const gap = nextStart - previousEnd;
      const need = minimumRestGapMinutes(previous, next);
      if (gap < need) {
        return {
          previous,
          next,
          gapMinutes: gap,
          requiredMinutes: need,
          routeKey: `${previous.arr || "?"}-${next.dep || "?"}`,
        };
      }
    }
    return null;
  }

  const api = {
    BASE_GAP_MINUTES,
    NON_DUTY_TYPES,
    preserveRestrictedType,
    minimumRestGapMinutes,
    reportToDepartureMinutes,
    findRestViolation,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapCabinPolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
