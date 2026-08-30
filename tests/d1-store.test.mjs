// D1 저장소 경로 검증.
// 다른 테스트는 KV 폴백만 지나가므로, 운영에서 실제로 쓰는 D1 경로를 여기서 확인한다.
// createStore가 만드는 SQL만 처리하는 최소 구현으로 D1 바인딩을 흉내 낸다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, listPosts, listRequests, listPremiumAlerts, savePremiumAlerts,
  listSubmitRejections, appendSubmitRejection } from '../worker/store.js';

function createFakeD1() {
  const tables = new Map(); // table -> Map(pk -> row)
  const tableOf = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };

  function run(sql, binds) {
    let m;
    if ((m = /^SELECT (\w+) AS value FROM (\w+) WHERE (\w+) = \?$/.exec(sql))) {
      const [, col, table, where] = m;
      for (const row of tableOf(table).values()) {
        if (String(row[where]) === String(binds[0])) return { first: { value: row[col] ?? null } };
      }
      return { first: null };
    }
    if ((m = /^INSERT OR REPLACE INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(sql))) {
      const [, table, colList] = m;
      const cols = colList.split(',').map(s => s.trim());
      const row = {};
      cols.forEach((c, i) => { row[c] = binds[i]; });
      tableOf(table).set(String(binds[0]), row);
      return { first: null };
    }
    if ((m = /^DELETE FROM (\w+) WHERE (\w+) = \?$/.exec(sql))) {
      const [, table, where] = m;
      for (const [pk, row] of tableOf(table)) {
        if (String(row[where]) === String(binds[0])) tableOf(table).delete(pk);
      }
      return { first: null };
    }
    if ((m = /^SELECT data FROM (\w+)$/.exec(sql))) {
      return { results: [...tableOf(m[1]).values()].map(r => ({ data: r.data })) };
    }
    if ((m = /^SELECT data FROM (\w+) ORDER BY (\w+) ASC$/.exec(sql))) {
      const [, table, col] = m;
      const rows = [...tableOf(table).values()].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      return { results: rows.map(r => ({ data: r.data })) };
    }
    if ((m = /^INSERT OR IGNORE INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/.exec(sql))) {
      const [, table, colList] = m;
      const cols = colList.split(',').map(s => s.trim());
      const pk = String(binds[0]);
      if (tableOf(table).has(pk)) return { first: null }; // IGNORE — 기존 행 유지
      const row = {};
      cols.forEach((c, i) => { row[c] = binds[i]; });
      tableOf(table).set(pk, row);
      return { first: null };
    }
    if ((m = /^SELECT data FROM requests WHERE from_email = \? OR to_email = \?$/.exec(sql))) {
      const results = [...tableOf('requests').values()]
        .filter(r => r.from_email === binds[0] || r.to_email === binds[1])
        .map(r => ({ data: r.data }));
      return { results };
    }
    throw new Error(`fake D1이 처리하지 못한 SQL: ${sql}`);
  }

  return {
    _tables: tables,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...args) { binds = args; return stmt; },
        async first() { return run(sql, binds).first; },
        async all() { return run(sql, binds); },
        async run() { return run(sql, binds); },
      };
      return stmt;
    },
  };
}

test('키 접두사에 따라 알맞은 테이블에 저장·조회된다', async () => {
  const db = createFakeD1();
  const store = createStore(db);

  await store.put('user:a@jejuair.net', JSON.stringify({ email: 'a@jejuair.net', createdAt: '2026-08-01' }));
  await store.put('wallet:a@jejuair.net', JSON.stringify({ credits: 3 }));
  await store.put('post:POST-1', JSON.stringify({ id: 'POST-1', ownerEmail: 'a@jejuair.net', status: 'active' }));
  await store.put('req:REQ-1', JSON.stringify({ id: 'REQ-1', postId: 'POST-1', fromEmail: 'b@x', toEmail: 'a@jejuair.net' }));
  await store.put('reqval:REQ-1', JSON.stringify([{ day: 1 }]));

  assert.equal((await store.get('user:a@jejuair.net', { type: 'json' })).email, 'a@jejuair.net');
  assert.equal((await store.get('wallet:a@jejuair.net', { type: 'json' })).credits, 3);
  assert.equal((await store.get('post:POST-1', { type: 'json' })).status, 'active');
  assert.equal((await store.get('req:REQ-1', { type: 'json' })).postId, 'POST-1');
  assert.deepEqual(await store.get('reqval:REQ-1', { type: 'json' }), [{ day: 1 }]);

  // 각 레코드가 서로 다른 테이블에 들어갔는지 확인
  assert.equal(db._tables.get('users').size, 1);
  assert.equal(db._tables.get('posts').size, 1);
  assert.equal(db._tables.get('requests').size, 1);
});

