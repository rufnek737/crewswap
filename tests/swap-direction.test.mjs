import test from 'node:test';
import assert from 'node:assert/strict';
import direction from '../swap-direction.js';

// 실제 앱이 등록하는 글의 모양 — wanted에는 자유 메모만 담긴다.
function newPost(offered, memo = '') {
  return { offered, wanted: { memo } };
}
// 구버전(칩으로 조건을 고르던 시절) 글
function legacyPost(offered, wanted) {
  return { offered, wanted };
}

test('wanted.types가 없는 새 글에도 예외 없이 판정한다', () => {
  const post = newPost({ type: '국내선', reportTime: '08:30' });
  for (const dir of ['all','AM_TO_PM','PM_TO_AM','FLY_TO_OFF','OFF_TO_FLY','RSV_TO_OFF','OFF_TO_RSV','LAY_TO_DOM','INTL_TO_DOM']) {
    assert.equal(typeof direction.matches(post, dir), 'boolean', dir);
  }
});

test('희망 조건을 알 수 없으면 내놓는 근무만 보고 통과시킨다', () => {
  // 조건을 알 수 없다는 이유로 글을 감추면 목록이 통째로 비어 보인다.
  assert.equal(direction.matches(newPost({ type: '국내선' }), 'FLY_TO_OFF'), true);
  assert.equal(direction.matches(newPost({ type: 'OFF' }), 'OFF_TO_FLY'), true);
  assert.equal(direction.matches(newPost({ type: 'LAYOV' }), 'LAY_TO_DOM'), true);
});

test('내놓는 근무가 방향과 다르면 제외한다', () => {
  assert.equal(direction.matches(newPost({ type: 'OFF' }), 'FLY_TO_OFF'), false);
  assert.equal(direction.matches(newPost({ type: '국내선' }), 'OFF_TO_FLY'), false);
  assert.equal(direction.matches(newPost({ type: '국내선' }), 'INTL_TO_DOM'), false);
});

test('메모에 적힌 희망 조건을 읽어 방향을 가린다', () => {
  const wantsOff = newPost({ type: '국제선' }, 'OFF 주시면 감사합니다');
  assert.equal(direction.matches(wantsOff, 'FLY_TO_OFF'), true);
  const wantsDomestic = newPost({ type: '국제선' }, '국내선으로 바꾸고 싶어요');
  assert.equal(direction.matches(wantsDomestic, 'INTL_TO_DOM'), true);
  assert.equal(direction.matches(wantsDomestic, 'FLY_TO_OFF'), false);
});

test('출근 시간대 방향은 내놓는 근무의 Show-up으로 판정한다', () => {
  const morning = newPost({ type: '국내선', reportTime: '07:20' }, '오후 비행 원해요');
  assert.equal(direction.matches(morning, 'AM_TO_PM'), true);
  assert.equal(direction.matches(morning, 'PM_TO_AM'), false);
  const afternoon = newPost({ type: '국내선', reportTime: '15:30' }, '오전 비행 원해요');
  assert.equal(direction.matches(afternoon, 'PM_TO_AM'), true);
  // OFF처럼 Show-up이 없는 글은 시간대 방향에 걸리지 않는다.
  assert.equal(direction.matches(newPost({ type: 'OFF' }), 'AM_TO_PM'), false);
});

test('구버전 글의 구조화된 희망 조건을 그대로 존중한다', () => {
  const post = legacyPost({ type: '국내선' }, { types: ['OFF'], time: ['AM'] });
  assert.equal(direction.matches(post, 'FLY_TO_OFF'), true);
  assert.equal(direction.matches(post, 'OFF_TO_FLY'), false);
  const anyType = legacyPost({ type: 'RSV' }, { types: ['아무거나'] });
  assert.equal(direction.matches(anyType, 'RSV_TO_OFF'), true);
});

test("'비행(전체)' 희망은 개별 비행 유형을 모두 받아들인다", () => {
  const post = legacyPost({ type: 'OFF' }, { types: ['비행(전체)'] });
  assert.equal(direction.matches(post, 'OFF_TO_FLY'), true);
  assert.equal(direction.matches(post, 'OFF_TO_RSV'), false);
});

test('등록 화면 후보 수 계산도 같은 해석을 쓴다', () => {
  assert.equal(direction.wantsOfferedType(newPost({ type: 'OFF' }, 'OFF 주세요'), 'OFF'), true);
  assert.equal(direction.wantsOfferedType(newPost({ type: 'OFF' }, 'OFF 주세요'), '국내선'), false);
  // 조건을 알 수 없는 글은 후보에서 빼지 않는다.
  assert.equal(direction.wantsOfferedType(newPost({ type: 'OFF' }), '국내선'), true);
});

test("방향 필터를 쓰지 않으면(all) 모든 글이 통과한다", () => {
  assert.equal(direction.matches(newPost({ type: 'STBY' }), 'all'), true);
});
