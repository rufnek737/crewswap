(function attachCrewSwapPostDetails(root) {
  function dateLabel(schedule) {
    const month = String(schedule?.month || "");
    const monthNumber = /^\d{4}-\d{2}$/.test(month) ? Number(month.slice(5, 7)) : null;
    if (monthNumber && schedule?.day) return `${monthNumber}/${schedule.day}`;
    return schedule?.day ? `${schedule.day}일` : "전체 일정";
  }

  function rows(offered = {}) {
    if (Array.isArray(offered.daySchedules) && offered.daySchedules.length) {
      return offered.daySchedules.map(schedule => ({
        fallback:false,
        date:dateLabel(schedule),
        type:schedule.type || "근무",
        title:schedule.title || schedule.type || "근무",
        route:schedule.routeSummary || (schedule.dep && schedule.arr ? `${schedule.dep}→${schedule.arr}` : schedule.layoverAirport ? `LAYOVER ${schedule.layoverAirport}` : ""),
        reportTime:schedule.reportTime || null,
        departureTime:schedule.departureTime || null,
        arrivalTime:schedule.arrivalTime || null,
        releaseTime:schedule.releaseTime || null,
      }));
    }

    return [{
      fallback:true,
      date:"전체 일정",
      type:offered.type || "근무",
      title:offered.patternName || offered.type || "근무",
      route:offered.summary || "",
      reportTime:offered.reportTime || null,
      departureTime:offered.firstDepartureTime || null,
      arrivalTime:offered.lastArrival || null,
      releaseTime:offered.releaseTime || null,
    }];
  }

  const api = { rows };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapPostDetails = api;
})(typeof window !== "undefined" ? window : globalThis);