test('조회용 컬럼이 함께 채워져 SQL 필터가 동작한다', async () => {
  const db = createFakeD1();
  const store = createStore(db);
  await store.put('post:POST-1', JSON.stringify({ id: 'POST-1', ownerEmail: 'owner@x', status: 'active' }));
  const row = [...db._tables.get('posts').values()][0];
  assert.equal(row.owner_email, 'owner@x');
  assert.equal(row.status, 'active');
});

test('멱등 키는 데이터 레코드와 분리된 테이블에 저장된다', async () => {
  const db = createFakeD1();
  const store = createStore(db);
  await store.put('post:create:token-1', 'POST-1');
  await store.put('request:create:token-2', 'REQ-1');
  assert.equal(await store.get('post:create:token-1'), 'POST-1');
  assert.equal(await store.get('request:create:token-2'), 'REQ-1');
  assert.equal(db._tables.get('idempotency').size, 2);
  // 멱등 키가 posts 테이블을 오염시키지 않아야 한다
  assert.equal(db._tables.get('posts')?.size ?? 0, 0);
});

test('삭제하면 이후 조회가 null이다', async () => {
  const db = createFakeD1();
  const store = createStore(db);
  await store.put('req:REQ-1', JSON.stringify({ id: 'REQ-1' }));
  await store.delete('req:REQ-1');
  assert.equal(await store.get('req:REQ-1', { type: 'json' }), null);
});

test('목록 조회가 저장한 레코드를 그대로 돌려준다', async () => {
  const db = createFakeD1();
  const store = createStore(db);
  await store.put('post:POST-1', JSON.stringify({ id: 'POST-1', ownerEmail: 'a@x' }));
  await store.put('post:POST-2', JSON.stringify({ id: 'POST-2', ownerEmail: 'b@x' }));
  await store.put('post:create:tok', 'POST-1'); // 멱등 키는 목록에 섞이면 안 됨
  await store.put('req:REQ-1', JSON.stringify({ id: 'REQ-1' }));

  const posts = await listPosts(db);
  assert.deepEqual(posts.map(p => p.id).sort(), ['POST-1', 'POST-2']);
  const requests = await listRequests(db);
  assert.deepEqual(requests.map(r => r.id), ['REQ-1']);
});

test('PRO 알림 목록은 이메일별 행으로 저장되고 빠진 사용자는 지워진다', async () => {
  const db = createFakeD1();
  await savePremiumAlerts(db, null, [
    { email: 'a@x', searches: [] },
    { email: 'b@x', searches: [] },
  ]);
  assert.equal((await listPremiumAlerts(db)).length, 2);

  await savePremiumAlerts(db, null, [{ email: 'a@x', searches: [{ id: 'S1' }] }]);
  const remaining = await listPremiumAlerts(db);
  assert.deepEqual(remaining.map(r => r.email), ['a@x']);
  assert.equal(remaining[0].searches.length, 1);
});

/* ── 워커 전체 흐름이 D1로 도는지 확인 ──────────────────────────
   운영에서는 env.DB가 있으면 저장소가 D1로 바뀐다. 요청 수락 흐름을
   그대로 태워, 상태 변화가 KV가 아니라 D1 테이블에 남는지 검증한다. */
import rawWorker, { issueSessionToken } from '../worker/index.js';

