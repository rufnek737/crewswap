// 복귀편 출두가 전날 밤이면 CrewConnex 는 그 시각을 LAYOV 칸에 적는다 — 복귀 근무가 휴식으로 새지 않아야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import cont from '../schedule-continuity.js';
import rw from '../rest-window.js';

const roster = () => [
  { month: '2026-12', day: 27, type: '국제선', dep: 'ICN', arr: 'CNX', reportTime: '17:05', releaseTime: '23:55' },
  { month: '2026-12', day: 28, type: 'LAYOV', reportTime: '23:35' },
  { month: '2026-12', day: 29, type: '국제선', dep: 'CNX', arr: 'ICN', reportTime: null, releaseTime: '08:25' },
];

test('복귀편에 전날 LAYOV 의 출두 시각을 옮겨 적는다', () => {
  const r = roster();
  cont.normalizeScheduleContinuity(r);
  assert.equal(r[2].reportPrevDay, '23:35');
  assert.equal(r[0].reportPrevDay, undefined);
});

test('복귀 근무 구간이 12/28 23:35 ~ 12/29 08:25 로 잡힌다', () => {
  const r = roster();
  cont.normalizeScheduleContinuity(r);
  const iv = rw.dutyIntervals(r);
  assert.equal(iv.length, 2);
  const ret = iv[1];
  assert.equal(ret.end - rw.REST_START_BUMPER_MIN - ret.start, 8 * 60 + 50);
});
