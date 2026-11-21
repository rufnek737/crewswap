/* 친구 스케줄 — 서로 수락한 친구끼리 근무표를 나란히 본다 (2026-11-21 Kay).
 *
 * - 찾기: 사번 또는 실명이 정확히 같은 사람만 찾는다(부분 검색 없음 — 둘러보기 방지).
 * - 맺기: 요청 → 상대 수락. 수락 전에는 서로의 근무를 볼 수 없다. 언제든 끊을 수 있다.
 * - 보여주는 범위: 편명·구간·시간·근무 종류까지. 편조(함께 비행하는 동료 이름)는 빼고 보낸다.
 * - 이메일은 서버 밖으로 내보내지 않는다. 클라이언트는 친구를 임의 id 로만 안다.
 *
 * 저장: friends:<email> → { id, list: [{ email, status: 'friend'|'outgoing'|'incoming', at }] }
 */

export const FRIENDS_MAX = 50;
const KEY = email => `friends:${email}`;

// 근무표에서 친구에게 보여줄 칸만 남긴다. 편조·좌석·자격 정보는 보내지 않는다.
const SHARED_FIELDS = ['month', 'day', 'type', 'title', 'dep', 'arr', 'routeSummary', 'reportTime',
  'departureTime', 'arrivalTime', 'releaseTime', 'ground', 'station', 'standby', 'activityCode', 'aircraft'];
export function sharedDuty(s) {
  const out = {};
  for (const k of SHARED_FIELDS) if (s?.[k] !== undefined && s[k] !== null) out[k] = s[k];
  return out;
}

async function readRecord(env, email) {
  const rec = await env.POSTS.get(KEY(email), { type: 'json' });
  if (rec?.id) return { list: [], ...rec };
  const fresh = { id: crypto.randomUUID().replace(/-/g, '').slice(0, 16), list: [] };
  await env.POSTS.put(KEY(email), JSON.stringify(fresh));
  return fresh;
}
const save = (env, email, rec) => env.POSTS.put(KEY(email), JSON.stringify(rec));

// 전체 사용자/친구 레코드 훑기. 이용자가 수백 명 규모라 SQL 인덱스 없이 충분하다.
async function scan(env, table, prefix) {
  if (env.DB) {
    const { results } = await env.DB.prepare(`SELECT email, data FROM ${table}`).all();
    return results.map(r => { try { return { email: r.email, rec: JSON.parse(r.data) }; } catch { return null; } }).filter(Boolean);
  }
  const { keys } = await env.POSTS.list({ prefix });
  const rows = await Promise.all(keys.map(async k => ({ email: k.name.slice(prefix.length), rec: await env.POSTS.get(k.name, { type: 'json' }) })));
  return rows.filter(r => r.rec);
}

async function emailForId(env, id) {
  if (!id || typeof id !== 'string') return null;
  const rows = await scan(env, 'friends', 'friends:');
  return rows.find(r => r.rec?.id === id)?.email || null;
}

async function peerCard(env, email, status) {
  const user = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (!user) return null;                          // 탈퇴한 사람은 목록에서 뺀다
  const p = user.profile || {};
  const { id } = await readRecord(env, email);
  return { id, name: p.realName || p.nickname || user.username || '이름 없음',
    crewType: p.crewType || null, roleType: p.roleType || null, base: p.base || null, status };
}

export async function handleFriendsList(env, me) {
  const rec = await readRecord(env, me);
  const cards = await Promise.all(rec.list.map(f => peerCard(env, f.email, f.status)));
  return { myId: rec.id, friends: cards.filter(Boolean) };
}

export async function handleFriendsSearch(env, me, q) {
  const query = String(q || '').trim();
  if (query.length < 2) return { results: [] };
  const mine = await readRecord(env, me);
  const users = await scan(env, 'users', 'user:');
  const hits = users.filter(({ email, rec }) => email !== me && (
    String(rec?.profile?.employeeId || '').trim() === query ||
    String(rec?.profile?.realName || '').trim() === query)).slice(0, 5);
  const cards = await Promise.all(hits.map(({ email }) =>
    peerCard(env, email, mine.list.find(f => f.email === email)?.status || 'none')));
  return { results: cards.filter(Boolean) };
}

