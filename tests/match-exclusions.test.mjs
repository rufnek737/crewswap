import test from 'node:test';
import assert from 'node:assert/strict';
import exclusions from '../match-exclusions.js';

const pilot = { airline:'JEJU', crewType:'PILOT', roleType:'FO_C', aircraft:'NG', edto:false, cat3:false };
const proPilot = { ...pilot, aircraft:'NG_MAX', edto:true, cat3:true };
const cabin = { airline:'JEJU', crewType:'CABIN', roleType:'CC' };

const post = (over = {}) => ({
  airline:'JEJU', crewType:'PILOT', ownerRole:'FO_B',
  offered:{ type:'국내선', aircraft:'NG', edto:false, cat3:false },
  ...over,
});

test('조건이 맞으면 제외 사유가 없다', () => {
  assert.equal(exclusions.reasonFor(post(), pilot, { expired:false }), null);
});

test('회사·직군·직책이 다르면 그 사유를 돌려준다', () => {
  assert.equal(exclusions.reasonFor(post({ airline:'TWAY' }), pilot, {}), 'airline');
  assert.equal(exclusions.reasonFor(post({ crewType:'CABIN' }), pilot, {}), 'crewType');
  assert.equal(exclusions.reasonFor(post({ ownerRole:'CAPTAIN_B' }), pilot, {}), 'position');
});

test('기종·특수자격이 모자라면 그 사유를 돌려준다', () => {
  assert.equal(exclusions.reasonFor(post({ offered:{ type:'국내선', aircraft:'MAX' } }), pilot, {}), 'aircraft');
  assert.equal(exclusions.reasonFor(post({ offered:{ type:'국제선', edto:true } }), pilot, {}), 'edto');
  assert.equal(exclusions.reasonFor(post({ offered:{ type:'국제선', cat3:true } }), pilot, {}), 'cat3');
  // NG+MAX·EDTO·CAT III 보유자는 같은 글을 받을 수 있다.
  assert.equal(exclusions.reasonFor(post({ offered:{ type:'국제선', aircraft:'MAX', edto:true, cat3:true } }), proPilot, {}), null);
});

test('회사 제출 마감이 지난 글은 마감 사유로 제외된다', () => {
  assert.equal(exclusions.reasonFor(post(), pilot, { expired:true }), 'deadline');
  assert.equal(exclusions.reasonFor(post({ crewType:'CABIN' }), cabin, { expired:true }), 'deadline');
});

test('객실은 직책·기종·특수자격을 보지 않는다', () => {
  const cabinPost = post({ crewType:'CABIN', ownerRole:'CP', offered:{ type:'국제선', aircraft:'MAX', edto:true, cat3:true } });
  assert.equal(exclusions.reasonFor(cabinPost, cabin, { expired:false }), null);
});

test('기종 정보가 없는 글은 기종으로 거르지 않는다', () => {
  assert.equal(exclusions.reasonFor(post({ offered:{ type:'OFF' } }), pilot, {}), null);
});

test('사유별 건수를 많은 순으로 요약한다', () => {
  const summary = exclusions.summarize(['deadline','position','deadline',null,'deadline','position']);
  assert.deepEqual(summary.map(r => [r.reason, r.count]), [['deadline',3],['position',2]]);
  assert.equal(summary[0].label, exclusions.LABELS.deadline);
});

test('모두 통과하면 요약이 비어 있다', () => {
  assert.deepEqual(exclusions.summarize([null, null]), []);
});
