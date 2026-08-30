// 조종사 등급(A/B/C) 스왑 가능 조합 판정.
//
// 목록 노출과 요청 가능 여부를 분리한다:
//   - 노출: 포지션만 본다. 기장은 기장 글 전체, 부기장은 부기장 글 전체가 보인다.
//   - 요청: 여기서 등급을 본다. 못 바꿀 글도 일단 보이되 요청 버튼이 막힌다.
// 등급 때문에 아예 안 보이면 "왜 내 글이 상대에게 안 뜨지"를 알 수 없어서,
// 보여주고 사유를 붙이는 쪽을 택했다.
(function attachCrewSwapGradePolicy(root) {
  // 내 등급에서 상대할 수 있는 등급. A는 모두, B는 A/B, C는 C만.
  const VIEWABLE_GRADES = Object.freeze({
    A: Object.freeze(["A", "B", "C"]),
    B: Object.freeze(["A", "B"]),
    C: Object.freeze(["C"]),
  });

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

  function allows(myGrade, theirGrade) {
    return (VIEWABLE_GRADES[myGrade] || []).includes(theirGrade);
  }

  // 스왑은 서로 주고받는 것이므로 양방향으로 본다. 한쪽만 보면 "내가 A라 상대 C 글을
  // 가져갈 수는 있지만, 상대 C는 내 A 스케줄을 못 타는" 깨진 교환이 통과한다.
  // 결과적으로 A↔B는 서로 가능하고 C는 C끼리만 가능하다.
  function isCompatible(myRole, theirRole) {
    const myGrade = gradeOf(myRole);
    const theirGrade = gradeOf(theirRole);
    if (!myGrade || !theirGrade) return true; // 판정 불가 — 막지 않는다
    return allows(myGrade, theirGrade) && allows(theirGrade, myGrade);
  }

  // 카드 렌더링·요청 진입에서 함께 쓰는 판정 결과.
  // status: PASS(요청 가능) / FAIL(요청 차단) / NA(등급 판정 대상 아님)
  function check(myRole, theirRole, { known = true } = {}) {
    if (!known) {
      return { status: "NA", reason: "", detail: "가입 후 등급이 확인되면 자동으로 판정합니다" };
    }
    const myGrade = gradeOf(myRole);
    const theirGrade = gradeOf(theirRole);
    if (!myGrade || !theirGrade) {
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
    if (!isCompatible(myRole, theirRole)) {
      const label = positionLabelOf(myRole);
      const mutual = (VIEWABLE_GRADES[myGrade] || []).filter(g => allows(g, myGrade));
      return {
        status: "FAIL",
        reason: `${myGrade}등급 ${label}은 ${mutual.join("/")}등급 ${label}과만 교환할 수 있습니다`,
        detail: `이 글: ${theirGrade}등급 ${label}`,
      };
    }
    return {
      status: "PASS",
      reason: "",
      detail: `${myGrade}등급 ${positionLabelOf(myRole)} · ${theirGrade}등급 교환 가능`,
    };
  }

  // 내 등급과 실제로 교환 가능한 등급 목록 (양방향 기준). 안내 문구용.
  function mutualGrades(myRole) {
    const myGrade = gradeOf(myRole);
    if (!myGrade) return [];
    return (VIEWABLE_GRADES[myGrade] || []).filter(g => allows(g, myGrade));
  }

  const api = {
    VIEWABLE_GRADES,
    positionOf,
    gradeOf,
    positionLabelOf,
    samePosition,
    isCompatible,
    mutualGrades,
    check,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapGradePolicy = api;
})(typeof window !== "undefined" ? window : globalThis);
