const MAX_SEARCHES = 20;
const MAX_TEXT_LENGTH = 120;

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
    const haystack = [
      offered.patternName,
      offered.summary,
      offered.region,
      offered.type,
      offered.layoverAirport,
    ].filter(Boolean).join(" ").toUpperCase();
    const tokens = search.keyword.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (tokens.length && !tokens.some(token => haystack.includes(token))) return false;
  }

  return true;
}

export function matchingSearches(post, searches) {
  return sanitizeSavedSearches(searches).filter(search => postMatchesSavedSearch(post, search));
}

export function subscriberCanUsePost(profile, post) {
  if (!profile || !post) return false;
  if (profile.crewType && post.crewType && profile.crewType !== post.crewType) return false;

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
