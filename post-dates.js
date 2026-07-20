(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrewSwapPostDates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function formatDateKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function closestYear(month, day, registeredAt) {
    const reference = new Date(registeredAt || '');
    const baseYear = Number.isNaN(reference.getTime()) ? new Date().getFullYear() : reference.getUTCFullYear();
    if (Number.isNaN(reference.getTime())) return baseYear;
    return [baseYear - 1, baseYear, baseYear + 1].reduce((best, year) => {
      const distance = Math.abs(Date.UTC(year, month - 1, day) - reference.getTime());
      return distance < best.distance ? { year, distance } : best;
    }, { year: baseYear, distance: Infinity }).year;
  }

  function expandRange(startYear, startMonth, startDay, endMonth, endDay) {
    const endYear = endMonth < startMonth ? startYear + 1 : startYear;
    const start = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));
    if (end < start) return [];
    const keys = [];
    for (let cursor = start; cursor <= end && keys.length < 62; cursor = new Date(cursor.getTime() + 86400000)) {
      keys.push(formatDateKey(cursor));
    }
    return keys;
  }

  function legacyPatternDateKeys(post) {
    const name = String(post?.offered?.patternName || '');
    const match = /^\s*(\d{1,2})\/(\d{1,2})\s*[~\-–]\s*(?:(\d{1,2})\/)?(\d{1,2})/.exec(name);
    if (!match) return [];
    const startMonth = Number.parseInt(match[1], 10);
    const startDay = Number.parseInt(match[2], 10);
    const endMonth = Number.parseInt(match[3] || match[1], 10);
    const endDay = Number.parseInt(match[4], 10);
    const deadlineYear = /^(\d{4})-\d{2}$/.exec(String(post?.deadlineMonth || ''))?.[1];
    const startYear = deadlineYear ? Number.parseInt(deadlineYear, 10) : closestYear(startMonth, startDay, post?.registeredAt);
    return expandRange(startYear, startMonth, startDay, endMonth, endDay);
  }

  function dateKeysForPost(post) {
    const exact = post?.offered?.dateKeys;
    if (Array.isArray(exact)) {
      const valid = [...new Set(exact.filter(key => DATE_KEY_RE.test(String(key))))];
      if (valid.length) return valid;
    }
    return legacyPatternDateKeys(post);
  }

  function findDuplicatePost(posts, selectedDateKeys) {
    const selected = new Set(selectedDateKeys || []);
    if (!selected.size) return null;
    return (posts || []).find(post => {
      if (!post || post.matched || (post.status && post.status !== 'active')) return false;
      return dateKeysForPost(post).some(key => selected.has(key));
    }) || null;
  }

  return { dateKeysForPost, findDuplicatePost };
});
