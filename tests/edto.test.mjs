// EDTO — 제주항공이 가는 EDTO 노선은 괌과 사이판 둘뿐이다(Kay, 2026-09-23).
//
// 목록이 app.js 와 worker 에 따로 있어서 한쪽만 고치면 어긋났다. 등급표가 두 곳에 있어
// 서로 반대로 적혀 있던 것과 같은 문제라 한 곳으로 모았다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const A = require('../airport-aliases.js');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

test('EDTO 노선은 괌과 사이판뿐이다', () => {
  assert.deepEqual([...A.EDTO_AIRPORTS], ['GUM', 'SPN']);
  assert.equal(A.isEdtoAirport('GUM'), true);
  assert.equal(A.isEdtoAirport('SPN'), true);
  assert.equal(A.isEdtoAirport('CXR'), false);   // 깜라인
  assert.equal(A.isEdtoAirport('BKI'), false);   // 코타키나발루
  assert.equal(A.isEdtoAirport('DPS'), false);   // 발리
});

test('소문자·공백이 섞여도 읽는다', () => {
  assert.equal(A.isEdtoAirport(' gum '), true);
  assert.equal(A.isEdtoAirport(''), false);
  assert.equal(A.isEdtoAirport(null), false);
});

test('구간 중 하나라도 EDTO 공항이면 자격이 필요하다', () => {
  assert.equal(A.requiresEdto('ICN', 'GUM'), true);   // 가는 편
  assert.equal(A.requiresEdto('GUM', 'ICN'), true);   // 오는 편
  assert.equal(A.requiresEdto('ICN', 'CXR'), false);
  assert.equal(A.requiresEdto(['ICN', 'CJU', 'SPN']), true);  // 여러 구간
});

test('목록은 한 곳에만 둔다', () => {
  // 사본이 생기면 한쪽만 고쳐져 어긋난다 — 등급표에서 그 일이 있었다.
  assert.doesNotMatch(app, /arr === "GUM" \|\| arr === "SPN"/);
  assert.doesNotMatch(worker, /new Set\(\['GUM','SPN'\]\)/);
  assert.match(app, /CrewSwapAirportAliases\.requiresEdto\(dep, arr\)/);
  assert.match(worker, /airportAliases\.requiresEdto\(/);
});

test('데모 데이터가 규정과 어긋나지 않는다', () => {
  // 발리·깜라인에 EDTO 가 붙어 있었다. 심사자와 Kay가 보는 화면이라 규정과 맞아야 한다.
  const mock = app.slice(app.indexOf('function createMockSchedules'), app.indexOf('function assignPatternIds'));
  for (const line of mock.split('\n').filter(l => l.includes('requiresEdto:true'))) {
    assert.match(line, /"(GUM|SPN)"/, `EDTO 가 아닌 노선에 표시가 붙어 있다: ${line.slice(0, 80)}`);
  }
});
