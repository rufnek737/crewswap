// 규정에 걸려도 등록을 막지 않는다.
//
// Kay 지시(2026-09-23): "이 근무로 스왑 올리기 버튼은 닫지 말아줘. 규정에 걸린다 하더라도.
// 단 나랑 상대방이 회사 상신중일 때 닫는 기능은 그대로 두고."
//
// 앱의 판정은 사전 검토일 뿐이고 최종 판단은 회사가 한다. 오늘 하루만 해도 근거 없는
// 규정으로 멀쩡한 스왑을 막고 있던 것이 여럿 나왔다 — 앱이 잘못 걸러 못 올리게 하는 쪽이
// 회사에서 반려되는 쪽보다 나쁘다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('규정 위반으로 선택 버튼을 잠그지 않는다', () => {
  assert.match(app, /regBtn\.disabled = !has \|\| hasPast;/);
  assert.doesNotMatch(app, /regBtn\.disabled = !has \|\| hasFail/);
});

test('규정 위반으로 등록 버튼을 잠그지 않는다', () => {
  assert.match(app, /submitBtn\.disabled = !hasOffered \|\| !CREDIT_POLICY\.canSpend/);
  assert.doesNotMatch(app, /const canSubmit = hasOffered && !hasFail/);
});

test('지난 근무는 그대로 막는다', () => {
  // 규정이 아니라 사실의 문제다 — 이미 지나간 날은 교환할 수 없다.
  assert.match(app, /이미 지난 근무는 교환할 수 없습니다/);
});

test('회사 상신 중인 글은 그대로 막는다', () => {
  // 이미 성사된 스왑이라 막는 것이고, 규정 판정과는 다른 이유다.
  assert.match(app, /회사 상신 중<\/strong>입니다 — 요청할 수 없습니다/);
});

test('머리말이 등록 차단이라고 말하지 않는다', () => {
  assert.doesNotMatch(app, /등록 차단됨/);
  assert.match(app, /회사에서 반려될 수 있습니다/);
});

test('사전 검토용이라는 문장이 눈에 띈다', () => {
  // 이 화면에서 가장 중요한 문장인데 회색 11px 로 깔려 있어 아무도 읽지 않았다.
  assert.match(app, /<strong>본 결과는 회사 최종 승인 전 사전 검토용입니다\.<\/strong>/);
  const rule = styles.match(/\.rule-check \.disclaimer \{[^}]*\}/)[0];
  assert.match(rule, /font-size: 13px/);
  assert.match(rule, /background/);
});
