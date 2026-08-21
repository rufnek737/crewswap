// KV 백업(backup/kv-dump.json) → D1 이관용 SQL 생성기.
// 사용: node worker/migrate-kv-to-d1.mjs > worker/migrate-data.sql
// 레코드 JSON은 그대로 옮기고, 조회에 쓰는 값만 컬럼으로 뽑는다.
// idx:* 캐시 키는 SQL 조회로 대체되므로 옮기지 않는다.

import { readFileSync } from 'node:fs';

const dump = JSON.parse(readFileSync(new URL('../backup/kv-dump.json', import.meta.url), 'utf8'));

const q = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const out = [];
const parse = (raw) => { try { return JSON.parse(raw); } catch { return null; } };

let counts = {};
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

for (const [key, raw] of Object.entries(dump)) {
  const rec = parse(raw);

  if (key.startsWith('user:')) {
    const email = key.slice('user:'.length);
    out.push(`INSERT OR REPLACE INTO users (email, data, created_at) VALUES (${q(email)}, ${q(raw)}, ${q(rec?.createdAt)});`);
    bump('users');

  } else if (key.startsWith('wallet:')) {
    const email = key.slice('wallet:'.length);
    out.push(`INSERT OR REPLACE INTO wallets (email, data) VALUES (${q(email)}, ${q(raw)});`);
    bump('wallets');

  } else if (key.startsWith('reqval:')) {
    const id = key.slice('reqval:'.length);
    out.push(`INSERT OR REPLACE INTO request_validations (id, data) VALUES (${q(id)}, ${q(raw)});`);
    bump('request_validations');

  } else if (key.startsWith('req:')) {
    const id = key.slice('req:'.length);
    out.push(`INSERT OR REPLACE INTO requests (id, post_id, from_email, to_email, data, created_at) VALUES (${q(id)}, ${q(rec?.postId)}, ${q(rec?.fromEmail)}, ${q(rec?.toEmail)}, ${q(raw)}, ${q(rec?.createdAt)});`);
    bump('requests');

  } else if (key.startsWith('post:')) {
    // post:create:* / post:create-reverse:* 는 멱등 키
    const rest = key.slice('post:'.length);
    if (rest.startsWith('create:') || rest.startsWith('create-reverse:')) {
      out.push(`INSERT OR REPLACE INTO idempotency (key, value, created_at) VALUES (${q(key)}, ${q(raw)}, ${q(new Date().toISOString())});`);
      bump('idempotency');
    } else {
      out.push(`INSERT OR REPLACE INTO posts (id, owner_email, status, data, created_at) VALUES (${q(rest)}, ${q(rec?.ownerEmail)}, ${q(rec?.status)}, ${q(raw)}, ${q(rec?.registeredAt)});`);
      bump('posts');
    }

  } else if (key.startsWith('request:create')) {
    out.push(`INSERT OR REPLACE INTO idempotency (key, value, created_at) VALUES (${q(key)}, ${q(raw)}, ${q(new Date().toISOString())});`);
    bump('idempotency');

  } else if (key === 'idx:premium-alert-subscribers') {
    // 배열 → 이메일별 행으로 분리
    for (const item of Array.isArray(rec) ? rec : []) {
      const email = item?.email;
      if (!email) continue;
      out.push(`INSERT OR REPLACE INTO premium_alerts (email, data) VALUES (${q(email)}, ${q(JSON.stringify(item))});`);
      bump('premium_alerts');
    }

  } else if (key.startsWith('idx:')) {
    // idx:posts / idx:requests — SQL 조회로 대체되므로 이관하지 않음
    bump('skipped_index');

  } else {
    bump(`unknown(${key})`);
  }
}

console.log('-- KV → D1 데이터 이관 (자동 생성)');
console.log(`-- 원본 키 ${Object.keys(dump).length}개`);
for (const [k, v] of Object.entries(counts)) console.log(`-- ${k}: ${v}`);
console.log(out.join('\n'));
