// 연속 7일마다 30시간 연속 휴식 (FOM 5.5.3 가. 주2)
//
// 이 검사가 대체한 "연속 근무일 5일 미만"은 근거가 없었다 — 항공안전법 시행규칙
// 별표18·JPU 단체협약·FOM 어디에도 그런 조항이 없다. 규정은 일수가 아니라 휴식이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../rest-window.js');

const duty = (day, ci, co) => ({ month: '2026-10', day, reportTime: ci, releaseTime: co });

test('매일 근무해도 30시간 휴식이 있으면 통과한다', () => {
  // 1~4일 근무 → 5·6일 쉼(48시간) → 7·8일 근무
  const entries = [duty(1,'09:00','17:00'), duty(2,'09:00','17:00'), duty(3,'09:00','17:00'),
                   duty(4,'09:00','17:00'), duty(7,'09:00','17:00'), duty(8,'09:00','17:00')];
  const r = R.check(entries);
  assert.equal(r.status, 'PASS');
  assert.ok(r.worstRestMin >= 30 * 60, `가장 긴 휴식 ${r.worstRestMin}분`);
});

test('근무일이 적어도 30시간 휴식이 없으면 불가다', () => {
  // 8일 내내 매일 09:00~17:00 — 하루 쉬는 날이 없어 최장 휴식이 16시간뿐
  const entries = Array.from({ length: 9 }, (_, i) => duty(i + 1, '09:00', '17:00'));
  const r = R.check(entries);
  assert.equal(r.status, 'FAIL');
  assert.equal(r.worstRestMin, 16 * 60);
  assert.match(R.detailText(r), /16시간/);
});

test('창 밖의 휴식으로 창 안의 요건을 채울 수 없다', () => {
  // 1일에 길게 쉬고 그 뒤 9일 연속 근무 — 뒤쪽 7일 창에는 30시간 휴식이 없다
  const entries = [duty(1,'09:00','17:00'), ...Array.from({ length: 9 }, (_, i) => duty(i + 3, '09:00','17:00'))];
  const r = R.check(entries);
  assert.equal(r.status, 'FAIL');
});

test('근무표가 7일에 못 미치면 통과라고 하지 않는다', () => {
  const r = R.check([duty(1,'09:00','17:00'), duty(2,'09:00','17:00')]);
  assert.equal(r.status, 'UNKNOWN');
  assert.match(R.detailText(r), /확인 불가/);
});

test('근무가 없거나 하나뿐이면 해당 없음', () => {
  assert.equal(R.check([]).status, 'PASS');
  assert.equal(R.check([duty(1,'09:00','17:00')]).reason, 'no-duty');
});

test('자정을 넘기는 근무를 이어서 센다', () => {
  // 22:00~06:00(+1) 은 8시간 근무다 — 16시간으로 잘못 읽으면 휴식이 부풀려진다
  const iv = R.dutyIntervals([{ month:'2026-10', day:1, reportTime:'22:00', releaseTime:'06:00' }]);
  assert.equal(iv[0].end - iv[0].start, 8 * 60);
});

test('시각 없는 날(OFF·RSV)은 근무로 세지 않는다', () => {
  // 예전 방식은 RSV를 연속 근무로 셌다. 규정이 보는 것은 휴식이지 대기 여부가 아니다.
  const entries = [duty(1,'09:00','17:00'), { month:'2026-10', day:2, type:'RSV' },
                   { month:'2026-10', day:3, type:'OFF' }, duty(4,'09:00','17:00'),
                   duty(5,'09:00','17:00'), duty(6,'09:00','17:00'), duty(7,'09:00','17:00'),
                   duty(8,'09:00','17:00'), duty(9,'09:00','17:00')];
  const r = R.check(entries);
  assert.equal(r.status, 'PASS', 'RSV·OFF 이틀이 이어져 59시간 휴식이 생긴다');
});
