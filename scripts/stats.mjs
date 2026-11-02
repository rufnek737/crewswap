#!/usr/bin/env node
/* 이용 현황 집계 — 가입자·글·요청·성사 건수를 한 번에 본다.
 *
 *   node scripts/stats.mjs
 *
 * 운영(D1 crewswap-db)을 읽기만 한다. 이메일은 출력하지 않는다.
 * 테스트 계정(@rufnekcrew.com 과 ~/.crewswap/test-accounts.txt 에 적은 주소)은 따로 센다 —
 * 저장소가 공개라 개인 주소를 여기에 적지 않는다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workerDir = fileURLToPath(new URL('../worker/', import.meta.url));

const testAccounts = new Set((() => {
  try { return readFileSync(`${process.env.HOME}/.crewswap/test-accounts.txt`, 'utf8').split(/\s+/).filter(Boolean); }
  catch { return []; }
})().map(e => e.toLowerCase()));
const isTest = email => !email || /@rufnekcrew\.com$/i.test(email) || testAccounts.has(email.toLowerCase());

function query(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'crewswap-db', '--remote', '--json', '--command', sql],
    { cwd: workerDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const users = query('SELECT email, created_at FROM users');
const posts = query('SELECT owner_email, status, created_at FROM posts');
const requests = query("SELECT from_email, to_email, created_at, json_extract(data,'$.status') status FROM requests");

const realUsers = users.filter(u => !isTest(u.email));
const realPosts = posts.filter(p => !isTest(p.owner_email));
const realRequests = requests.filter(r => !isTest(r.from_email) && !isTest(r.to_email));

const countBy = (rows, key) => rows.reduce((m, r) => (m[r[key] ?? '?'] = (m[r[key] ?? '?'] || 0) + 1, m), {});
const print = (title, map) => {
  console.log(title);
  for (const [k, n] of Object.entries(map).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
};
const mutual = rows => rows.filter(r => /상호 수락|상신/.test(r.status || '')).length;
const submitted = rows => rows.filter(r => /회사 상신 완료/.test(r.status || '')).length;
const lastWeek = rows => rows.filter(r => Date.parse(r.created_at) > Date.now() - 7 * 864e5).length;

console.log(`듀티스왑 이용 현황 — ${new Date().toLocaleString('ko-KR')}  (테스트 계정 제외, 괄호는 전체)\n`);
console.log(`가입 계정   ${realUsers.length} (${users.length})   최근 7일 +${lastWeek(realUsers)}`);
console.log(`스왑 글     ${realPosts.length} (${posts.length})   최근 7일 +${lastWeek(realPosts)}`);
console.log(`요청·의향   ${realRequests.length} (${requests.length})   최근 7일 +${lastWeek(realRequests)}`);
console.log(`상호 수락   ${mutual(realRequests)} (${mutual(requests)})`);
console.log(`상신 완료   ${submitted(realRequests)} (${submitted(requests)})   ← 실제 성사\n`);
print('글 상태 (테스트 제외)', countBy(realPosts, 'status'));
print('요청 상태 (테스트 제외)', countBy(realRequests, 'status'));
