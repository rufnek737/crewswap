import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rosterSync = require('../roster-sync.js');

// Kay 의 실제 사례(2026-09-30). 앱 밖에서 동기와 스케줄을 바꿨고, 회사 근무표에서
// 10/26~28 이 비행에서 STBY·RSV 로 바뀌었는데 올려둔 글은 그대로 남아 있었다.
const kayPost = {
  id: 'P1',
  status: 'active',
  offered: {
    patternName: '10/26~10/28 · 국제선→국내선 혼합 패턴',
    daySchedules: [
      { month: '2026-10', day: 26, type: '국제선', title: '7C1301', routeSummary: 'ICN→KIX→ICN' },
      { month: '2026-10', day: 27, type: '국내선', title: '7C105', routeSummary: 'GMP→CJU→TAE→TAE' },
      { month: '2026-10', day: 28, type: '국내선', title: '7C107', routeSummary: 'TAE→CJU→GMP→CJU→GMP' },
    ],
  },
};

const newRoster = [
  { month: '2026-10', day: 26, type: 'STBY', title: 'SB2' },
  { month: '2026-10', day: 27, type: 'RSV', title: 'RSV' },
  { month: '2026-10', day: 28, type: 'RSV', title: 'RSV' },
];

test('회사가 근무를 바꾸면 바뀐 날을 전부 집어낸다', () => {
  const r = rosterSync.comparePostWithRoster(kayPost, newRoster, '2026-10');
  assert.equal(r.status, 'changed');
  assert.deepEqual(r.changes.map(c => c.day), [26, 27, 28]);
  assert.match(r.changes[0].after, /STBY/);
  assert.match(r.changes[0].before, /ICN→KIX→ICN/);
});

test('근무표가 그대로면 건드리지 않는다', () => {
  const same = kayPost.offered.daySchedules.map(s => ({ ...s }));
  const r = rosterSync.comparePostWithRoster(kayPost, same, '2026-10');
  assert.equal(r.status, 'unchanged');
  assert.equal(r.changes.length, 0);
});

test('같은 국제선이라도 노선이 바뀌면 잡는다', () => {
  const roster = [
    { month: '2026-10', day: 26, type: '국제선', title: '7C1301', routeSummary: 'ICN→NRT→ICN' },
    { month: '2026-10', day: 27, type: '국내선', title: '7C105', routeSummary: 'GMP→CJU→TAE→TAE' },
    { month: '2026-10', day: 28, type: '국내선', title: '7C107', routeSummary: 'TAE→CJU→GMP→CJU→GMP' },
  ];
  const r = rosterSync.comparePostWithRoster(kayPost, roster, '2026-10');
  assert.equal(r.status, 'changed');
  assert.deepEqual(r.changes.map(c => c.day), [26]);
});

test('그 날이 근무표에서 통째로 사라져도 잡는다', () => {
  const roster = newRoster.filter(s => s.day !== 27);
  const r = rosterSync.comparePostWithRoster(kayPost, roster, '2026-10');
  assert.equal(r.changes.find(c => c.day === 27).after, '없어짐');
});

/* 아래는 '틀리게 내리지 않는' 쪽의 보증이다. 멀쩡한 글을 내리는 건
   안 내리는 것보다 나쁘다 — 사용자가 왜 사라졌는지 알 수 없다. */

test('그 달을 안 불러왔으면 판정하지 않는다', () => {
  const novemberOnly = [{ month: '2026-11', day: 3, type: 'OFF', title: 'OFF' }];
  const r = rosterSync.comparePostWithRoster(kayPost, novemberOnly, '2026-11');
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'month-not-loaded');
});

test('근무표가 비어 있으면 판정하지 않는다', () => {
  assert.equal(rosterSync.comparePostWithRoster(kayPost, [], '2026-10').status, 'unknown');
});

test('일자 정보가 없는 구버전 글은 판정하지 않는다', () => {
  const legacy = { id: 'old', status: 'active', offered: { patternName: '구버전', summary: 'ICN-KIX' } };
  const r = rosterSync.comparePostWithRoster(legacy, newRoster, '2026-10');
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason, 'no-day-schedules');
});

test('여러 달에 걸친 글은 불러온 달만 대조한다', () => {
  const crossMonth = {
    id: 'P2', status: 'active',
    offered: { daySchedules: [
      { month: '2026-10', day: 31, type: '국제선', title: '7C1301', routeSummary: 'ICN→KIX' },
      { month: '2026-11', day: 1, type: '국제선', title: '7C1302', routeSummary: 'KIX→ICN' },
    ] },
  };
  const octoberOnly = [{ month: '2026-10', day: 31, type: 'OFF', title: 'OFF' }];
  const r = rosterSync.comparePostWithRoster(crossMonth, octoberOnly, '2026-10');
  assert.equal(r.status, 'changed');
  assert.deepEqual(r.changes.map(c => c.day), [31]);   // 11/1 은 근거가 없어 건드리지 않는다
});

test('findStalePosts 는 바뀐 글만, 이미 닫힌 글은 빼고 돌려준다', () => {
  const unchanged = { id: 'P3', status: 'active', offered: { daySchedules: [
    { month: '2026-10', day: 26, type: 'STBY', title: 'SB2' }] } };
  const closed = { ...kayPost, id: 'P4', status: 'cancelled' };
  const refunded = { ...kayPost, id: 'P5', refunded: true };
  const stale = rosterSync.findStalePosts([kayPost, unchanged, closed, refunded], newRoster, '2026-10');
  assert.deepEqual(stale.map(s => s.post.id), ['P1']);
  assert.equal(stale[0].changes.length, 3);
});

test('유형과 제목이 겹치면 한 번만 적는다', () => {
  // 'STBY' + 'STBY SB2' 가 'STBY STBY SB2' 로 찍히던 것 (Kay 확인, 2026-09-30)
  assert.equal(rosterSync.describe({ type: 'STBY', title: 'STBY SB2' }), 'STBY SB2');
  assert.equal(rosterSync.describe({ type: 'RSV', title: 'RSV' }), 'RSV');
  assert.equal(rosterSync.describe({ type: '국제선', title: '7C1301B', routeSummary: 'ICN→KIX→ICN' }),
    '국제선 7C1301B · ICN→KIX→ICN');
});
