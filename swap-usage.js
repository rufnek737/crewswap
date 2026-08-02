(function attachCrewSwapUsage(root) {
  function summary(crewType, user = {}, rules = {}) {
    if (crewType !== "CABIN") {
      return { limited:false, status:"횟수 제한 없음", monthly:null, yearly:null, level:"normal", warning:"" };
    }
    const monthlyLimit = Number(rules.swapLimitMonthly) || 2;
    const yearlyLimit = Number(rules.swapLimitYearly) || 12;
    const monthlyUsed = Math.max(0, Number(user.monthlySwapUsed) || 0);
    const yearlyUsed = Math.max(0, Number(user.yearlySwapUsed) || 0);
    const exceeded = monthlyUsed > monthlyLimit || yearlyUsed > yearlyLimit;
    const reached = monthlyUsed >= monthlyLimit || yearlyUsed >= yearlyLimit;
    return {
      limited:true,
      status: exceeded ? "SWAP 횟수 한도 초과" : reached ? "SWAP 횟수 한도 도달" : "이용 가능",
      monthly:{ used:monthlyUsed, limit:monthlyLimit, remaining:Math.max(0, monthlyLimit - monthlyUsed) },
      yearly:{ used:yearlyUsed, limit:yearlyLimit, remaining:Math.max(0, yearlyLimit - yearlyUsed) },
      level: exceeded ? "over" : reached ? "limit" : "normal",
      warning: exceeded
        ? "⚠ SWAP 횟수 한도를 초과했습니다. 회사 규정을 확인하세요."
        : reached
          ? "⚠ SWAP 횟수 한도에 도달했습니다. 추가 SWAP은 진행할 수 없습니다."
          : `남은 횟수 · 월 ${Math.max(0, monthlyLimit - monthlyUsed)}회 · 연 ${Math.max(0, yearlyLimit - yearlyUsed)}회`,
    };
  }

  const api = { summary };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapUsage = api;
})(typeof window !== "undefined" ? window : globalThis);
