/* 차단과 신고.
 *
 * Google Play 와 App Store 는 사용자가 쓴 글이 있거나 1:1 상호작용이 있는 앱에
 * 신고 수단과 차단 수단을 각각 요구한다. 회사 이메일 인증으로 가입이 닫혀 있어도
 * 면제되지 않는다.
 *
 * 차단은 사용자당 한 행에 상대 목록을 통째로 담는다. 한 사람이 차단하는 인원이
 * 많지 않고, 목록을 읽는 쪽이 압도적으로 잦아 행을 쪼갤 이유가 없다.
 * 신고는 건당 한 행이다 — 나중에 훑어보려면 남아 있어야 한다.
 */
import { compareAndSwap } from './atomic-store.mjs';

const BLOCK_KEY = email => `block:${String(email || '').trim().toLowerCase()}`;
const MAX_BLOCKS = 500;
const MAX_DETAIL = 1000;

export const REPORT_REASONS = Object.freeze([
  'harassment',    // 괴롭힘·위협
  'privacy',       // 개인정보 노출
  'spam',          // 스팸·광고
  'impersonation', // 사칭
  'false_post',    // 허위 근무·이미 취소된 일정
  'other',
]);

const normalize = email => String(email || '').trim().toLowerCase();

/* 차단 목록은 { email, nick } 으로 보관한다. 화면에는 닉네임만 돌려준다 —
   앱은 상대의 회사 이메일을 어디에도 노출하지 않으므로, 차단 목록이라고 예외를
   두면 그 약속이 깨진다. 해제는 이메일 대신 짧은 해시(id)로 지목한다. */
export const blockId = email => [...new TextEncoder().encode(normalize(email))]
  .reduce((h, b) => (h * 31 + b) >>> 0, 7).toString(36);

async function blockEntries(env, email) {
  const rec = await env.POSTS.get(BLOCK_KEY(email), { type: 'json' });
  return Array.isArray(rec?.blocked) ? rec.blocked : [];
}

/** 이 사람이 차단한 상대 이메일 목록. 없으면 빈 배열. */
export async function blockedBy(env, email) {
  return (await blockEntries(env, email)).map(e => (typeof e === 'string' ? e : e.email)).filter(Boolean);
}

/** 화면용 — 이메일은 빼고 닉네임과 해제용 id 만 준다. */
export async function blockList(env, email) {
  return (await blockEntries(env, email)).map(e => {
    const target = typeof e === 'string' ? e : e.email;
    return { id: blockId(target), nick: (typeof e === 'string' ? '' : e.nick) || '이름 없음', blockedAt: e.blockedAt || null };
  });
}

/* 양쪽 어느 방향이든 차단이면 서로 보이지 않아야 한다. 차단한 사람만 가려주면
   차단당한 쪽이 계속 말을 걸 수 있어 차단이 아니다. */
export async function hiddenPairs(env, viewerEmail, otherEmails) {
  const viewer = normalize(viewerEmail);
  if (!viewer) return new Set();
  const others = [...new Set(otherEmails.map(normalize).filter(Boolean))];
  const iBlocked = new Set(await blockedBy(env, viewer));
  const blockedMe = await Promise.all(
    others.filter(e => !iBlocked.has(e)).map(async e => ((await blockedBy(env, e)).includes(viewer) ? e : null)),
  );
  return new Set([...iBlocked, ...blockedMe.filter(Boolean)]);
}

export async function isHidden(env, viewerEmail, otherEmail) {
  const other = normalize(otherEmail);
  if (!other || other === normalize(viewerEmail)) return false;
  return (await hiddenPairs(env, viewerEmail, [other])).has(other);
}

/* 차단은 글 id 로 건다 — 클라이언트는 상대 이메일을 모르고, 알 필요도 없다.
   해제는 목록에서 받은 id 로 한다. */
export async function setBlock(env, email, { postId, id, nick, blocked = true }) {
  const viewer = normalize(email);
  const key = BLOCK_KEY(viewer);
  let target = '';
  let label = String(nick || '').slice(0, 40);
  if (postId) {
    const post = await env.POSTS.get(`post:${postId}`, { type: 'json' });
    if (!post?.ownerEmail) return { ok: false, error: '대상을 찾을 수 없습니다', status: 404 };
    target = normalize(post.ownerEmail);
    label = label || post.fromNick || '';
  } else if (id) {
    target = (await blockedBy(env, viewer)).find(e => blockId(e) === id) || '';
    if (!target) return { ok: false, error: '차단 목록에 없습니다', status: 404 };
  }
  if (!target) return { ok: false, error: '대상이 없습니다', status: 400 };
  if (target === viewer) return { ok: false, error: '자신은 차단할 수 없습니다', status: 400 };

  for (let retry = 0; retry < 12; retry++) {
    const raw = await env.POSTS.get(key);
    const list = raw ? (JSON.parse(raw).blocked || []) : [];
    const normalized = list.map(e => (typeof e === 'string' ? { email: e, nick: '' } : e)).filter(e => e?.email);
    const next = blocked
      ? (normalized.some(e => e.email === target)
          ? normalized
          : [...normalized, { email: target, nick: label, blockedAt: new Date().toISOString() }])
      : normalized.filter(e => e.email !== target);
    if (next.length > MAX_BLOCKS) return { ok: false, error: '차단 목록이 가득 찼습니다', status: 400 };
    const value = JSON.stringify({ blocked: next, updatedAt: new Date().toISOString() });
    if (raw === value || await compareAndSwap(env.POSTS, key, raw, value)) return { ok: true };
  }
  return { ok: false, error: '차단 처리가 겹쳤습니다. 잠시 후 다시 시도해주세요.', status: 409 };
}

export async function createReport(env, reporterEmail, { targetType, targetId, targetEmail, reason, detail }) {
  if (!REPORT_REASONS.includes(reason)) return { ok: false, error: '신고 사유를 선택해주세요', status: 400 };
  if (!targetType || !targetId) return { ok: false, error: '신고 대상이 없습니다', status: 400 };
  const id = crypto.randomUUID();
  const record = {
    id,
    reporterEmail: normalize(reporterEmail),
    targetType: String(targetType).slice(0, 20),
    targetId: String(targetId).slice(0, 100),
    targetEmail: normalize(targetEmail),
    reason,
    detail: String(detail || '').slice(0, MAX_DETAIL),
    createdAt: new Date().toISOString(),
    status: 'open',
  };
  await env.POSTS.put(`report:${id}`, JSON.stringify(record));
  return { ok: true, id };
}
