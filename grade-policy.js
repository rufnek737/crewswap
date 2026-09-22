// 조종사 포지션 판정.
//
// 스왑 상대는 같은 포지션이어야 한다 — 기장 자리는 기장이, 부기장 자리는 부기장이 채운다.
//
// **등급(A/B/C)은 스왑 상대를 가리는 기준이 아니다.** 예전에는 여기에 사용자끼리의 등급
// 궁합표(A↔A/B, C는 C끼리)가 있었는데 출처가 없었고, app.js 의 편조표와 C등급이 정반대라
// 같은 화면에서 서로 다른 답을 냈다. 둘 다 프로토타입 첫 커밋부터 근거 없이 있던 것이다.
//
// 실제 규정은 사람 대 사람이 아니라 **조종석 안의 조합**이다 — 기장 등급에 따라 함께 탈 수
// 있는 부기장 등급이 정해진다(운항본부 인사관리 지침 「등급에 따른 승무원 비행편조」).
// 그 판정은 내가 가져올 비행의 부기장 등급을 보는 crewPairingCheck() 이 한다.
(function attachCrewSwapGradePolicy(root) {
  /* 등급에 따른 승무원 비행편조 — 운항본부 인사관리 지침.
     기장 등급이 함께 탈 수 있는 부기장 등급을 정한다. 표는 여기 하나만 둔다 —
     app.js 에 사본이 따로 있어 C등급이 서로 반대로 적혀 있었다. */
  const PAIRING = Object.freeze({
    A: Object.freeze(["A", "B", "C"]),
    B: Object.freeze(["A", "B"]),
    C: Object.freeze(["A"]),
  });

  /* 내 등급이 상대 좌석에서 받아들일 수 있는 등급 목록.
     기장이면 표를 그대로, 부기장이면 나를 포함하는 기장 등급들을 거꾸로 찾는다. */
  function allowedOpposite(roleType) {
    const grade = gradeOf(roleType);
    if (!grade) return [];
    if (positionOf(roleType) === "CAPTAIN") return [...(PAIRING[grade] || [])];
    return Object.keys(PAIRING).filter(capt => PAIRING[capt].includes(grade));
  }

  /* 상대 좌석 등급을 모르면 null — 호출한 쪽이 막을지 경고할지 정한다. */
  function pairs(roleType, oppositeGrade) {
    const allowed = allowedOpposite(roleType);
    if (!allowed.length) return null;
    if (!oppositeGrade) return allowed.length >= 3 ? true : null;
    return allowed.includes(oppositeGrade);
  }

  /* 편조표는 양방향이라, 한 좌석의 등급을 알면 반대 좌석이 좁혀진다.
   *
   *   C등급이 타고 있다  →  반대 좌석은 반드시 A     (한 가지로 확정)
   *   B등급이 타고 있다  →  반대 좌석은 A 또는 B
   *   A등급이 타고 있다  →  좁혀지지 않는다
   *
   * 회사가 규정을 지켜 편성했다는 전제다. 상대가 이 앱에 가입하지 않았어도, 글을 올린
   * 사람의 등급만 알면 그 비행의 반대 좌석을 이만큼은 알 수 있다.
   */
  function narrowOpposite(roleType) {
    const candidates = allowedOpposite(roleType);
    return candidates.length && candidates.length < 3 ? candidates : null;
  }

  /* 반대 좌석이 여러 등급일 수 있을 때의 판정.
     전부 되면 true, 하나도 안 되면 false, 섞이면 null(확인 필요). */
  function pairsWithin(roleType, candidates) {
    const allowed = allowedOpposite(roleType);
    if (!allowed.length) return null;
    const list = (candidates || []).filter(Boolean);
    if (!list.length) return allowed.length >= 3 ? true : null;
    const ok = list.filter(g => allowed.includes(g));
    if (ok.length === list.length) return true;
    if (ok.length === 0) return false;
    return null;
  }

  function positionOf(roleType) {
    const code = String(roleType || "").toUpperCase();
    if (code.startsWith("CAPTAIN")) return "CAPTAIN";
    if (code.startsWith("FO")) return "FO";
    return null; // 객실 직급(CC/AP/PS/SP/CP) 등 — 등급 개념 없음
  }

  function gradeOf(roleType) {
    const match = /^(?:CAPTAIN|FO)_([ABC])$/.exec(String(roleType || "").toUpperCase());
    return match ? match[1] : null;
  }

  function positionLabelOf(roleType) {
    const position = positionOf(roleType);
    if (position === "CAPTAIN") return "기장";
    if (position === "FO") return "부기장";
    return "";
  }

  function samePosition(myRole, theirRole) {
    const mine = positionOf(myRole);
    const theirs = positionOf(theirRole);
    return !!mine && mine === theirs;
  }

  // 카드 렌더링·요청 진입에서 함께 쓰는 판정 결과.
  // status: PASS(요청 가능) / FAIL(요청 차단) / NA(판정 대상 아님)
  function check(myRole, theirRole, { known = true } = {}) {
    if (!known) {
      return { status: "NA", reason: "", detail: "가입 후 자동으로 판정합니다" };
    }
    if (!positionOf(myRole) || !positionOf(theirRole)) {
      return { status: "NA", reason: "", detail: "등급 판정 대상이 아닙니다" };
    }
    if (!samePosition(myRole, theirRole)) {
      const label = positionLabelOf(myRole);
      return {
        status: "FAIL",
        reason: `${label}↔${label} 간에만 교환할 수 있습니다`,
        detail: `내 포지션: ${label} · 이 글: ${positionLabelOf(theirRole)}`,
      };
    }
    return {
      status: "PASS",
      reason: "",
      detail: `${positionLabelOf(myRole)} · 교환 가능`,
    };
  }

  const api = { PAIRING, allowedOpposite, narrowOpposite, pairs, pairsWithin, positionOf, gradeOf, positionLabelOf, samePosition, check };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapGradePolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
