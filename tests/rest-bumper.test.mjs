// 휴식은 체크아웃 시각부터 바로 세지 않는다.
//
// 편조가 스왑을 볼 때 체크아웃에 1시간 40분을 더한 시각부터 휴식을 센다(Kay가 편조에 확인).
// 1시간은 집까지 이동, 40분은 지연 여유다. 체크아웃 자체는 CrewConnex 가 계산해서 준다 —
// 인천은 램프인 +1시간, 김포는 램프인 +20분.
//
// 이 범퍼가 없으면 앱이 편조보다 느슨해진다. 앱은 통과시켰는데 회사에서 반려되는 쪽이
// 가장 나쁘다 — 사용자는 앱을 믿고 상대와 약속까지 끝낸 뒤에 되돌려야 한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('범퍼는 1시간 40분이고 정의는 한 곳에만 있다', () => {
  // app.js 와 rest-window.js 에 사본을 두면 어긋난다 — 등급표·EDTO 에서 겪은 문제다.
  const restWindow = readFileSync(new URL('../rest-window.js', import.meta.url), 'utf8');
  assert.match(restWindow, /const REST_START_BUMPER_MIN = 100;/);
  assert.match(app, /REST_START_BUMPER_MIN = window\.CrewSwapRestWindow\.REST_START_BUMPER_MIN/);
});

test('직전·직후 휴식 모두에 범퍼를 적용한다', () => {
  // 한쪽만 넣으면 방향에 따라 판정이 달라진다.
  const uses = app.match(/REST_START_BUMPER_MIN/g) || [];
  assert.ok(uses.length >= 3, `정의 1 + 사용 2 이상이어야 한다 (현재 ${uses.length})`);
  assert.match(app, /newCI - \(absMinAt\(prev\.day, prev\.releaseTime\) \+ REST_START_BUMPER_MIN\)/);
  assert.match(app, /nextCI - \(absMinAt\(lastDay, offered\.releaseTime\) \+ REST_START_BUMPER_MIN\)/);
});

test('부족하다고 알릴 때 무엇을 기준으로 셌는지 밝힌다', () => {
  // 안 밝히면 사용자가 자기 계산과 달라 앱이 틀렸다고 여긴다.
  assert.match(app, /휴식은 체크아웃 .* 뒤부터 셉니다/);
});

test('예시 계산 — 램프인 13:35 국제선이면 휴식은 16:15 부터', () => {
  // 체크아웃 14:35(램프인 +1시간, 인천) + 1시간 40분 = 16:15
  const checkoutMin = 14 * 60 + 35;
  const restStart = checkoutMin + 100;
  assert.equal(restStart, 16 * 60 + 15);
});
