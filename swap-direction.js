/* 방향 변환 필터 — '오전→오후', '비행→OFF' 같은 스왑 방향으로 글을 거른다.
 *
 * 등록 화면의 '원하는 조건' 칩이 자유 메모(#postMemo)로 바뀌면서 새로 등록되는 글에는
 * wanted.types / wanted.time 이 더 이상 담기지 않는다. 그런데 필터는 계속 그 두 필드를
 * 읽고 있어서, 방향 칩을 누르는 순간 wanted.types 가 undefined 라 예외가 나고
 * 매칭 목록이 통째로 그려지지 않았다(= 스왑 글이 안 보임).
 *
 * 그래서 판정 기준을 이렇게 둔다.
 *   - 내놓는 근무(offered)는 모든 글에 있으므로 항상 확인한다.
 *   - 희망 조건(wanted)은 구버전 글의 구조화된 값 → 없으면 메모에서 읽어낸 값 순으로 쓰고,
 *     어느 쪽으로도 알 수 없으면 '조건 없음'으로 보고 통과시킨다.
 *     알 수 없다는 이유로 글을 감추면 다시 "아무것도 안 보인다"가 되기 때문.
 */
(function attachCrewSwapDirection(root) {
  const FLIGHT_TYPES = ["국내선", "국제선", "LAYOV"];

  // 메모에서 희망 근무 유형을 읽어낸다. 부정문("대기 없는 날")까지 해석하지는 않으므로
  // 오탐이 적은 표현만 넣는다.
  const TYPE_KEYWORDS = [
    ["OFF", /\bOFF\b|오프|휴무|쉬는\s?날/i],
    ["RSV", /\bRSV\b|리저브/i],
    ["STBY", /\bSTBY\b|스탠바이/i],
    ["국내선", /국내/],
    ["국제선", /국제/],
    ["LAYOV", /LAYOV|레이오버|체류/i],
    ["비행(전체)", /비행/],
    ["아무거나", /아무거나|상관없|무관/],
  ];
  const TIME_KEYWORDS = [
    ["AM", /오전|아침|\bAM\b/i],
    ["PM", /오후|저녁|\bPM\b/i],
  ];

  function wantedSignals(post) {
    const wanted = (post && post.wanted) || {};
    const types = new Set((Array.isArray(wanted.types) ? wanted.types : []).filter(Boolean));
    const times = new Set((Array.isArray(wanted.time) ? wanted.time : []).filter(Boolean));
    if (!types.size && !times.size) {
      const memo = String(wanted.memo || "");
      if (memo.trim()) {
        TYPE_KEYWORDS.forEach(([type, re]) => { if (re.test(memo)) types.add(type); });
        TIME_KEYWORDS.forEach(([slot, re]) => { if (re.test(memo)) times.add(slot); });
      }
    }
    // 유형·시간대는 따로 판정한다. "OFF 주세요"처럼 한쪽만 알 수 있는 메모가 흔하다.
    return { types, times, typesKnown: types.size > 0, timesKnown: times.size > 0 };
  }

  function wantsType(signals, candidates) {
    if (!signals.typesKnown) return true;
    if (signals.types.has("아무거나")) return true;
    return candidates.some(type => signals.types.has(type));
  }

  function wantsFlight(signals) {
    if (!signals.typesKnown) return true;
    if (signals.types.has("아무거나") || signals.types.has("비행(전체)")) return true;
    return FLIGHT_TYPES.some(type => signals.types.has(type));
  }

  function wantsTime(signals, slot) {
    if (!signals.timesKnown) return true;
    return signals.times.has(slot);
  }

  function offeredType(post) {
    return (post && post.offered && post.offered.type) || "";
  }

  // 출근 시간대 — 목록 필터(state.filters.time)와 같은 기준(10시)을 쓴다.
  function offeredSlot(post) {
    const reportTime = post && post.offered && post.offered.reportTime;
    if (!reportTime || !/^\d/.test(reportTime)) return null;
    return reportTime < "10:00" ? "AM" : "PM";
  }

  function matches(post, direction) {
    if (!post || !direction || direction === "all") return true;
    const signals = wantedSignals(post);
    const offered = offeredType(post);
    switch (direction) {
      case "AM_TO_PM":    return offeredSlot(post) === "AM" && wantsTime(signals, "PM");
      case "PM_TO_AM":    return offeredSlot(post) === "PM" && wantsTime(signals, "AM");
      case "FLY_TO_OFF":  return FLIGHT_TYPES.includes(offered) && wantsType(signals, ["OFF"]);
      case "OFF_TO_FLY":  return offered === "OFF" && wantsFlight(signals);
      case "RSV_TO_OFF":  return offered === "RSV" && wantsType(signals, ["OFF"]);
      case "OFF_TO_RSV":  return offered === "OFF" && wantsType(signals, ["RSV"]);
      case "LAY_TO_DOM":  return offered === "LAYOV" && wantsType(signals, ["국내선"]);
      case "INTL_TO_DOM": return offered === "국제선" && wantsType(signals, ["국내선"]);
      default: return false;
    }
  }

  // 등록 화면의 '예상 후보 수' 계산도 같은 희망 조건 해석을 쓴다.
  function wantsOfferedType(post, type) {
    if (!type) return false;
    const signals = wantedSignals(post);
    if (FLIGHT_TYPES.includes(type)) return wantsType(signals, [type]) || wantsFlight(signals);
    return wantsType(signals, [type]);
  }

  const api = { matches, wantedSignals, wantsOfferedType, FLIGHT_TYPES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapSwapDirection = api;
})(typeof window !== "undefined" ? window : globalThis);
