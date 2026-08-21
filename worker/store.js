/* CrewSwap 저장소 — Cloudflare D1
 *
 * KV 무료 플랜의 일일 쓰기 한도(1,000회)가 회원가입·인증·스왑 등록에서 먼저 바닥나
 * 서비스가 멈추는 문제로 D1(무료 한도 하루 10만 행 쓰기)로 옮겼다.
 *
 * 기존 코드가 쓰던 KV 인터페이스(get/put/delete)를 그대로 유지해 호출부를 고치지 않는다.
 * 키 접두사로 테이블을 찾아가고, 레코드 JSON은 모양 그대로 data 컬럼에 넣는다.
 * 목록 조회는 listPosts/listRequests의 SQL로 처리하므로 idx:* 캐시 키가 필요 없고,
 * 글 1건이 바뀔 때마다 전체 목록을 다시 쓰던 증폭도 사라진다.
 */

// 키 → { table, column, id }. 매칭되는 규칙이 없으면 null(=처리 불가).
function route(rawKey) {
  const key = String(rawKey || '');
  // 멱등 키가 post:/request: 접두사를 공유하므로 먼저 걸러낸다.
  if (/^(post|request):create(-reverse)?:/.test(key)) return { table: 'idempotency', column: 'key', id: key, valueColumn: 'value' };
  if (key.startsWith('iap:')) return { table: 'purchase_bindings', column: 'key', id: key };
  if (key.startsWith('user:')) return { table: 'users', column: 'email', id: key.slice(5) };
  if (key.startsWith('wallet:')) return { table: 'wallets', column: 'email', id: key.slice(7) };
  if (key.startsWith('reqval:')) return { table: 'request_validations', column: 'id', id: key.slice(7) };
  if (key.startsWith('req:')) return { table: 'requests', column: 'id', id: key.slice(4) };
  if (key.startsWith('post:')) return { table: 'posts', column: 'id', id: key.slice(5) };
  return null;
}

// 레코드에서 조회용 컬럼을 뽑아낸다. 목록 필터가 SQL로 동작하려면 본문과 함께 채워야 한다.
function columnsFor(table, id, rec) {
  switch (table) {
    case 'users': return { created_at: rec?.createdAt ?? null };
    case 'posts': return { owner_email: rec?.ownerEmail ?? null, status: rec?.status ?? null, created_at: rec?.registeredAt ?? null };
    case 'requests': return { post_id: rec?.postId ?? null, from_email: rec?.fromEmail ?? null, to_email: rec?.toEmail ?? null, created_at: rec?.createdAt ?? null };
    case 'idempotency': return { created_at: new Date().toISOString() };
    default: return {};
  }
}

