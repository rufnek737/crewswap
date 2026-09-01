/* 연속 24시간 승무시간 한도 검사.
 *
 * 2026-08-31 실제 반려("SKD SWAP 신청건 반려 / 사유: 연속 24시간내 승무시간 초과")로 드러난
 * 구멍이다. RULES.JEJU_PILOT.consecutive24hLimit(7h)가 정의만 되어 있고 읽는 코드가 없었다.
 *
 * 핵심은 한도 값이 아니라 **보는 범위**다. 기존 룰 체크는 사용자가 고른 날짜만 봤는데,
 * 회사는 앞뒤 근무와 겹치는 24시간 창을 본다. 그래서 10일 비행 + 11일 비행이 각각은
 * 한도 안이어도 두 출발 시각이 24시간 안에 들어오면 합산되어 초과한다.
 *
 * 시각은 절대분(day*1440 + 분)으로 다룬다. 로스터는 현지 시각이 섞여 있고 '+1'(익일 도착)
 * 표기가 있어 문자열 비교로는 창을 못 잡는다.
 */
(function attachCrewSwapDutyWindow(root) {
  const WINDOW_MIN = 24 * 60;

  function parseAbsMinutes(day, time) {
    const m = /^(\d{1,2}):(\d{2})(\+1)?$/.exec(String(time || "").trim());
    if (!m || !Number.isInteger(day)) return null;
    return day * 1440 + parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? 1440 : 0);
  }

  // 월이 다른 근무를 한 줄에 놓기 위해 월을 일 수로 환산해 더한다.
  // 정확한 달력 일수까지 필요하지 않고, 인접 월 사이의 앞뒤 관계만 유지되면 된다.
  function dayIndexOf(entry, fallbackMonth) {
    const month = String(entry?.month || fallbackMonth || "");
    const day = Number(entry?.day);
    if (!Number.isInteger(day)) return null;
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return day;
    return (Number(m[1]) * 12 + Number(m[2])) * 31 + day;
  }

  // 승무시간(블록타임)이 있는 근무만 창 계산 대상이다.
  // OFF·RSV·STBY·지상근무는 승무시간이 없어 합산에 들어가지 않는다.
  function flightMinutesOf(entry) {
    if (typeof entry?.blockMinutes === "number" && entry.blockMinutes > 0) return entry.blockMinutes;
    return 0;
  }

  // 창의 기준 시각. 출두(C/I)가 있으면 그것을, 없으면 출발 시각을 쓴다.
  function startMinutesOf(entry, fallbackMonth) {
    const dayIdx = dayIndexOf(entry, fallbackMonth);
    if (dayIdx === null) return null;
    const t = entry?.reportTime || entry?.departureTime || null;
    return parseAbsMinutes(dayIdx, t);
  }

  function labelOf(entry, fallbackMonth) {
    const month = String(entry?.month || fallbackMonth || "");
    const mm = /^\d{4}-(\d{2})$/.exec(month);
    const monthNum = mm ? String(Number(mm[1])) : "";
    const day = entry?.day;
    const date = monthNum && day ? `${monthNum}/${day}` : day ? `${day}일` : "";
    const title = entry?.title || entry?.type || "근무";
    return date ? `${date} ${title}` : title;
  }

  function fmt(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }

  /* 각 비행의 시작 시각을 창의 왼쪽 끝으로 삼아, 그 시점부터 24시간 안에 시작하는
     모든 비행의 승무시간을 합산한다. 회사가 어느 지점을 기준으로 자르는지 알 수 없으므로
     가능한 모든 시작점을 검사해 가장 큰 합계를 찾는다. */
  function worstWindow(entries, fallbackMonth) {
    const flights = (Array.isArray(entries) ? entries : [])
      .map(e => ({ entry: e, start: startMinutesOf(e, fallbackMonth), minutes: flightMinutesOf(e) }))
      .filter(f => f.start !== null && f.minutes > 0)
      .sort((a, b) => a.start - b.start);
    if (!flights.length) return null;

    let worst = null;
    for (let i = 0; i < flights.length; i++) {
      const windowEnd = flights[i].start + WINDOW_MIN;
      let total = 0;
      const members = [];
      for (let j = i; j < flights.length && flights[j].start < windowEnd; j++) {
        total += flights[j].minutes;
        members.push(flights[j].entry);
      }
      if (!worst || total > worst.totalMinutes) {
        worst = { totalMinutes: total, entries: members };
      }
    }
    return worst;
  }

  /* 한도는 편조 구성에 따라 다르다(FOM 5.5.2.2).
       기장1 + 기장 외 조종사1 (2인 편조) → 승무시간 8시간
       기장2 + 부기장1 (3인 편조)        → 승무시간 12시간
     CrewConnex 근무코드가 3으로 시작하면(3PC·3NC 등) 3인 편조다. 발리(ICN-DPS)가 여기
     해당하고, 편도만으로 7h30이라 2인 편조 한도를 그대로 씌우면 정상 비행이 통째로 막힌다.

     창에 편조가 섞이면 더 엄격한 쪽(작은 한도)을 쓴다. 그 창 안에서 2인 편조로 비행하는
     구간이 있는 이상 그 구간의 한도를 넘길 수는 없기 때문이다.

     결과는 기존 룰 체크 카드와 같은 모양({status, label, detail, ref})으로 돌려준다. */
  function limitHoursFor(entry, limits) {
    return Number(entry?.crewSet) === 3 ? limits.augmented : limits.standard;
  }

  function check(entries, {
    limitHours = 8,
    augmentedLimitHours = 12,
    fallbackMonth = null,
    warnRatio = 0.85,
  } = {}) {
    const limits = { standard: limitHours, augmented: augmentedLimitHours };
    const worst = worstWindow(entries, fallbackMonth);

    if (!worst) {
      // 승무시간 데이터가 없으면 '통과'가 아니라 '판정 불가'로 알린다.
      // 검사하지 않은 것을 충족으로 보이게 하는 것이 이번 반려의 원인이었다.
      return {
        status: "NA",
        label: `연속 24시간 승무시간 (최대 ${limitHours}h)`,
        detail: "승무시간(BLH) 정보가 없어 판정할 수 없습니다 — 직접 확인 필요",
      };
    }

    const total = worst.totalMinutes;
    const appliedHours = Math.min(...worst.entries.map(e => limitHoursFor(e, limits)));
    const limitMin = appliedHours * 60;
    // FOM 5.5.2.2는 "연속 24시간 동안 **최대** 승무시간"이라 정확히 한도까지는 적법하다.
    // 따라서 초과(>)만 FAIL로 본다. 다만 한도에 근접하면 다른 근무를 하나도 더 얹을 수
    // 없다는 뜻이라 WARN으로 알린다.
    const status = total > limitMin ? "FAIL" : total >= limitMin * warnRatio ? "WARN" : "PASS";
    const crewNote = appliedHours === limits.augmented ? "3인 편조" : "2인 편조";
    const list = worst.entries.map(e => labelOf(e, fallbackMonth)).join(" + ");
    const detail = status === "PASS"
      ? `최대 ${fmt(total)} (${crewNote} 한도 ${appliedHours}시간)`
      : `${list} = ${fmt(total)} · ${crewNote} 한도 ${appliedHours}시간`;

    return {
      status,
      label: `연속 24시간 승무시간 (최대 ${appliedHours}h)`,
      detail,
      limitHours: appliedHours,
      totalMinutes: total,
      entries: worst.entries,
    };
  }

  const api = { check, worstWindow, WINDOW_MIN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapDutyWindow = api;
})(typeof window !== "undefined" ? window : globalThis);
