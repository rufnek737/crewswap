import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchingSearches,
  postMatchesSavedSearch,
  sanitizeSavedSearches,
  subscriberCanUsePost,
} from '../worker/premium-alerts.mjs';

const post = {
  id: 'POST-1',
  crewType: 'PILOT',
  ownerRole: 'FO_C',
  offered: {
    patternName: 'ICN-TAG 2박 패턴',
    summary: 'ICN-TAG · 2박 · TAG-ICN',
    type: '국제선',
    aircraft: 'NG',
    edto: true,
    cat3: false,
    days: [10, 11, 12, 13],
  },
};

test('saved search input is limited and unknown options are removed', () => {
  const result = sanitizeSavedSearches([{ id: 'A', keyword: ' TAG ', types: ['국제선', 'UNKNOWN'], nights: ['2plus', '9'] }]);
  assert.deepEqual(result, [{ id: 'A', label: '', keyword: 'TAG', types: ['국제선'], nights: ['2plus'] }]);
});

test('new post matches keyword, type, and layover length together', () => {
  assert.equal(postMatchesSavedSearch(post, { keyword: 'TAG', types: ['국제선'], nights: ['2plus'] }), true);
  assert.equal(postMatchesSavedSearch(post, { keyword: 'DPS', types: ['국제선'], nights: ['2plus'] }), false);
  assert.equal(postMatchesSavedSearch(post, { keyword: 'TAG', types: ['국내선'], nights: ['2plus'] }), false);
  assert.equal(matchingSearches(post, [{ id: 'A', keyword: 'TAG' }, { id: 'B', keyword: 'DPS' }]).length, 1);
});

test('airport keyword accepts Korean, English, IATA, and ICAO as the same airport', () => {
  const daNangPost = {
    ...post,
    offered: {
      ...post.offered,
      patternName: 'ICN-DAD 1박 패턴',
      summary: 'ICN-DAD · 1박 · DAD-ICN',
      layoverAirport: 'DAD',
    },
  };

  for (const keyword of ['다낭', 'Da Nang', 'DAD', 'VVDN', 'Da Nang International Airport']) {
    assert.equal(postMatchesSavedSearch(daNangPost, { keyword }), true, keyword);
  }
  assert.equal(postMatchesSavedSearch(daNangPost, { keyword: '보홀' }), false);
});

test('Bohol aliases and current/legacy ICAO codes all match TAG', () => {
  for (const keyword of ['보홀', 'Bohol', 'Panglao', 'TAG', 'RPSP', 'RPVT']) {
    assert.equal(postMatchesSavedSearch(post, { keyword }), true, keyword);
  }
});

test('push matching keeps pilot position and qualification rules', () => {
  assert.equal(subscriberCanUsePost({ crewType: 'PILOT', roleType: 'FO_B', aircraft: 'NG_MAX', edto: true }, post), true);
  assert.equal(subscriberCanUsePost({ crewType: 'PILOT', roleType: 'CAPTAIN_B', aircraft: 'NG_MAX', edto: true }, post), false);
  assert.equal(subscriberCanUsePost({ crewType: 'PILOT', roleType: 'FO_B', aircraft: 'NG', edto: false }, post), false);
  assert.equal(subscriberCanUsePost({ crewType: 'CABIN', roleType: 'PUR' }, post), false);
});

/* ── 객실 STBY·RSV 직급 제한 (Swap Guide 5-가·5-아) ──────────── */

test('객실 STBY 글은 동일·상위 직급에게만 알린다', () => {
  const stbyPost = { crewType: 'CABIN', ownerRole: 'SP', offered: { type: 'STBY' } };
  const cabin = (roleType, extra = {}) => ({ crewType: 'CABIN', roleType, hasBroadcastRating: true, ...extra });

  assert.equal(subscriberCanUsePost(cabin('SP'), stbyPost), true);   // 동일
  assert.equal(subscriberCanUsePost(cabin('CP'), stbyPost), true);   // 상위
  assert.equal(subscriberCanUsePost(cabin('PS'), stbyPost), false);  // 하위
  assert.equal(subscriberCanUsePost(cabin('CC'), stbyPost), false);
});

test('방송등급이 없으면 RSV 글 알림을 받지 않는다', () => {
  const rsvPost = { crewType: 'CABIN', ownerRole: 'CC', offered: { type: 'RSV' } };
  assert.equal(subscriberCanUsePost({ crewType: 'CABIN', roleType: 'CC', hasBroadcastRating: false }, rsvPost), false);
  assert.equal(subscriberCanUsePost({ crewType: 'CABIN', roleType: 'CC', hasBroadcastRating: true }, rsvPost), true);
});