export function createStore(db) {
  return {
    kind: 'd1',
    async get(key, options) {
      const r = route(key);
      if (!r) return null;
      const valueColumn = r.valueColumn || 'data';
      const row = await db
        .prepare(`SELECT ${valueColumn} AS value FROM ${r.table} WHERE ${r.column} = ?`)
        .bind(r.id)
        .first();
      const raw = row?.value ?? null;
      if (raw === null) return null;
      if (options?.type === 'json') {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    },

    async put(key, value) {
      const r = route(key);
      if (!r) return;
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      let rec = null;
      try { rec = JSON.parse(raw); } catch { /* 문자열 값(멱등 키 등)은 컬럼 추출 없이 저장 */ }
      const valueColumn = r.valueColumn || 'data';
      const extra = columnsFor(r.table, r.id, rec);
      const cols = [r.column, valueColumn, ...Object.keys(extra)];
      const vals = [r.id, raw, ...Object.values(extra)];
      await db
        .prepare(`INSERT OR REPLACE INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .bind(...vals)
        .run();
    },

    async delete(key) {
      const r = route(key);
      if (!r) return;
      await db.prepare(`DELETE FROM ${r.table} WHERE ${r.column} = ?`).bind(r.id).run();
    },
  };
}

/* D1 바인딩이 없는 환경(단위 테스트·로컬)에서는 기존 KV를 그대로 쓴다.
   운영 코드가 저장소 종류와 무관하게 같은 함수를 호출하도록 인터페이스를 맞춘다. */
export function createKvStore(kv) {
  return {
    kind: 'kv',
    get: (key, options) => kv.get(key, options),
    put: (key, value, options) => kv.put(key, value, options),
    delete: (key) => kv.delete(key),
    list: (options) => kv.list(options),
  };
}

/* KV 경로의 목록 조회는 예전 방식을 그대로 둔다.
   list() 한도가 낮아 전체 목록을 idx:* 키에 캐싱하고, 캐시가 없을 때만 재구성한다.
   (D1 경로에서는 이 캐시도, 캐시를 다시 쓰는 비용도 필요 없다.) */
async function listKvCached(kv, indexKey, prefix, skip) {
  const cached = await kv.get(indexKey, { type: 'json' });
  if (Array.isArray(cached)) return cached;
  const { keys } = await kv.list({ prefix });
  const names = keys.map(k => k.name).filter(name => !skip?.test(name));
  const values = await Promise.all(names.map(name => kv.get(name, { type: 'json' })));
  const list = values.filter(Boolean);
  await kv.put(indexKey, JSON.stringify(list));
  return list;
}

export async function saveIndex(db, kv, indexKey, records) {
  if (db) return; // D1은 행 단위 저장이라 목록 캐시가 없다
  await kv.put(indexKey, JSON.stringify(records || []));
}

// 목록 조회 — 예전에는 idx:posts / idx:requests 배열을 통째로 읽고 다시 썼다.
function parseRows(rows) {
  return (rows || []).map(row => { try { return JSON.parse(row.data); } catch { return null; } }).filter(Boolean);
}

export const POSTS_INDEX_KEY = 'idx:posts';
export const REQUESTS_INDEX_KEY = 'idx:requests';

export async function listPosts(db, kv) {
  if (!db) return listKvCached(kv, POSTS_INDEX_KEY, 'post:', /^post:create(-reverse)?:/);
  const { results } = await db.prepare('SELECT data FROM posts').all();
  return parseRows(results);
}

export async function listRequests(db, kv) {
  if (!db) return listKvCached(kv, REQUESTS_INDEX_KEY, 'req:', null);
  const { results } = await db.prepare('SELECT data FROM requests').all();
  return parseRows(results);
}

// 사용자가 당사자인 요청만 — 전체를 읽어 걸러내지 않고 SQL에서 좁힌다.
export async function listRequestsForEmail(db, email) {
  const { results } = await db
    .prepare('SELECT data FROM requests WHERE from_email = ? OR to_email = ?')
    .bind(email, email)
    .all();
  return parseRows(results);
}

export const PREMIUM_ALERT_INDEX_KEY = 'idx:premium-alert-subscribers';

export async function listPremiumAlerts(db, kv) {
  if (!db) {
    const value = await kv.get(PREMIUM_ALERT_INDEX_KEY, { type: 'json' });
    return Array.isArray(value) ? value : [];
  }
  const { results } = await db.prepare('SELECT data FROM premium_alerts').all();
  return parseRows(results);
}

// 호출부는 예전처럼 배열 전체를 넘긴다. D1에서는 이메일별 행으로 나눠 반영하고,
// 목록에서 빠진 사용자는 삭제한다(회원 탈퇴·알림 해제).
export async function savePremiumAlerts(db, kv, records) {
  const list = Array.isArray(records) ? records.filter(r => r?.email) : [];
  if (!db) {
    await kv.put(PREMIUM_ALERT_INDEX_KEY, JSON.stringify(list));
    return;
  }
  const existing = await listPremiumAlerts(db);
  const keep = new Set(list.map(r => r.email));
  await Promise.all([
    ...list.map(r => db
      .prepare('INSERT OR REPLACE INTO premium_alerts (email, data) VALUES (?, ?)')
      .bind(r.email, JSON.stringify(r)).run()),
    ...existing.filter(r => r?.email && !keep.has(r.email)).map(r => db
      .prepare('DELETE FROM premium_alerts WHERE email = ?').bind(r.email).run()),
  ]);
}
