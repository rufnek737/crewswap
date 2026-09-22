/* 근무표에서 A등급을 확정적으로 읽어낸다.
 *
 * 편조표는 양방향이다. C등급은 A등급과만 편조하므로, **C등급인 사람이 그 비행에 타고
 * 있다는 사실 자체가 반대 좌석이 A임을 증명한다.** 그 사람이 이 앱에 가입하지 않았어도
 * 알 수 있다.
 *
 * A등급만 모은다. B·C 는 모으지 않는다 — 언젠가 상향되는 과도기 등급이라 쌓아두면
 * 시간이 지나며 틀린 답을 주게 된다. A는 종착 등급이라 특별한 일이 없으면 유지된다(Kay).
 * 덕분에 명단에 오르는 것은 최상위 등급뿐이라, 누군가에게 불리한 기록이 되지 않는다.
 *
 * B등급 사용자의 근무표로는 아무것도 확정할 수 없다 — 반대 좌석이 A일 수도 B일 수도 있다.
 */
(function attachCrewGrades(root) {
  // 근무표 Pos 열의 좌석 코드. 워커 파서와 같은 표를 쓴다 — 사본을 두면 어긋난다.
  const CAPTAIN_CODES = /^(C|H|L|K|2C|2NC|C1|C2|PC|NC|3PC|3NC)$/i;
  const FO_CODES = /^(F|2F|2NF|F1|F2|3F)$/i;

  function seatOf(position) {
    const code = String(position || "").trim();
    if (!code) return null;
    if (CAPTAIN_CODES.test(code) || /Capt|PIC/i.test(code)) return "CAPTAIN";
    if (FO_CODES.test(code) || /^FO\b/i.test(code)) return "FO";
    return null; // 객실 직책(PUR·FA 등)과 알 수 없는 코드
  }

  /* "김제주(Capt), 이운항(FO), 김애경(PUR)" → [{ name, seat }] */
  function parseCrew(crewComposition) {
    return String(crewComposition || "")
      .split(",")
      .map(part => /^(.+?)\s*\(([^)]*)\)\s*$/.exec(part.trim()))
      .filter(Boolean)
      .map(m => ({ name: m[1].trim(), seat: seatOf(m[2]) }))
      .filter(c => c.name && c.seat);
  }

  /* 근무 하나에서 A등급이 확정되는 사람들.
     내 등급이 C 일 때만 나온다 — B·A 는 반대 좌석을 한 가지로 좁히지 못한다. */
  function aGradesFromEntry(entry, myRole, gradePolicy) {
    if (!entry || gradePolicy.gradeOf(myRole) !== "C") return [];
    const mySeat = gradePolicy.positionOf(myRole);
    if (!mySeat) return [];
    const oppositeSeat = mySeat === "CAPTAIN" ? "FO" : "CAPTAIN";
    return parseCrew(entry.crewComposition)
      .filter(c => c.seat === oppositeSeat)
      .map(c => c.name);
  }

  /* 근무표 전체에서 A등급이 확정되는 이름 목록(중복 제거). */
  function aGradesFromRoster(entries, myRole, gradePolicy) {
    const names = new Set();
    for (const entry of entries || []) {
      for (const name of aGradesFromEntry(entry, myRole, gradePolicy)) names.add(name);
    }
    return [...names];
  }

  /* 알고 있는 A등급 명단으로 이 근무의 반대 좌석을 판정한다.
     편조원 이름이 하나도 없으면 null — 모른다는 뜻이고, 호출한 쪽이 경고할지 정한다. */
  function oppositeIsKnownA(entry, myRole, knownA, gradePolicy) {
    const mySeat = gradePolicy.positionOf(myRole);
    if (!mySeat) return null;
    const oppositeSeat = mySeat === "CAPTAIN" ? "FO" : "CAPTAIN";
    const opposite = parseCrew(entry?.crewComposition).filter(c => c.seat === oppositeSeat);
    if (!opposite.length) return null;
    const known = new Set(knownA || []);
    // 한 명이라도 명단에 없으면 확정할 수 없다 — 3인 편조에서는 기장이 둘일 수 있다.
    return opposite.every(c => known.has(c.name)) ? true : null;
  }

  const api = { seatOf, parseCrew, aGradesFromEntry, aGradesFromRoster, oppositeIsKnownA };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapCrewGrades = api;
})(typeof window !== "undefined" ? window : globalThis);
