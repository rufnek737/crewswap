import '../airport-aliases.js';

const MAX_SEARCHES = 20;
const MAX_TEXT_LENGTH = 120;
const airportAliases = globalThis.CrewSwapAirportAliases;

function cleanText(value) {
  return String(value ?? "").trim().slice(0, MAX_TEXT_LENGTH);
}

function cleanList(value, allowed) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(v => allowed.includes(v)))];
}

/* 근무유형 칩에서 LAYOV 를 뺐다.
 *
 * 글의 `offered.type` 은 패턴 **첫날**의 유형인데, 레이오버 패턴의 첫날은 아웃바운드라
 * 언제나 `국제선`이다. LAYOV 는 중간 체류일에만 붙고 글에는 `layoverAirport` 도 안 실린다.
 * 그래서 이 칩은 처음부터 한 건도 잡은 적이 없다 — 눌러도 알림이 0건이었다.
 *
 * 그렇다고 그냥 빼면 더 나빠진다. "KIX + LAYOV"를 저장해둔 사람은 지금 0건을 받는데, 칩만
 * 없애면 키워드 KIX 만 남아 **퀵턴까지** 받게 된다. 원하던 것의 정반대다. LAYOV 만 저장한
 * 사람은 조건이 통째로 사라져 저장검색이 없어진다.
 *
 * 그래서 제거가 아니라 **이전(migration)** 한다. LAYOV 는 "밖에서 자고 오는 근무"라는 뜻이고,
 * 그건 박수 필터가 정확히 표현한다. 1박 이상(`1`,`2plus`)으로 옮기면 사용자가 원래 의도한
 * 것이 그대로 살아난다. 박수 판정은 일수 기반이라 2일 패턴(1박)도 제대로 잡는다. */
const SAVED_TYPE_OPTIONS = ["OFF", "국내선", "국제선", "RSV", "STBY"];
const SAVED_NIGHT_OPTIONS = ["quick", "1", "2plus"];
const LEGACY_LAYOVER_NIGHTS = ["1", "2plus"];

function migrateLayoverType(rawTypes, nights) {
  const hadLayover = Array.isArray(rawTypes)
    && rawTypes.some(t => cleanText(t) === "LAYOV");
  if (!hadLayover) return nights;
  // 이미 박수를 직접 고른 사람은 그 선택이 우선이다 — 덮어쓰지 않는다.
  if (nights.length) return nights;
  return [...LEGACY_LAYOVER_NIGHTS];
}

export function sanitizeSavedSearches(searches) {
  if (!Array.isArray(searches)) return [];
  return searches.slice(0, MAX_SEARCHES).map((search, index) => {
    const nights = cleanList(search?.nights, SAVED_NIGHT_OPTIONS);
    return {
      id: cleanText(search?.id) || `SERVER-${Date.now()}-${index}`,
      label: cleanText(search?.label),
      keyword: cleanText(search?.keyword),
      types: cleanList(search?.types, SAVED_TYPE_OPTIONS),
      nights: migrateLayoverType(search?.types, nights),
    };
  }).filter(search => search.keyword || search.types.length || search.nights.length);
}

export function postNights(post) {
  const offered = post?.offered || {};
  const match = /(\d+)\s*박/.exec(`${offered.summary || ""} ${offered.patternName || ""}`);
  if (match) return Number.parseInt(match[1], 10);
  if (offered.type === "LAYOV" || offered.layoverAirport) {
    return Math.max(1, (offered.days || []).length - 2);
  }
  if (offered.type === "국제선" || offered.type === "국내선") {
    const days = (offered.days || []).length;
    return days <= 1 ? 0 : Math.max(0, days - 1);
  }
  return null;
}

function nightsBucket(nights) {
  if (nights == null) return null;
  if (nights === 0) return "quick";
  return nights === 1 ? "1" : "2plus";
}

