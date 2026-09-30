/* 올려둔 글과 최신 근무표를 대조한다.
 *
 * 글을 올릴 때 근무 내용은 그 시점 스냅샷으로 얼어붙는다(offered). 그런데 회사에서
 * 스케줄이 바뀌면 — 앱 밖에서 동기와 직접 바꾼 경우가 대표적이다 — 글에 적힌 근무는
 * 이미 내 것이 아니다. 그 글을 보고 요청을 보낸 사람은 성사될 수 없는 스왑에 크레딧을
 * 쓰게 된다. 그래서 근무표를 다시 불러올 때마다 여기서 대조한다.
 *
 * 서버는 회사 스케줄을 볼 수 없다. 앱이 근무표를 다시 불러와야만 알 수 있으므로,
 * 이 대조가 유일한 관문이다.
 *
 * 판정을 틀리면 멀쩡한 글이 내려간다. 그래서 확실할 때만 '바뀜'이라고 한다 —
 * 비교할 근거가 없으면(그 달을 안 불러왔다, 구버전 글이라 일자 정보가 없다) 건드리지
 * 않는다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrewSwapRosterSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function monthOf(entry, fallbackMonth) {
    return entry?.month || fallbackMonth || null;
  }

  function dayKey(month, day) {
    return `${month}-${String(day).padStart(2, '0')}`;
  }

  /* 같은 근무인지 판정하는 기준.
   * type 만 보면 국제선→국제선 노선 변경을 놓치고, title(편명)만 보면 편명이 없는
   * OFF·RSV 끼리 구분이 안 된다. 셋을 합쳐서 본다. */
  function signatureOf(entry) {
    const route = entry?.routeSummary
      || (entry?.dep && entry?.arr ? `${entry.dep}-${entry.arr}` : '')
      || entry?.layoverAirport
      || '';
    return [entry?.type || '', entry?.title || '', route].join('|');
  }

  function describe(entry) {
    if (!entry) return '없어짐';
    const route = entry.routeSummary
      || (entry.dep && entry.arr ? `${entry.dep}-${entry.arr}` : '')
      || entry.layoverAirport
      || '';
    /* 제목이 유형으로 시작하면(STBY 의 제목이 'STBY SB2') 유형을 또 붙이지 않는다. */
    const title = entry.title || '';
    const type = entry.type || '';
    const label = !title || title === type || title.startsWith(type)
      ? (title || type)
      : `${type} ${title}`;
    return route ? `${label} · ${route}` : label || '(내용 없음)';
  }

  function rosterIndex(roster, fallbackMonth) {
    const map = new Map();
    for (const entry of roster || []) {
      const month = monthOf(entry, fallbackMonth);
      if (!month || !entry?.day) continue;
      map.set(dayKey(month, entry.day), entry);
    }
    return map;
  }

  function monthsIn(roster, fallbackMonth) {
    const months = new Set();
    for (const entry of roster || []) {
      const month = monthOf(entry, fallbackMonth);
      if (month) months.add(month);
    }
    return months;
  }

  /* 글 하나를 최신 근무표와 대조한다.
   * → { status: 'unchanged' | 'changed' | 'unknown', changes: [...], reason? }
   *   'unknown' 은 판정할 근거가 없다는 뜻이다. 절대로 '바뀜'으로 취급하지 않는다. */
  function comparePostWithRoster(post, roster, fallbackMonth) {
    const offered = post?.offered || {};
    const entries = Array.isArray(offered.daySchedules) ? offered.daySchedules : [];
    if (!entries.length) {
      return { status: 'unknown', reason: 'no-day-schedules', changes: [] };
    }

    const loadedMonths = monthsIn(roster, fallbackMonth);
    if (!loadedMonths.size) {
      return { status: 'unknown', reason: 'empty-roster', changes: [] };
    }

    const index = rosterIndex(roster, fallbackMonth);
    const changes = [];
    let comparable = 0;

    for (const entry of entries) {
      const month = monthOf(entry, fallbackMonth);
      if (!month) continue;
      // 안 불러온 달은 판정하지 않는다. 없는 걸 '사라졌다'고 하면 안 된다.
      if (!loadedMonths.has(month)) continue;
      comparable++;
      const current = index.get(dayKey(month, entry.day)) || null;
      if (!current) {
        changes.push({ month, day: entry.day, before: describe(entry), after: '없어짐' });
        continue;
      }
      if (signatureOf(current) !== signatureOf(entry)) {
        changes.push({ month, day: entry.day, before: describe(entry), after: describe(current) });
      }
    }

    if (!comparable) return { status: 'unknown', reason: 'month-not-loaded', changes: [] };
    return changes.length ? { status: 'changed', changes } : { status: 'unchanged', changes: [] };
  }

  /* 내 글 전체를 훑어 내려야 할 것만 골라 준다.
   *
   * 이미 상호 수락된 글('submitting')은 일부러 뺀다. 두 사람이 합의를 끝내고 회사
   * 상신을 기다리는 중인데 앱이 한쪽 근무표만 보고 일방적으로 깨면 안 된다. 그 시점의
   * 판단은 당사자들이 회사와 함께 한다(Kay, 2026-09-30 결정). */
  function findStalePosts(posts, roster, fallbackMonth) {
    return (posts || [])
      .filter(p => p && (p.status === 'active' || !p.status) && !p.refunded)
      .map(post => ({ post, result: comparePostWithRoster(post, roster, fallbackMonth) }))
      .filter(x => x.result.status === 'changed')
      .map(x => ({ post: x.post, changes: x.result.changes }));
  }

  return { comparePostWithRoster, findStalePosts, signatureOf, describe };
});
