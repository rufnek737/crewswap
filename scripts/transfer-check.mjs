/* 앱 이전 조건 점검 — 심사 중인 건·인앱 상태·TestFlight·Xcode Cloud·구독. */
import { call, APP_ID } from './asc.mjs';
const v = (await call(`/v1/apps/${APP_ID}/appStoreVersions?limit=5`)).body;
console.log('버전:', (v.data || []).map(x => `${x.attributes.versionString}=${x.attributes.appStoreState}`).join(', '));
const iap = (await call(`/v1/apps/${APP_ID}/inAppPurchasesV2?limit=50`)).body;
console.log('인앱:', (iap.data || []).map(p => `${p.attributes.productId}=${p.attributes.state}`).join(', '));
const g = (await call(`/v1/apps/${APP_ID}/betaGroups?limit=50`)).body;
for (const x of g.data || []) {
  const t = (await call(`/v1/betaGroups/${x.id}/betaTesters?limit=200`)).body;
  const b = (await call(`/v1/betaGroups/${x.id}/builds?limit=200`)).body;
  console.log(`TestFlight [${x.attributes.name}] 테스터 ${(t.data || []).length} · 빌드 ${(b.data || []).length}`);
}
const ci = (await call('/v1/ciProducts?limit=20')).body;
for (const p of ci.data || []) {
  const w = (await call(`/v1/ciProducts/${p.id}/workflows?limit=50`)).body;
  console.log(`Xcode Cloud [${p.attributes.name}] 워크플로 ${(w.data || []).length}`);
}
const subs = (await call(`/v1/apps/${APP_ID}/subscriptionGroups?limit=10`)).body;
console.log('자동갱신 구독 그룹:', (subs.data || []).length);
