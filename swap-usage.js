(function attachCrewSwapUsage(root) {
  /* 객실승무원에게는 두 가지 한도가 있다(Swap Guide).
       Swap권   — 내가 스왑을 진행한 횟수. 월 2회·연 12회
       동의권   — 남의 요청을 수락한 횟수. 월 1회
     둘은 세는 대상이 달라 따로 센다. 동의권을 Swap권에 합치면 남을 도와준 것이
     내 스왑 횟수를 깎아먹는다. */

  // 한국 기준 달. 카운터는 달이 바뀌면 0부터 다시 센다 —
  // 초기화가 없으면 한도에 한 번 닿은 사람이 영영 막힌다.
  function monthKey(now = Date.now()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
    }).formatToParts(new Date(now));
    return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
  }

  // 해가 바뀌면 연 카운터도 리셋한다.
  const yearKey = (now = Date.now()) => monthKey(now).slice(0, 4);

  /* user 객체를 이번 달 기준으로 맞춘다. 달·해가 넘어갔으면 해당 카운터를 0으로.
     호출한 쪽에서 저장하면 된다. 바뀐 게 있으면 true를 돌려준다. */
  function rollOver(user, now = Date.now()) {
    if (!user || typeof user !== "object") return false;
    const m = monthKey(now), y = yearKey(now);
    let changed = false;
    if (user.swapCountMonth !== m) {
      user.swapCountMonth = m;
      user.monthlySwapUsed = 0;
      user.monthlyConsentUsed = 0;
      changed = true;
    }
    if (user.swapCountYear !== y) {
      user.swapCountYear = y;
      user.yearlySwapUsed = 0;
      changed = true;
    }
    return changed;
  }

  function summary(crewType, user = {}, rules = {}) {
    if (crewType !== "CABIN") {
      return { limited:false, status:"횟수 제한 없음", monthly:null, yearly:null, consent:null, level:"normal", warning:"" };
    }
    const monthlyLimit = Number(rules.swapLimitMonthly) || 2;
    const yearlyLimit = Number(rules.swapLimitYearly) || 12;
    const consentLimit = Number(rules.consentLimitMonthly) || 1;
    const monthlyUsed = Math.max(0, Number(user.monthlySwapUsed) || 0);
    const yearlyUsed = Math.max(0, Number(user.yearlySwapUsed) || 0);
    const consentUsed = Math.max(0, Number(user.monthlyConsentUsed) || 0);

    const exceeded = monthlyUsed > monthlyLimit || yearlyUsed > yearlyLimit;
    const reached = monthlyUsed >= monthlyLimit || yearlyUsed >= yearlyLimit;
    const consentReached = consentUsed >= consentLimit;

    const remainMonthly = Math.max(0, monthlyLimit - monthlyUsed);
    const remainYearly = Math.max(0, yearlyLimit - yearlyUsed);
    const remainConsent = Math.max(0, consentLimit - consentUsed);

    return {
      limited:true,
      status: exceeded ? "SWAP 횟수 한도 초과" : reached ? "SWAP 횟수 한도 도달" : "이용 가능",
      monthly:{ used:monthlyUsed, limit:monthlyLimit, remaining:remainMonthly },
      yearly:{ used:yearlyUsed, limit:yearlyLimit, remaining:remainYearly },
      consent:{ used:consentUsed, limit:consentLimit, remaining:remainConsent, reached:consentReached },
      level: exceeded ? "over" : reached ? "limit" : "normal",
      warning: exceeded
        ? "⚠ SWAP 횟수 한도를 초과했습니다. 회사 규정을 확인하세요."
        : reached
          ? "⚠ SWAP 횟수 한도에 도달했습니다. 추가 SWAP은 진행할 수 없습니다."
          : `남은 횟수 · 월 ${remainMonthly}회 · 연 ${remainYearly}회 · 동의 ${remainConsent}회`,
    };
  }

  /* 남의 요청을 수락할 수 있는지. 운항승무원은 동의권 제한이 없다. */
  function canConsent(crewType, user = {}, rules = {}) {
    if (crewType !== "CABIN") return { ok:true, used:0, limit:null };
    const limit = Number(rules.consentLimitMonthly) || 1;
    const used = Math.max(0, Number(user.monthlyConsentUsed) || 0);
    return {
      ok: used < limit,
      used, limit,
      reason: used < limit ? "" : `이번 달 Swap 동의권 ${limit}회를 모두 사용했습니다 (${used}/${limit}). 다음 달에 다시 수락할 수 있습니다.`,
    };
  }

  const api = { summary, canConsent, rollOver, monthKey, yearKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapUsage = api;
})(typeof window !== "undefined" ? window : globalThis);
