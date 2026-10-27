/* 「나만의 편조 알림」(무료) — 등록한 사람(최대 2명)과 같은 비행을 하게 되는 스왑을 최종 단계 전에 알려준다.
 * 막지는 않는다 — 진행할지는 본인이 고른다(2026-10-27 Kay).
 *
 * 누구를 피하고 싶은지는 아주 민감한 정보다. 이름은 `avoid:<이메일>` 에만 두고 응답·로그·
 * 알림 어디에도 싣지 않는다. 판정은 서버가 하고 기기에는 참/거짓만 내려 보낸다.
 * 비교 대상은 **내가 받게 될 근무의 편조** — 그 근무 주인의 서버 근무표(날짜별 편조)로 본다.
 * 글에 대표로 붙은 첫날 편조(crewPublic)는 여러 날짜 글에서 틀리므로 쓰지 않는다.
 * 스왑 상대 본인이 그 사람인 것은 막지 않는다(같이 비행하는 게 아니므로, Kay 결정). */

export const AVOID_KEY = email => `avoid:${String(email || '').trim().toLowerCase()}`;

// 입력한 그대로 맞춘다(동명이인 구분 접미사 「김정민A」 포함). 공백만 정리한다.
export function normalizeAvoidName(value) {
  const name = String(value || '').replace(/\s+/g, '').slice(0, 20);
  return /^[가-힣A-Za-z]{2,20}$/.test(name) ? name : '';
}

// 「김제주(Capt), 이운항(FO), 김애경(PUR)」 → ['김제주','이운항','김애경']
export function crewNames(crewComposition) {
  return String(crewComposition || '')
    .split(',')
    .map(part => part.replace(/\(.*$/, '').replace(/\s+/g, '').trim())
    .filter(Boolean);
}

// 근무 묶음이 차지하는 날짜 키(YYYY-MM-DD). dateKeys 가 없으면 daySchedules·days 로 만든다.
export function dateKeysOf(offered, fallbackMonth = '') {
  if (Array.isArray(offered?.dateKeys) && offered.dateKeys.length) return offered.dateKeys.map(String);
  if (Array.isArray(offered?.daySchedules) && offered.daySchedules.length) {
    return offered.daySchedules
      .filter(s => /^\d{4}-\d{2}$/.test(String(s?.month || '')) && Number.isInteger(Number(s?.day)))
      .map(s => `${s.month}-${String(s.day).padStart(2, '0')}`);
  }
  const month = /^\d{4}-\d{2}$/.test(String(offered?.month || fallbackMonth)) ? (offered?.month || fallbackMonth) : '';
  return month ? (offered?.days || []).map(d => `${month}-${String(d).padStart(2, '0')}`) : [];
}

export const AVOID_MAX = 2;

// 저장 기록 → 이름 목록. 예전 기록은 { name } 하나였다.
export function avoidNamesOfRecord(rec) {
  const list = Array.isArray(rec?.names) ? rec.names : rec?.name ? [rec.name] : [];
  return list.map(normalizeAvoidName).filter(Boolean).slice(0, AVOID_MAX);
}

// schedules: 근무 주인의 서버 근무표. 그 날짜들의 편조에 names 중 누가 있으면 true.
export function dutyHasPerson(schedules, keys, names) {
  const list = [].concat(names || []).filter(Boolean);
  if (!list.length || !Array.isArray(schedules) || !keys?.length) return false;
  const wanted = new Set(keys);
  return schedules.some(s => {
    const key = `${s?.month}-${String(s?.day).padStart(2, '0')}`;
    return wanted.has(key) && crewNames(s?.crewComposition).some(n => list.includes(n));
  });
}

// 날짜별로 걸리는 날만 골라낸다(상대 공개 근무표에서 고를 수 없는 날 표시용).
export function blockedKeys(schedules, keys, names) {
  return (keys || []).filter(k => dutyHasPerson(schedules, [k], names));
}
