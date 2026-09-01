// 연속 24시간 내 승무시간 한도 판정.
//
// 2026-08-31에 "연속 24시간내 승무시간 초과"로 회사 반려를 받았는데 앱은 "충족"이라고
// 답했다. 판정이 틀린 게 아니라 이 조건을 아예 보지 않았다 — RULES.JEJU_PILOT의
// consecutive24hLimit(7h)이 정의만 되고 읽는 코드가 없었다.
//
// 놓친 이유는 구조적이다. 선택한 날짜만 보면 각 비행은 한도 안이지만, 바로 앞뒤 근무와
// 겹치는 24시간 창에서 합계가 넘어간다. 그래서 여기서는 날짜 단위가 아니라 시각 축에
// 올려놓고 24시간 창을 굴린다.
(function attachCrewSwapDutyLimits(root) {
  // 공항별 UTC 오프셋(분). 로스터 시각이 전부 그 공항의 로컬 시각이라, 이걸 맞추지
  // 않으면 ICN(+9)과 DAD(+7) 사이에서 24시간 창이 2시간 어긋난다.
  // 제주항공 취항망은 전부 아시아·태평양이고 서머타임을 쓰는 곳이 없어 고정값으로 둔다.
  const UTC_OFFSET_MINUTES = (() => {
    const byOffset = {
      540: ["ICN","GMP","CJU","PUS","TAE","CJJ","MWX","RSU","USN","KPO","KWJ","WJU","HIN","KUV","YNY",
            "NRT","HND","KIX","FUK","NGO","CTS","OKA","KMQ","KMJ","KOJ","HIJ","MYJ","OIT","FSZ","SDJ","TAK"],
      480: ["PVG","SHA","PEK","PKX","TAO","YNT","WEH","HGH","NKG","HKG","MFM","TPE","KHH",
            "MNL","CEB","TAG","DPS","BKI","KUL","SIN","UBN"],
      420: ["DAD","CXR","SGN","HAN","BKK","DMK","CNX","HKT","CGK","VTE","LPQ","PNH","REP","SAI"],
      600: ["GUM","SPN"],
    };
    const map = new Map();
    Object.entries(byOffset).forEach(([offset, codes]) => {
      codes.forEach(code => map.set(code, Number(offset)));
    });
    return map;
  })();

  const DEFAULT_OFFSET = 540; // 모르는 공항은 KST로 본다 (국내선이 압도적으로 많다)

  function offsetOf(airport) {
    const code = String(airport || "").trim().toUpperCase();
    return UTC_OFFSET_MINUTES.has(code) ? UTC_OFFSET_MINUTES.get(code) : DEFAULT_OFFSET;
  }

  const NON_DUTY_TYPES = new Set(["OFF", "VAC", "VAC_A", "VAC_P", "UV_ML", "OFFMED"]);

  function entryDate(entry) {
    if (!entry || !/^\d{4}-\d{2}$/.test(entry.month || "") || !entry.day) return null;
    const date = new Date(`${entry.month}-${String(entry.day).padStart(2, "0")}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // "HH:MM" 또는 "HH:MM+1"을 그 공항 로컬 기준 분으로. +1은 다음날.
  function parseLocalMinutes(time) {
    const match = /^(\d{1,2}):(\d{2})(\+\d)?$/.exec(String(time || "").trim());
    if (!match) return null;
    const extraDays = match[3] ? Number(match[3].slice(1)) : 0;
    return Number(match[1]) * 60 + Number(match[2]) + extraDays * 24 * 60;
  }

  // 로컬 시각 → 절대분(UTC 기준). 서로 다른 공항의 시각을 한 축에 올리기 위한 환산.
  function utcMinutes(entry, time, airport) {
    const date = entryDate(entry);
    const local = parseLocalMinutes(time);
    if (!date || local == null) return null;
    return Math.round(date.getTime() / 60000) + local - offsetOf(airport);
  }

  function isDutyEntry(entry) {
    return !!entry && !NON_DUTY_TYPES.has(String(entry.type || "").toUpperCase());
  }

  // 하루치 근무를 "언제 시작해서 승무시간이 얼마인가"로 환산한다.
  // CrewConnex는 하루를 한 덩어리로 주므로(2leg도 한 항목) 그 단위를 그대로 쓴다.
  function toSegment(entry) {
    if (!isDutyEntry(entry)) return null;
    const blockMinutes = Number.isFinite(entry.blockMinutes) ? entry.blockMinutes : null;
    if (!blockMinutes) return null; // RSV·STBY·LAYOV 등 승무시간이 없는 근무는 대상 아님
    // 출발시각이 없으면 신고시각으로 대신한다 — 창의 기준점만 필요하다.
    const startUtc = utcMinutes(entry, entry.departureTime, entry.dep)
      ?? utcMinutes(entry, entry.reportTime, entry.dep);
    if (startUtc == null) return null;
    return { entry, startUtc, blockMinutes };
  }

  // 승무시간은 있는데 시각을 못 읽어 창에 올리지 못한 근무. 이게 있으면 PASS라고
  // 단정하면 안 된다 — 오늘 반려처럼 "본 적 없는데 통과"가 되어버린다.
  function unreadableEntries(schedules) {
    return (schedules || []).filter(entry =>
      isDutyEntry(entry)
      && Number.isFinite(entry.blockMinutes) && entry.blockMinutes > 0
      && toSegment(entry) === null);
  }

  /* 어떤 24시간 창에서 승무시간 합계가 가장 큰지 찾는다.
     창의 왼쪽 끝을 각 근무의 시작점에 붙여보는 것으로 최대값을 찾을 수 있다.
     한 근무가 창 안에서 "시작"하면 그 승무시간 전체를 센다. */
  function worstWindow(schedules) {
    const segments = (schedules || []).map(toSegment).filter(Boolean)
      .sort((a, b) => a.startUtc - b.startUtc);
    if (!segments.length) return null;
    const WINDOW = 24 * 60;
    let worst = null;
    segments.forEach(anchor => {
      const inWindow = segments.filter(s =>
        s.startUtc >= anchor.startUtc && s.startUtc < anchor.startUtc + WINDOW);
      const totalMinutes = inWindow.reduce((sum, s) => sum + s.blockMinutes, 0);
      if (!worst || totalMinutes > worst.totalMinutes) {
        worst = { totalMinutes, startUtc: anchor.startUtc, entries: inWindow.map(s => s.entry) };
      }
    });
    return worst;
  }

  function formatHours(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  function entryLabel(entry) {
    const day = entry?.day ? `${entry.day}일` : "";
    const title = entry?.title || entry?.type || "";
    return [day, title].filter(Boolean).join(" ");
  }

  /* 판정 결과. limitHours를 넘으면 FAIL, warnHours 이상이면 WARN.
     판정할 수 없으면(승무시간 데이터 없음·시각 못 읽음) PASS가 아니라 WARN을 낸다. */
  function checkRolling24h(schedules, options = {}) {
    const limitHours = Number(options.limitHours) || 7;
    const warnHours = Number.isFinite(options.warnHours) ? options.warnHours : limitHours - 1;
    const limit = Math.round(limitHours * 60);
    const warnAt = Math.round(warnHours * 60);

    const unreadable = unreadableEntries(schedules);
    const worst = worstWindow(schedules);

    if (!worst) {
      return unreadable.length
        ? { status: "WARN", totalMinutes: 0, limitMinutes: limit,
            detail: `시각을 읽지 못한 근무 ${unreadable.length}건이 있어 자동 판정 불가 — 직접 확인 필요` }
        : { status: "PASS", totalMinutes: 0, limitMinutes: limit,
            detail: "승무시간이 있는 근무 없음" };
    }

    const total = worst.totalMinutes;
    const names = worst.entries.map(entryLabel).filter(Boolean).join(" + ");
    const base = `최대 24시간 ${formatHours(total)} / ${formatHours(limit)}${names ? ` (${names})` : ""}`;
    const caveat = unreadable.length
      ? ` · 시각을 읽지 못한 근무 ${unreadable.length}건은 계산에서 빠짐`
      : "";

    if (total > limit) {
      return { status: "FAIL", totalMinutes: total, limitMinutes: limit,
               entries: worst.entries, detail: `${base} — 한도 초과${caveat}` };
    }
    if (unreadable.length) {
      return { status: "WARN", totalMinutes: total, limitMinutes: limit,
               entries: worst.entries, detail: `${base}${caveat}` };
    }
    if (total >= warnAt) {
      return { status: "WARN", totalMinutes: total, limitMinutes: limit,
               entries: worst.entries, detail: `${base} — 한도 근접` };
    }
    return { status: "PASS", totalMinutes: total, limitMinutes: limit,
             entries: worst.entries, detail: base };
  }

  const api = {
    UTC_OFFSET_MINUTES,
    DEFAULT_OFFSET,
    offsetOf,
    utcMinutes,
    toSegment,
    worstWindow,
    checkRolling24h,
    formatHours,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapDutyLimits = api;
})(typeof window !== "undefined" ? window : globalThis);
