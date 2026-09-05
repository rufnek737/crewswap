/* 사번에서 입사 연월을 읽어낸다.
 *
 * 제주항공 사번은 앞 4자리가 입사 연월(YYMM)이다. 1707007 → 2017년 7월 입사.
 * 그래서 입사일을 따로 받을 필요가 없다 — 이미 받는 사번 하나로 연차가 나온다.
 * 개인정보를 하나 더 받지 않는 편이 언제나 낫다.
 *
 * 쓰이는 곳(객실 Swap Guide):
 *   7-가. AL 입사 13개월 후, AR 입사 6개월 후부터 가능
 *   5-자. C5~7년차 동 편조 매칭 제한
 */
(function attachCrewSeniority(root) {
  // 제주항공 설립이 2005년이라 그 이전 연도는 사번이 아니라고 본다.
  const FOUNDED_YEAR = 2005;

  function hireYearMonth(employeeId) {
    const digits = String(employeeId || "").replace(/\D/g, "");
    if (digits.length < 4) return null;
    const year = 2000 + Number(digits.slice(0, 2));
    const month = Number(digits.slice(2, 4));
    if (month < 1 || month > 12) return null;
    if (year < FOUNDED_YEAR) return null;
    return { year, month };
  }

  // 기준일까지 몇 개월 근속했는지. 일 단위는 사번에 없으므로 월 단위로만 센다.
  function monthsOfService(employeeId, now = new Date()) {
    const hired = hireYearMonth(employeeId);
    if (!hired) return null;
    const at = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(at.getTime())) return null;
    const months = (at.getFullYear() - hired.year) * 12 + (at.getMonth() + 1 - hired.month);
    return months < 0 ? null : months;   // 미래 사번은 판정하지 않는다
  }

  // 근속 연차. 입사 첫 해가 1년차라는 사내 표현을 따른다(만 나이가 아니다).
  function serviceYear(employeeId, now = new Date()) {
    const months = monthsOfService(employeeId, now);
    return months === null ? null : Math.floor(months / 12) + 1;
  }

  function meetsMonths(employeeId, requiredMonths, now = new Date()) {
    const months = monthsOfService(employeeId, now);
    return months === null ? null : months >= requiredMonths;   // 모르면 막지 않는다
  }

  function label(employeeId, now = new Date()) {
    const hired = hireYearMonth(employeeId);
    const year = serviceYear(employeeId, now);
    if (!hired || year === null) return null;
    return `${hired.year}년 ${hired.month}월 입사 · ${year}년차`;
  }

  const api = { hireYearMonth, monthsOfService, serviceYear, meetsMonths, label };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapSeniority = api;
})(typeof window !== "undefined" ? window : globalThis);
