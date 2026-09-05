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

export function sanitizeSavedSearches(searches) {
  const typeOptions = ["OFF", "국내선", "국제선", "LAYOV", "RSV", "STBY"];
  const nightOptions = ["quick", "1", "2plus"];

  if (!Array.isArray(searches)) return [];
  return searches.slice(0, MAX_SEARCHES).map((search, index) => ({
    id: cleanText(search?.id) || `SERVER-${Date.now()}-${index}`,
    label: cleanText(search?.label),
    keyword: cleanText(search?.keyword),
    types: cleanList(search?.types, typeOptions),
    nights: cleanList(search?.nights, nightOptions),
  })).filter(search => search.keyword || search.types.length || search.nights.length);
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
    const sourceText = [
      offered.patternName,
      offered.summary,
      offered.region,
      offered.type,
      offered.layoverAirport,
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
  return gradePolicy.isCompatible(profile?.roleType, post?.ownerRole);
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
