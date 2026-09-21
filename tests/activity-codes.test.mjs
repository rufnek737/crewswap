// 근무표 하단 Activity Code Descriptions 표로 근무 유형을 가린다.
//
// 표본은 Kay의 실제 객실 근무표 7장(24-10, 25-02, 25-08, 25-10, 26-03, 26-06, 26-09)에서 왔다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../activity-codes.js');

const ROSTER_2609 = `
30Sep
OFF

Activity Code Descriptions
Code      Description
HSC       Home Standby(Cabin)
LAYOV     Layover
OFF       DAY OFF
RSV       Reserve (Cabin)
VAC       Regular Vacation
`;

test('근무표 하단 코드표를 읽는다', () => {
  const d = A.parseDescriptions(ROSTER_2609);
  assert.equal(d.get('HSC'), 'Home Standby(Cabin)');
  assert.equal(d.get('RSV'), 'Reserve (Cabin)');
  assert.equal(d.size, 5, '헤더 줄(Code/Description)은 코드가 아니다');
});

test('코드표가 없으면 빈 사전이다', () => {
  assert.equal(A.parseDescriptions('30Sep\nOFF').size, 0);
});

test('객실 대기 코드를 자택·공항으로 나눈다', () => {
  // 둘 다 Standby 지만 규정상 다른 근무다 — Home 을 먼저 걸러야 한다.
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
HSC       Home Standby(Cabin)
SDC1      야간 공항대기근무(Cabin Crew) 24/03/07부
SBC4      오전 공항대기근무(Cabin Crew)
`);
  assert.equal(A.classify('HSC', d).standby, '자택');
  assert.equal(A.classify('SDC1', d).standby, '공항');
  assert.equal(A.classify('SBC4', d).standby, '공항');
});

test('한글 설명도 읽는다 — 훈련', () => {
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
TR_OPR    TR_OPR(Operational Training)_객실승무원 26.06부 사용
`);
  const hit = A.classify('TR_OPR', d);
  assert.equal(hit.type, 'GND');
  assert.equal(hit.ground, '훈련');
  assert.equal(hit.source, 'roster');
});

test('DH 는 비행이 아니다', () => {
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
TAXI      DH by Taxi
AIR       DH by Air
`);
  assert.equal(A.classify('TAXI', d).ground, 'DH');
  assert.equal(A.classify('AIR', d).ground, 'DH');
});

test('사무 근무를 지상근무로 본다', () => {
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
OFC       Office Duty
`);
  assert.equal(A.classify('OFC', d).ground, '지상');
});

test('코드표에 없는 코드는 접두사로 넘겨짚되 추측이라고 말한다', () => {
  // 26년 6월 근무표에는 2일에 SAC16 이 찍혀 있는데 그 달 코드표에는 SAC16 이 없었다.
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
LAYOV     Layover
OFF       DAY OFF
`);
  const hit = A.classify('SAC16', d);
  assert.equal(hit.type, 'STBY');
  assert.equal(hit.standby, '공항');
  assert.equal(hit.source, 'guess');
  assert.equal(A.classify('OFF', d).source, 'roster', '표에 있으면 추측이 아니다');
});

test('운항 코드도 그대로 걸린다', () => {
  // 운항승무원 근무표의 코드들 — 예전에 하나씩 놓쳤던 것들이다.
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
RSV_F     운항승무원RSV코드(25.07.01부 시행)
SIM1      Simulator
S_L+U     LOFT+UPRT
SA1       Early standby (FLT)
TR_GRD    Ground Training
JCRM      Joint CRM
SCHLD     Schedule Hold 비행불가 인원에 대한 임시 스케줄
`);
  assert.equal(A.classify('RSV_F', d).type, 'RSV');
  assert.equal(A.classify('SIM1', d).ground, 'SIM');
  assert.equal(A.classify('S_L+U', d).ground, 'SIM');
  assert.equal(A.classify('SA1', d).type, 'STBY');
  assert.equal(A.classify('TR_GRD', d).ground, '훈련');
  assert.equal(A.classify('JCRM', d).ground, '훈련');
  assert.equal(A.classify('SCHLD', d).type, 'VAC');
});

test('객실 생활 백과사전의 대기 코드를 모두 잡는다', () => {
  // 2-2. 스케줄 코드 — 공항 근무: 서울 SAC·SBS·SCC·SDC / 부산 SA(P)·SB(P)
  //                   자택 대기: 오전 RF(A)·오후 RF(b), 결항 시 RF_CNL
  const empty = new Map();
  for (const code of ['SAC', 'SBS', 'SCC', 'SDC', 'SAC16', 'SBC4', 'SDC1', 'SA(P)', 'SB(P)']) {
    const hit = A.classify(code, empty);
    assert.equal(hit?.standby, '공항', `${code} 는 공항 대기다`);
  }
  for (const code of ['RF(A)', 'RF(b)', 'RF_CNL', 'HSC', 'HSC1']) {
    const hit = A.classify(code, empty);
    assert.equal(hit?.standby, '자택', `${code} 는 자택 대기다`);
  }
});

test('추가 연차 코드도 휴가다', () => {
  // VAC_A 전일 배정 추가 연차 / VAC_P 단기 추가 연차
  assert.equal(A.classify('VAC_A', new Map()).type, 'VAC');
  assert.equal(A.classify('VAC_P', new Map()).type, 'VAC');
});

test('모르는 코드는 null — 기존 판정으로 넘어간다', () => {
  assert.equal(A.classify('ZZQ9', new Map()), null);
  assert.equal(A.classify('', new Map()), null);
});

test('편명 숫자를 코드로 착각하지 않는다', () => {
  const d = A.parseDescriptions(`Activity Code Descriptions
Code      Description
LAYOV     Layover
`);
  const hit = A.classifyTokens(['2125', '1850', 'LAYOV'], d);
  assert.equal(hit.type, 'LAYOV');
});
