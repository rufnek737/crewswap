// 특수공항 — FOM Supplement 「특수공항 현황」.
//
// 예전에는 `["CXR","TAG","BKI"]` 가 들어 있었다. 셋 다 특수공항이 아니다 — 목록 전체가
// 근거 없이 지어진 값이었고, 계산만 하고 쓰이지도 않았다.
//
// 목적지로 스왑을 막지 않는다. Kay 확인: "홍콩이 특수공항이기는 하지만 홍콩비행이 다
// 특수공항 유지비행이라고 할수 없어." 자격 유지 비행은 그 편조에만 해당한다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const A = require('../airport-aliases.js');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('국내 특수공항 다섯 곳', () => {
  for (const [code, name] of [['PUS','김해'], ['KPO','포항'], ['WJU','원주'], ['CJU','제주'], ['YNY','양양']]) {
    assert.equal(A.specialAirportName(code), name);
  }
});

test('국외 특수공항', () => {
  for (const [code, name] of [['FUK','후쿠오카'], ['HKG','홍콩'], ['MFM','마카오'],
                              ['CEB','세부'], ['HND','하네다'], ['DLI','달랏'], ['YNJ','옌지']]) {
    assert.equal(A.specialAirportName(code), name);
  }
});

test('지어냈던 값들은 특수공항이 아니다', () => {
  for (const code of ['CXR', 'TAG', 'BKI']) {
    assert.equal(A.specialAirportName(code), null, `${code} 는 특수공항이 아니다`);
  }
});

test('구간에서 특수공항만 골라낸다', () => {
  assert.deepEqual(A.specialAirportsIn('ICN', 'HKG'), ['홍콩']);
  assert.deepEqual(A.specialAirportsIn('ICN', 'CXR'), []);
  assert.deepEqual(A.specialAirportsIn('GMP', 'CJU'), ['제주']);
});

test('목적지로 스왑을 막지 않는다', () => {
  // 홍콩 비행이라고 다 자격유지 비행은 아니다. 지어낸 판정으로 막으면 멀쩡한 스왑이 막힌다.
  assert.doesNotMatch(app, /arr === "TAG"/);
  assert.doesNotMatch(app, /const SPECIAL_AIRPORTS = \["CXR"/);
  // 대신 목록을 알려주고 확인을 맡긴다.
  assert.match(app, /status: "WARN", detail: `\$\{names\.join\(", "\)\} — 자격 확인 필요`/);
});

test('자격 갱신 지정 비행은 그대로 막는다', () => {
  // 그 승무원이 직접 가야 하는 비행이다. 다만 근무표 표기를 아직 못 봐서 판정 경로가 없다.
  assert.match(app, /label: "특수공항 자격 갱신 비행", status: "FAIL"/);
});
