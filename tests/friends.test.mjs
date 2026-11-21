// 친구 스케줄 — 사번·실명 정확 검색, 요청→수락, 친구만 근무표 열람, 편조 이름은 보내지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFriendsList, handleFriendsSearch, handleFriendsRequest, handleFriendsRespond,
  handleFriendsRemove, handleFriendsSchedule, removeAllFriends } from '../worker/friends.mjs';

function createKv(seed = {}) {
  const values = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key, o) { const v = values.get(key); return v == null ? null : o?.type === 'json' ? JSON.parse(v) : v; },
    async put(key, v) { values.set(key, String(v)); },
    async delete(key) { values.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...values.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const A = 'a@jejuair.net', B = 'b@jejuair.net';
const env = () => ({ POSTS: createKv({
  [`user:${A}`]: { profile: { realName: '김가나', employeeId: '1001', nickname: '가나' } },
  [`user:${B}`]: { profile: { realName: '박다라', employeeId: '2002', nickname: '다라', base: 'ICN' } },
  [`schedule:${B}`]: { schedules: [{ month: '2026-12', day: 20, type: '국제선', title: 'CEB-ICN', dep: 'CEB', arr: 'ICN',
    reportTime: '00:20', crewComposition: '김모세(FO), 임지영(PUR)', mySeat: 'CAPTAIN' }] },
}) });

test('사번·실명이 정확히 같을 때만 찾고, 이메일은 내보내지 않는다', async () => {
  const e = env();
  assert.equal((await handleFriendsSearch(e, A, '2002')).results[0].name, '박다라');
  assert.equal((await handleFriendsSearch(e, A, '박다라')).results.length, 1);
  assert.equal((await handleFriendsSearch(e, A, '박다')).results.length, 0);
  assert.equal((await handleFriendsSearch(e, A, '1001')).results.length, 0);   // 나 자신
  assert.doesNotMatch(JSON.stringify(await handleFriendsSearch(e, A, '2002')), /@/);
});

test('수락 전에는 근무표를 볼 수 없고, 수락하면 편조 이름 없이 보인다', async () => {
  const e = env();
  const [b] = (await handleFriendsSearch(e, A, '2002')).results;
  const req = await handleFriendsRequest(e, A, b.id);
  assert.equal(req.body.status, 'outgoing');
  assert.equal(req.notify, B);
  assert.equal((await handleFriendsSchedule(e, A, b.id)).status, 403);

  const { myId: aId } = await handleFriendsList(e, A);
  const incoming = (await handleFriendsList(e, B)).friends;
  assert.deepEqual(incoming.map(f => [f.id, f.status]), [[aId, 'incoming']]);
  await handleFriendsRespond(e, B, aId, true);

  const seen = await handleFriendsSchedule(e, A, b.id);
  assert.equal(seen.body.schedules[0].title, 'CEB-ICN');
  assert.equal(seen.body.schedules[0].reportTime, '00:20');
  assert.doesNotMatch(JSON.stringify(seen.body), /김모세|임지영|crewComposition|mySeat/);
  assert.equal((await handleFriendsSchedule(e, B, aId)).status, undefined);   // 서로 본다
});

test('거절·끊기·탈퇴는 양쪽에서 함께 지운다', async () => {
  const e = env();
  const [b] = (await handleFriendsSearch(e, A, '2002')).results;
  const { myId: aId } = await handleFriendsList(e, A);
  await handleFriendsRequest(e, A, b.id);
  await handleFriendsRespond(e, B, aId, false);
  assert.equal((await handleFriendsList(e, A)).friends.length, 0);

  await handleFriendsRequest(e, A, b.id);
  await handleFriendsRequest(e, B, aId);                 // 서로 요청하면 바로 친구
  assert.equal((await handleFriendsList(e, A)).friends[0].status, 'friend');
  await handleFriendsRemove(e, B, aId);
  assert.equal((await handleFriendsList(e, A)).friends.length, 0);

  await handleFriendsRequest(e, A, b.id);
  await handleFriendsRespond(e, B, aId, true);
  await removeAllFriends(e, A);
  assert.equal((await handleFriendsList(e, B)).friends.length, 0);
});

test('친구 근무로 비공개 글을 만든다 — 친구가 아니거나 받기를 끄면 막는다', async () => {
  const { handleFriendsSwapStart, handleFriendsSettings } = await import('../worker/friends.mjs');
  const e = env();
  const [b] = (await handleFriendsSearch(e, A, '2002')).results;
  const days = [{ month: '2026-12', day: 20 }];
  const now = new Date('2026-11-21T00:00:00Z');
  assert.equal((await handleFriendsSwapStart(e, A, b.id, days, null, now)).status, 403);   // 아직 친구 아님

  const { myId: aId } = await handleFriendsList(e, A);
  await handleFriendsRequest(e, A, b.id);
  await handleFriendsRespond(e, B, aId, true);
  const r = await handleFriendsSwapStart(e, A, b.id, days, null, now);
  assert.equal(r.created.ownerEmail, B);
  assert.deepEqual(r.created.visibleTo, [A]);
  assert.equal(r.created.friendDirect, true);
  assert.equal(r.created.creditSpent, 0);
  assert.deepEqual(r.created.offered.dateKeys, ['2026-12-20']);
  assert.doesNotMatch(JSON.stringify(r.body), /@|김모세|ownerValidationRoster/);       // 요청자에게 가는 쪽엔 이메일·편조 없음
  assert.doesNotMatch(JSON.stringify(r.created.ownerValidationRoster), /김모세/);

  assert.equal((await handleFriendsSwapStart(e, A, b.id, [{ month: '2026-12', day: 21 }], null, now)).status, 400); // 근무표에 없는 날
  assert.equal((await handleFriendsSwapStart(e, A, b.id, days, null, new Date('2026-12-25T00:00:00Z'))).status, 400); // 지난 근무

  await handleFriendsSettings(e, B, false);
  assert.equal((await handleFriendsSwapStart(e, A, b.id, days, null, now)).status, 403);
  assert.equal((await handleFriendsList(e, A)).friends[0].acceptsDirect, false);
});