const TEST_AUTH_SECRET = 'test-auth-secret-at-least-32-characters';
// 다른 워커 테스트와 같은 방식으로 세션 토큰을 붙여준다.
const worker = {
  async fetch(request, env, ctx) {
    env.AUTH_SECRET ||= TEST_AUTH_SECRET;
    env.VERIFY_SECRET ||= 'test-verify-secret-at-least-32-characters';
    const body = await request.clone().json().catch(() => ({}));
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${await issueSessionToken(env, body.email)}`);
    return rawWorker.fetch(new Request(request, { headers }), env, ctx);
  },
};

function api(path, body) {
  return new Request(`https://example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('요청 수락 흐름이 D1 저장소에서 그대로 동작한다', async () => {
  const db = createFakeD1();
  const seed = createStore(db);
  await seed.put('req:REQ-1', JSON.stringify({
    id: 'REQ-1',
    fromEmail: 'requester@jejuair.net',
    toEmail: 'poster@jejuair.net',
    stage: 1,
    status: '상대가 바꿀 날 고르는 중',
    openRoster: [
      { month: '2026-08', day: 18, type: 'OFF' },
      { month: '2026-08', day: 24, type: '국제선' },
    ],
  }));

  // KV는 남겨두되, D1이 있으면 워커가 D1을 쓰는지 본다.
  const kv = { async get() { return null; }, async put() {}, async delete() {}, async list() { return { keys: [] }; } };
  const env = { DB: db, POSTS: kv };

  const select = await worker.fetch(api('/api/requests-poster-select', {
    id: 'REQ-1',
    email: 'poster@jejuair.net',
    offered: { patternName: '8/24 국제선', days: [24] },
  }), env, {});
  assert.equal(select.status, 200);

  const afterSelect = JSON.parse([...db._tables.get('requests').values()][0].data);
  assert.equal(afterSelect.stage, 2);
  assert.equal(afterSelect.posterSelected, true);

  const accept = await worker.fetch(api('/api/requests-requester-accept', {
    id: 'REQ-1',
    email: 'requester@jejuair.net',
    realName: '요청자',
    employeeId: 'A100',
    phone: '010-0000-0000',
  }), env, {});
  assert.equal(accept.status, 200);

  const accepted = JSON.parse([...db._tables.get('requests').values()][0].data);
  assert.equal(accepted.stage, 3);
  assert.equal(accepted.status, '상호 수락 — 회사 상신 필요');
});

// 상신 반려 사유는 idx:* 배열이 아니라 행으로 저장돼야 한다.
// D1 store의 route()는 idx:* 키를 처리하지 않아, 직접 put하면 운영에서만 조용히 사라진다.
test('상신 반려 사유가 D1에 행으로 저장·조회된다', async () => {
  const db = createFakeD1();
  await appendSubmitRejection(db, null, {
    reqId: 'REQ-1', at: '2026-08-30T01:00:00.000Z', reason: '편조 기준 미충족',
  });
  await appendSubmitRejection(db, null, {
    reqId: 'REQ-2', at: '2026-08-30T02:00:00.000Z', reason: '마감 경과',
  });

  const rows = await listSubmitRejections(db, null);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.reqId), ['REQ-1', 'REQ-2']); // at 오름차순
  assert.equal(rows[0].reason, '편조 기준 미충족');
});

test('같은 요청을 두 번 기록해도 행이 늘지 않는다', async () => {
  const db = createFakeD1();
  const entry = { reqId: 'REQ-1', at: '2026-08-30T01:00:00.000Z', reason: '편조 기준 미충족' };
  await appendSubmitRejection(db, null, entry);
  await appendSubmitRejection(db, null, { ...entry, reason: '다른 사유' });

  const rows = await listSubmitRejections(db, null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, '편조 기준 미충족'); // 먼저 기록된 것이 남는다
});

test('D1 바인딩이 없으면 KV 배열로 떨어진다', async () => {
  const values = new Map();
  const kv = {
    async get(key, options) {
      const v = values.get(key);
      return v == null ? null : (options?.type === 'json' ? JSON.parse(v) : v);
    },
    async put(key, value) { values.set(key, String(value)); },
  };
  await appendSubmitRejection(null, kv, { reqId: 'REQ-1', at: '2026-08-30T01:00:00.000Z', reason: 'A' });
  await appendSubmitRejection(null, kv, { reqId: 'REQ-1', at: '2026-08-30T01:00:00.000Z', reason: 'B' });
  const rows = await listSubmitRejections(null, kv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'A');
});
