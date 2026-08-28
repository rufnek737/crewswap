/* 스왑 찾기 자동 필터 — 글이 목록에서 빠지는 '이유'를 한 곳에서 판정한다.
 *
 * 매칭 점수(matchScore)와 빈 목록 안내가 서로 다른 기준을 쓰면
 * "왜 안 보이는지"를 잘못 설명하게 되므로, 두 곳이 이 함수 하나를 같이 쓴다.
 *
 * reasonFor()는 제외 사유 코드를 돌려주고, 통과하면 null을 돌려준다.
 */
(function attachCrewSwapMatchExclusions(root) {
  const FLIGHT_QUALS = ["edto", "cat3"];

  const LABELS = {
    airline:  "다른 항공사 글",
    crewType: "다른 직군(조종사·객실) 글",
    position: "다른 직책(기장·부기장) 글",
    aircraft: "내 기종 자격으로 못 받는 글",
    edto:     "EDTO 자격이 필요한 글",
    cat3:     "CAT III 자격이 필요한 글",
    deadline: "회사 제출 마감이 지난 글",
  };

  // 마감 지남 여부는 호출부가 계산해 넘긴다(영업일 역산이 앱 쪽 규정 테이블에 있다).
  function reasonFor(post, user, options = {}) {
    if (!post) return null;
    const expired = !!options.expired;
    const airline = post.airline || "JEJU";
    const crewType = post.crewType || "PILOT";
    if (airline !== user.airline) return "airline";
    if (crewType !== user.crewType) return "crewType";

    // 객실은 포지션·기종·특수자격을 보지 않는다(직책 규정은 룰 체크에서 안내).
    if (user.crewType === "CABIN") return expired ? "deadline" : null;

    const myPosition = String(user.roleType || "").startsWith("CAPTAIN") ? "CAPTAIN" : "FO";
    const postPosition = String(post.ownerRole || "").startsWith("CAPTAIN") ? "CAPTAIN" : "FO";
    if (myPosition !== postPosition) return "position";

    const offered = post.offered || {};
    const aircraftOK = !offered.aircraft
      || user.aircraft === "NG_MAX"
      || offered.aircraft === user.aircraft;
    if (!aircraftOK) return "aircraft";

    for (const qual of FLIGHT_QUALS) {
      if (offered[qual] && !user[qual]) return qual;
    }
    return expired ? "deadline" : null;
  }

  // 사유별 건수 — 빈 목록 안내에서 "무엇 때문에 안 보이는지" 그대로 보여준다.
  function summarize(entries) {
    const counts = new Map();
    (entries || []).forEach(reason => {
      if (!reason) return;
      counts.set(reason, (counts.get(reason) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => ({ reason, count, label: LABELS[reason] || reason }));
  }

  const api = { reasonFor, summarize, LABELS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapMatchExclusions = api;
})(typeof window !== "undefined" ? window : globalThis);
