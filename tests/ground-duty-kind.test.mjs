// 비행이 아닌 회사 지정 근무의 이름. MED(신체검사)를 「지상근무」로 보여주던 문제(2026-10-22).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const codes = require('../activity-codes.js');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const fn = name => { const i = app.indexOf(`function ${name}(`); let d = 0;
  for (let k = app.indexOf('{', i); k < app.length; k++) { if (app[k] === '{') d++; else if (app[k] === '}' && !--d) return app.slice(i, k + 1); } };
const ctx = { state: { currentMonth: '2026-11' } };
vm.createContext(ctx);
vm.runInContext(['groundDutyKind', 'relabelGroundDuty', 'schedMonthNum', 'specialAirportCheck'].map(fn).join('\n'), ctx);

test('MED 는 신체검사로 부른다', () => {
  assert.equal(ctx.groundDutyKind('MED').title, '신체검사');
  assert.equal(ctx.groundDutyKind('S_L+U').title, 'SIM 훈련');
  assert.equal(ctx.groundDutyKind('JCRM').title, '지상근무');
});

test('이미 저장된 「지상근무」 MED 를 다시 이름 붙인다', () => {
  const s = ctx.relabelGroundDuty({ type: 'GND', title: '지상근무', ground: '지상', activityCode: 'MED', lockReason: '지상근무 — 비행 아님, SWAP 불가' });
  assert.equal(s.title, '신체검사');
  assert.match(s.lockReason, /^신체검사/);
});

test('근무표 코드표의 MED(Physical Examination)도 신체검사로 판정한다', () => {
  const desc = codes.parseDescriptions('Activity Code Descriptions\nCode   Description\nMED    Physical Examination\n');
  assert.equal(codes.classify('MED', desc).title, '신체검사');
  assert.equal(codes.classify('MED', new Map()).title, '신체검사');   // 코드표에 없어도
});

test('교환 불가 근무는 실제 사유를 보여준다 — 특수공항으로 뭉뚱그리지 않는다', () => {
  const r = ctx.specialAirportCheck([{ month: '2026-11', day: 7, lockReason: '신체검사 — 비행 아님, SWAP 불가' }], true);
  assert.equal(r.status, 'FAIL');
  assert.equal(r.label, '교환할 수 없는 근무');
  assert.match(r.detail, /11\/7 신체검사/);
});
