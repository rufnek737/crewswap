// 연속 7일마다 30시간 연속 휴식 (FOM 비행근무시간 제한
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
  // 17:00 해제 + 범퍼 1시간 40분 → 휴식은 18:40 부터 다음날 09:00 까지 14시간 20분.
  assert.equal(r.worstRestMin, 16 * 60 - R.REST_START_BUMPER_MIN);
  assert.match(R.detailText(r), /14시간/);
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
  // 8시간 근무 + 범퍼 — 근무가 끝나도 범퍼만큼은 휴식으로 치지 않는다.
  assert.equal(iv[0].end - iv[0].start, 8 * 60 + R.REST_START_BUMPER_MIN);
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

/* 이 규정은 「7일 연속 비행하면 30시간 쉰다」가 아니다.
 *
 * Kay 확인: "7일 이내 비행이 연속으로 있으면 30시간의 휴식이 7일 이내에 있어야 한다."
 * 즉 어느 168시간을 잘라 봐도 그 안에 30시간 연속 휴식이 있어야 한다. 6일 비행 뒤
 * 7일째 아침에 들어와 30시간이 채워질 수도 있다.
 *
 * 뒤집으면 30시간 휴식 사이의 근무 구간이 138시간(168-30)을 넘을 수 없다는 뜻이다.
 */
test('휴식 사이 간격이 138시간을 넘으면 불가다', () => {
  const at = (day, ci, co) => ({ month: '2026-10', day, reportTime: ci, releaseTime: co });
  // 1일 09:00 시작. 이후 매일 근무해 휴식이 하루치도 나오지 않는 상태로 9일을 채운다.
  const entries = Array.from({ length: 9 }, (_, i) => at(i + 1, '09:00', '20:00'));
  assert.equal(R.check(entries).status, 'FAIL');
});

test('138시간 안에 30시간이 들어오면 통과한다', () => {
  const at = (day, ci, co) => ({ month: '2026-10', day, reportTime: ci, releaseTime: co });
  // 1~5일 근무 → 6일 저녁부터 8일 아침까지 비움 → 30시간 이상 연속 휴식이 생긴다.
  const entries = [at(1,'09:00','17:00'), at(2,'09:00','17:00'), at(3,'09:00','17:00'),
                   at(4,'09:00','17:00'), at(5,'09:00','17:00'),
                   at(8,'09:00','17:00'), at(9,'09:00','17:00')];
  const r = R.check(entries);
  assert.equal(r.status, 'PASS');
  assert.ok(r.worstRestMin >= 30 * 60);
});