export function postMatchesSavedSearch(post, search) {
  const offered = post?.offered || {};
  if (search.types?.length && !search.types.includes(offered.type)) return false;

  if (search.nights?.length) {
    const bucket = nightsBucket(postNights(post));
    if (!bucket || !search.nights.includes(bucket)) return false;
  }

  if (search.keyword) {
    /* 편명(7C1551)으로도 찾을 수 있어야 한다. 편명은 글에 실려 있으나
       (`daySchedules[].title`) 여기 대조 대상에서 빠져 있었다. */
    const sourceText = [
      offered.patternName,
      offered.summary,
      offered.region,
      offered.type,
      offered.layoverAirport,
      ...(offered.daySchedules || []).map(day => day?.title),
    ].filter(Boolean).join(" ");
    if (!airportAliases.airportKeywordMatches(sourceText, search.keyword)) return false;
  }

  return true;
}

export function matchingSearches(post, searches) {
  return sanitizeSavedSearches(searches).filter(search => postMatchesSavedSearch(post, search));
}

// 급구 알림은 저장한 조건과 무관하게, 그 근무를 실제로 받을 수 있는 사람에게 간다.
// 직책·자격 판정은 기존 조건 알림과 같은 규칙을 쓰고, 등급 호환만 더한다.
export function subscriberCanTakeUrgentPost(profile, post, gradePolicy) {
  if (!subscriberCanUsePost(profile, post)) return false;
  if ((profile?.crewType || post?.crewType) !== "PILOT") return true;
  if (!gradePolicy.samePosition(profile?.roleType, post?.ownerRole)) return false;
  /* 등급은 사람 대 사람이 아니라 조종석 안의 조합이 규정이다. 이 글의 비행에서 내가 앉을
     자리의 반대 좌석 등급을 본다. 모르면 보낸다 — 알림을 과하게 거르면 받을 수 있는
     사람에게 급구가 닿지 않는다. */
  const seat = String(profile?.roleType || "").startsWith("CAPTAIN")
    ? post?.offered?.foGrade : post?.offered?.captainGrade;
  return gradePolicy.pairs(profile?.roleType, seat) !== false;
}

// 객실 직급 위계. Swap Guide 5-가: STBY(RSV 포함) 변경은 동일 혹은 상위 Duty만 가능.
const CABIN_RANK = { CC: 1, AP: 2, PS: 3, SP: 4, CP: 5 };

function postHasStandby(post) {
  const types = [post?.offered?.type, ...(post?.offered?.daySchedules || []).map(d => d?.type)];
  return types.some(t => t === 'RSV' || t === 'STBY');
}

/* 객실은 지금까지 직군만 보고 알림을 보냈다. 그래서 일반 승무원에게 수석사무장의
   STBY 글까지 갔다 — 규정상 받을 수 없는 근무의 알림이다.
   Swap Guide 5-가(동일·상위 직급)와 5-아(방송등급 미보유자는 RSV·공항대기 불가)를
   STBY·RSV가 포함된 글에만 적용한다. 일반 비행은 직급 제한 조항이 없어 그대로 둔다. */
function cabinCanUsePost(profile, post) {
  if (!postHasStandby(post)) return true;
  if (!profile.hasBroadcastRating) return false;
  const mine = CABIN_RANK[String(profile.roleType || '').toUpperCase()] || 0;
  const theirs = CABIN_RANK[String(post.ownerRole || '').toUpperCase()] || 0;
  if (!mine || !theirs) return true;      // 직급을 모르면 막지 않는다
  return mine >= theirs;
}

export function subscriberCanUsePost(profile, post) {
  if (!profile || !post) return false;
  if (profile.crewType && post.crewType && profile.crewType !== post.crewType) return false;
  if ((profile.crewType || post.crewType) === 'CABIN' && !cabinCanUsePost(profile, post)) return false;

  if ((profile.crewType || post.crewType) === "PILOT") {
    const myPosition = String(profile.roleType || "").startsWith("CAPTAIN") ? "CAPTAIN" : "FO";
    const postPosition = String(post.ownerRole || "").startsWith("CAPTAIN") ? "CAPTAIN" : "FO";
    if (myPosition !== postPosition) return false;

    const requiredAircraft = post.offered?.aircraft;
    if (requiredAircraft && profile.aircraft !== "NG_MAX" && profile.aircraft !== requiredAircraft) return false;
    if (post.offered?.edto && !profile.edto) return false;
    if (post.offered?.cat3 && !profile.cat3) return false;
  }

  return true;
}
