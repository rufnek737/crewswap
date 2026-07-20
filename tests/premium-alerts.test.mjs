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

test('push matching keeps pilot position and qualification rules', () => {
  assert.equal(subscriberCanUsePost({ crewType: 'PILOT', roleType: 'FO_B', aircraft: 'NG_MAX', edto: true }, post), true);
  assert.equal(subscriberCanUsePost({ crewType: 'PILOT', roleType: 'CAPTAIN_B', aircraft: 'NG_MAX', edto: true }, post), false);
  assert.equal(subscriberCanUsePost({ crewType: 'PILOT', roleType: 'FO_B', aircraft: 'NG', edto: false }, post), false);
  assert.equal(subscriberCanUsePost({ crewType: 'CABIN', roleType: 'PUR' }, post), false);
});
