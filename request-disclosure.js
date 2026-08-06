(function attachCrewSwapRequestDisclosure(root) {
  const EXCHANGE_DUTY_TYPES = new Set(["국내선", "국제선", "LAYOV", "ARRIVAL", "RSV", "STBY"]);

  function scheduleDateKey(entry, fallbackMonth) {
    const month = entry?.month || fallbackMonth;
    const day = Number(entry?.day);
    if (!/^\d{4}-\d{2}$/.test(month || "") || !Number.isInteger(day) || day < 1) return null;
    return `${month}-${String(day).padStart(2, "0")}`;
  }

  function offeredDateKeys(post, fallbackMonth) {
    const offered = post?.offered;
    if (!offered) return [];
    if (Array.isArray(offered.dateKeys) && offered.dateKeys.length) {
      return [...new Set(offered.dateKeys.filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)))].sort();
    }
    if (Array.isArray(offered.daySchedules) && offered.daySchedules.length) {
      return [...new Set(offered.daySchedules.map(item => scheduleDateKey(item, fallbackMonth)).filter(Boolean))].sort();
    }
    const month = String(offered.startDate || post.deadlineMonth || fallbackMonth || "").slice(0, 7);
    return [...new Set((offered.days || []).map(day => scheduleDateKey({ month, day }, month)).filter(Boolean))].sort();
  }

  // 상대가 올린 모든 날짜에 교환 가능한 내 근무가 존재하면 1:1 공개로 처리한다.
  // OFF·휴가·UNKNOWN 또는 날짜 누락이 있을 때만 전체 공개/숨기기 흐름으로 보낸다.
  function exactFlightEntries(post, schedules, fallbackMonth) {
    const targetKeys = offeredDateKeys(post, fallbackMonth);
    if (!targetKeys.length || !Array.isArray(schedules)) return null;
    const byDate = new Map();
    schedules.forEach(entry => {
      const key = scheduleDateKey(entry, fallbackMonth);
      if (key) byDate.set(key, entry);
    });
    const entries = targetKeys.map(key => byDate.get(key));
    if (entries.some(entry => !entry || !EXCHANGE_DUTY_TYPES.has(entry.type))) return null;

    // 같은 patternId의 인접 근무까지 합친 '전체 패턴'이 상대 게시글 날짜와 같아야 한다.
    // 예: 17~19일 패턴 중 17일만 날짜가 겹치는 경우는 1:1로 오인하지 않는다.
    const targetSet = new Set(targetKeys);
    const patternKeys = new Set();
    entries.forEach(anchor => {
      const anchorKey = scheduleDateKey(anchor, fallbackMonth);
      // RSV·STBY처럼 단일 근무로 저장되어 patternId가 없는 날도 날짜가 정확히
      // 일치하면 1:1 교환 대상으로 인정한다.
      if (!anchor.patternId) {
        patternKeys.add(anchorKey);
        return;
      }
      const samePattern = schedules
        .filter(item => item?.patternId === anchor.patternId && EXCHANGE_DUTY_TYPES.has(item.type))
        .map(item => ({ item, key: scheduleDateKey(item, fallbackMonth) }))
        .filter(item => item.key)
        .sort((a, b) => a.key.localeCompare(b.key));
      const anchorIndex = samePattern.findIndex(item => item.key === anchorKey);
      if (anchorIndex < 0) return;
      patternKeys.add(anchorKey);
      for (let i = anchorIndex - 1; i >= 0; i--) {
        const next = new Date(`${samePattern[i + 1].key}T00:00:00`);
        const current = new Date(`${samePattern[i].key}T00:00:00`);
        if (next - current !== 86400000 || samePattern[i].item.type === "ARRIVAL") break;
        patternKeys.add(samePattern[i].key);
      }
      for (let i = anchorIndex + 1; i < samePattern.length; i++) {
        const previous = new Date(`${samePattern[i - 1].key}T00:00:00`);
        const current = new Date(`${samePattern[i].key}T00:00:00`);
        if (current - previous !== 86400000 || samePattern[i - 1].item.type === "ARRIVAL") break;
        patternKeys.add(samePattern[i].key);
      }
    });
    if (patternKeys.size !== targetSet.size || [...patternKeys].some(key => !targetSet.has(key))) return null;
    return entries;
  }

  function disclosureHint(type, isDirect) {
    const credit = type === "ask" ? "크레딧 사용 없음." : "1크레딧이 사용됩니다.";
    return isDirect
      ? `1:1 날짜 매칭으로 교환할 내 비행만 상대에게 보여집니다. 다른 스케줄은 공개되지 않습니다. 신상정보는 상호 수락 후 공개, ${credit}`
      : `내 스케줄 전체가 상대에게 보여집니다. 상대가 바꿀 날을 고릅니다. 신상정보는 상호 수락 후 공개, ${credit}`;
  }

  const api = { scheduleDateKey, offeredDateKeys, exactFlightEntries, disclosureHint };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapRequestDisclosure = api;
})(typeof window !== "undefined" ? window : globalThis);