test('일반 비행은 객실 직급을 제한하지 않는다', () => {
  // Swap Guide에 일반 비행의 직급 제한 조항은 없다. STBY·RSV에만 걸린다.
  const flightPost = { crewType: 'CABIN', ownerRole: 'CP', offered: { type: '국제선' } };
  assert.equal(subscriberCanUsePost({ crewType: 'CABIN', roleType: 'CC', hasBroadcastRating: false }, flightPost), true);
});

test('여러 날 중 하루라도 STBY면 제한이 걸린다', () => {
  const post = { crewType: 'CABIN', ownerRole: 'SP',
    offered: { type: '국내선', daySchedules: [{ type: '국내선' }, { type: 'STBY' }] } };
  assert.equal(subscriberCanUsePost({ crewType: 'CABIN', roleType: 'CC', hasBroadcastRating: true }, post), false);
});

/* ── LAYOV 유형칩 이전 + 편명 대조 (2026-10-02) ──────────────────────
 * LAYOV 칩은 한 건도 잡은 적이 없다(offered.type 은 패턴 첫날 = 아웃바운드 = 국제선).
 * 그냥 빼면 "KIX + LAYOV"가 키워드만 남아 퀵턴까지 받게 되므로, 제거가 아니라
 * 박수 1박 이상으로 옮긴다. */

const kixQuickTurn = { offered: { patternName: '10/16~10/16 · 국제선 패턴', type: '국제선',
  days: [16], summary: 'ICN-KIX-ICN',
  daySchedules: [{ day: 16, type: '국제선', title: '7C1151', routeSummary: 'ICN→KIX→ICN' }] } };

const kixOneNight = { offered: { patternName: '10/15~10/16 · 국제선 패턴', type: '국제선',
  days: [15, 16], summary: 'ICN-KIX · KIX-ICN',
  daySchedules: [{ day: 15, type: '국제선', title: '7C1151', routeSummary: 'ICN→KIX' },
                 { day: 16, type: '국제선', title: '7C1152', routeSummary: 'KIX→ICN' }] } };

function only(search, posts) {
  const [s] = sanitizeSavedSearches([{ id: 'x', ...search }]);
  return posts.filter(p => postMatchesSavedSearch(p, s));
}

test('LAYOV 를 저장해둔 조건은 박수 1박 이상으로 옮겨진다', () => {
  const [s] = sanitizeSavedSearches([{ id: 'x', keyword: 'KIX', types: ['LAYOV'] }]);
  assert.deepEqual(s.types, []);
  assert.deepEqual(s.nights, ['1', '2plus']);
});

test('옮긴 뒤 KIX 레이오버만 오고 퀵턴은 안 온다 — 원래 의도대로', () => {
  const hit = only({ keyword: 'KIX', types: ['LAYOV'] }, [kixQuickTurn, kixOneNight]);
  assert.deepEqual(hit, [kixOneNight]);
});

test('LAYOV 만 저장했어도 저장검색이 사라지지 않는다', () => {
  const [s] = sanitizeSavedSearches([{ id: 'x', types: ['LAYOV'] }]);
  assert.ok(s, '조건이 통째로 없어지면 안 된다');
  assert.deepEqual(s.nights, ['1', '2plus']);
});

test('박수를 직접 고른 사람의 선택은 덮어쓰지 않는다', () => {
  const [s] = sanitizeSavedSearches([{ id: 'x', types: ['LAYOV'], nights: ['quick'] }]);
  assert.deepEqual(s.nights, ['quick']);
});

test('LAYOV 는 더 이상 유형으로 저장되지 않는다', () => {
  const [s] = sanitizeSavedSearches([{ id: 'x', types: ['국제선', 'LAYOV', 'OFF'] }]);
  assert.deepEqual(s.types, ['국제선', 'OFF']);
});

test('편명으로 찾을 수 있다', () => {
  assert.deepEqual(only({ keyword: '7C1151' }, [kixQuickTurn, kixOneNight]),
    [kixQuickTurn, kixOneNight]);
  assert.deepEqual(only({ keyword: '7C1152' }, [kixQuickTurn, kixOneNight]), [kixOneNight]);
});

test('편명을 더해도 공항 키워드가 엉뚱한 글을 끌어오지 않는다', () => {
  assert.deepEqual(only({ keyword: 'NRT' }, [kixQuickTurn, kixOneNight]), []);
});
