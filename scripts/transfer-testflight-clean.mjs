/* 앱 이전 조건 — TestFlight: 모든 빌드 만료, 그룹 삭제, 테스트 정보 비우기.
 * 그룹에서 빼는 것만으로는 부족했다(2026-10-07, 이전 화면에서 '기준 미달'). */
import { call, APP_ID } from './asc.mjs';
const APPLY = process.argv.includes('--apply');
const builds = (await call(`/v1/builds?filter[app]=${APP_ID}&limit=200`)).body.data || [];
const live = builds.filter(b => !b.attributes.expired);
console.log(`빌드 ${builds.length}개 중 만료 안 된 것 ${live.length}개: ${live.map(b => b.attributes.version).join(', ')}`);
if (APPLY) for (const b of live) {
  const r = await call(`/v1/builds/${b.id}`, 'PATCH', { data: { type: 'builds', id: b.id, attributes: { expired: true } } });
  console.log(`  만료 ${b.attributes.version} → ${r.status === 200 ? '✅' : '❌ ' + JSON.stringify(r.body.errors?.[0]?.detail)}`);
}
const groups = (await call(`/v1/apps/${APP_ID}/betaGroups?limit=50`)).body.data || [];
console.log(`그룹 ${groups.length}개: ${groups.map(g => g.attributes.name).join(', ')}`);
if (APPLY) for (const g of groups) {
  const r = await call(`/v1/betaGroups/${g.id}`, 'DELETE');
  console.log(`  그룹 삭제 ${g.attributes.name} → ${r.status === 204 ? '✅' : '❌ ' + JSON.stringify(r.body.errors?.[0]?.detail)}`);
}
const loc = (await call(`/v1/apps/${APP_ID}/betaAppLocalizations`)).body.data || [];
for (const l of loc) {
  console.log(`테스트 정보 [${l.attributes.locale}] 비우기 시도`);
  if (APPLY) for (const f of ['description', 'privacyPolicyUrl', 'marketingUrl', 'feedbackEmail']) {
    const r = await call(`/v1/betaAppLocalizations/${l.id}`, 'PATCH', { data: { type: 'betaAppLocalizations', id: l.id, attributes: { [f]: null } } });
    console.log(`  ${f.padEnd(17)} ${r.status === 200 ? '✅ 비움' : '❌ ' + (r.body.errors?.[0]?.detail || r.status)}`);
  }
}
