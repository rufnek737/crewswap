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
