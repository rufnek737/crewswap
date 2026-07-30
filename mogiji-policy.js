(function attachCrewSwapMogijiPolicy(root) {
  const TRIP_TYPES = new Set(["국내선", "국제선", "LAYOV", "ARRIVAL"]);

  function requiredRestDays(daysAway) {
    if (daysAway < 3) return 0;
    if (daysAway <= 5) return 1;
    if (daysAway === 6) return 2;
    if (daysAway === 7) return 3;
    if (daysAway <= 10) return 4;
    if (daysAway <= 13) return 5;
    return 6;
  }

  function entryDate(entry) {
    if (!entry || !/^\d{4}-\d{2}$/.test(entry.month || "") || !entry.day) return null;
    const date = new Date(`${entry.month}-${String(entry.day).padStart(2, "0")}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function entryKey(entry) {
    const date = entryDate(entry);
    return date ? dateKey(date) : null;
  }

  function shiftedKey(key, delta) {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + delta);
    return dateKey(date);
  }

  function daysBetween(firstKey, lastKey) {
    return Math.round((new Date(`${lastKey}T00:00:00`) - new Date(`${firstKey}T00:00:00`)) / 86400000);
  }

  function collectProtectedDays(schedules) {
    const protectedDays = new Map();
    if (!Array.isArray(schedules)) return protectedDays;

    const byDate = new Map();
    schedules.forEach(entry => {
      const key = entryKey(entry);
      if (!key) return;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(entry);
      if (entry.mogijiRest?.arrivalDate && entry.mogijiRest?.requiredDays) {
        protectedDays.set(key, {
          dayKey: key,
          arrivalDate: entry.mogijiRest.arrivalDate,
          tripStartDate: entry.mogijiRest.tripStartDate || null,
          tripDays: Number(entry.mogijiRest.tripDays) || 0,
          requiredDays: Number(entry.mogijiRest.requiredDays) || 0,
        });
      }
    });

    [...byDate.entries()].forEach(([arrivalKey, entries]) => {
      if (!entries.some(entry => entry.type === "ARRIVAL")) return;
      let tripStartKey = arrivalKey;
      let previousKey = shiftedKey(arrivalKey, -1);
      while (byDate.has(previousKey)) {
        const previousEntries = byDate.get(previousKey);
        const continuesTrip = previousEntries.some(entry =>
          TRIP_TYPES.has(entry.type) && entry.type !== "ARRIVAL");
        if (!continuesTrip) break;
        tripStartKey = previousKey;
        previousKey = shiftedKey(previousKey, -1);
      }

      const tripDays = daysBetween(tripStartKey, arrivalKey) + 1;
      const requiredDays = requiredRestDays(tripDays);
      for (let offset = 1; offset <= requiredDays; offset++) {
        const restKey = shiftedKey(arrivalKey, offset);
        protectedDays.set(restKey, {
          dayKey: restKey,
          arrivalDate: arrivalKey,
          tripStartDate: tripStartKey,
          tripDays,
          requiredDays,
        });
      }
    });

    return protectedDays;
  }

  // 협약서의 "휴무일"을 보수적으로 적용해 명시적 OFF만 휴식 유지로 본다.
  function isWorkingEntry(entry) {
    return !!entry && entry.type !== "OFF";
  }

  function findProtectedRestViolation(originalSchedules, incomingSchedules) {
    const protectedDays = collectProtectedDays(originalSchedules);
    for (const incoming of Array.isArray(incomingSchedules) ? incomingSchedules : []) {
      if (!isWorkingEntry(incoming)) continue;
      const key = entryKey(incoming);
      if (key && protectedDays.has(key)) {
        return { ...protectedDays.get(key), incoming };
      }
    }
    return null;
  }

  function markerForEntry(entry, protectedDays) {
    const key = entryKey(entry);
    return key && protectedDays?.get(key) ? { ...protectedDays.get(key) } : null;
  }

  const api = {
    requiredRestDays,
    collectProtectedDays,
    findProtectedRestViolation,
    markerForEntry,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapMogijiPolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
