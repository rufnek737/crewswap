import test from 'node:test';
import assert from 'node:assert/strict';
import postDates from '../post-dates.js';

test('different months with the same day number are not duplicates', () => {
  const posts = [{
    status: 'active',
    registeredAt: '2026-07-07T00:00:00.000Z',
    offered: { patternName: '7/23~7/25 · 국제선→ARRIVAL 혼합 패턴' },
  }];
  assert.equal(postDates.findDuplicatePost(posts, ['2026-08-21', '2026-08-22', '2026-08-23']), null);
});

test('an overlapping full calendar date is blocked', () => {
  const post = {
    status: 'active',
    offered: { patternName: '8/21~8/23 · 국제선→ARRIVAL 혼합 패턴', dateKeys: ['2026-08-21', '2026-08-22', '2026-08-23'] },
  };
  assert.equal(postDates.findDuplicatePost([post], ['2026-08-23']), post);
});

test('expired posts do not block a new registration', () => {
  const posts = [{
    status: 'expired',
    offered: { patternName: '8/21~8/23 · 국제선→ARRIVAL 혼합 패턴', dateKeys: ['2026-08-21', '2026-08-22', '2026-08-23'] },
  }];
  assert.equal(postDates.findDuplicatePost(posts, ['2026-08-21']), null);
});

test('legacy ranges crossing New Year recover the correct year', () => {
  const post = {
    status: 'active',
    registeredAt: '2026-12-20T00:00:00.000Z',
    offered: { patternName: '12/31~1/2 · 국제선 패턴' },
  };
  assert.deepEqual(postDates.dateKeysForPost(post), ['2026-12-31', '2027-01-01', '2027-01-02']);
});