function setStatus(rec, email, status, at) {
  rec.list = rec.list.filter(f => f.email !== email);
  if (status) rec.list.push({ email, status, at });
}

// 요청 — 상대도 나에게 요청해 둔 상태면 바로 친구가 된다.
export async function handleFriendsRequest(env, me, id, now = new Date().toISOString()) {
  const peer = await emailForId(env, id);
  if (!peer || peer === me) return { status: 404, body: { error: '사용자를 찾을 수 없습니다' } };
  const mine = await readRecord(env, me);
  const theirs = await readRecord(env, peer);
  const current = mine.list.find(f => f.email === peer)?.status;
  if (current === 'friend') return { body: { ok: true, status: 'friend' } };
  if (mine.list.length >= FRIENDS_MAX) return { status: 400, body: { error: `친구는 ${FRIENDS_MAX}명까지 등록할 수 있습니다` } };
  const both = current === 'incoming';
  setStatus(mine, peer, both ? 'friend' : 'outgoing', now);
  setStatus(theirs, me, both ? 'friend' : 'incoming', now);
  await save(env, me, mine);
  await save(env, peer, theirs);
  return { body: { ok: true, status: both ? 'friend' : 'outgoing' }, notify: both ? null : peer };
}

export async function handleFriendsRespond(env, me, id, accept, now = new Date().toISOString()) {
  const peer = await emailForId(env, id);
  if (!peer) return { status: 404, body: { error: '사용자를 찾을 수 없습니다' } };
  const mine = await readRecord(env, me);
  if (mine.list.find(f => f.email === peer)?.status !== 'incoming') return { status: 409, body: { error: '받은 친구 요청이 없습니다' } };
  const theirs = await readRecord(env, peer);
  setStatus(mine, peer, accept ? 'friend' : null, now);
  setStatus(theirs, me, accept ? 'friend' : null, now);
  await save(env, me, mine);
  await save(env, peer, theirs);
  return { body: { ok: true, status: accept ? 'friend' : 'none' }, notify: accept ? peer : null };
}

// 끊기·요청 취소 — 양쪽에서 함께 지운다.
export async function handleFriendsRemove(env, me, id) {
  const peer = await emailForId(env, id);
  if (!peer) return { status: 404, body: { error: '사용자를 찾을 수 없습니다' } };
  const mine = await readRecord(env, me);
  const theirs = await readRecord(env, peer);
  setStatus(mine, peer, null);
  setStatus(theirs, me, null);
  await save(env, me, mine);
  await save(env, peer, theirs);
  return { body: { ok: true } };
}

export async function handleFriendsSchedule(env, me, id) {
  const peer = await emailForId(env, id);
  const mine = await readRecord(env, me);
  if (!peer || mine.list.find(f => f.email === peer)?.status !== 'friend') {
    return { status: 403, body: { error: '서로 친구인 경우에만 볼 수 있습니다' } };
  }
  const sched = await env.POSTS.get(`schedule:${peer}`, { type: 'json' });
  return { body: { schedules: (sched?.schedules || []).map(sharedDuty), updatedAt: sched?.updatedAt || null } };
}

// 계정 삭제 시 — 내 친구 목록과 상대 목록에 남은 나를 지운다.
export async function removeAllFriends(env, me) {
  const rec = await env.POSTS.get(KEY(me), { type: 'json' });
  for (const f of rec?.list || []) {
    const theirs = await env.POSTS.get(KEY(f.email), { type: 'json' });
    if (!theirs) continue;
    theirs.list = (theirs.list || []).filter(x => x.email !== me);
    await save(env, f.email, theirs);
  }
  await env.POSTS.delete(KEY(me));
}
