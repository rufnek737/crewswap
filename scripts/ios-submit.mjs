/* iOS 버전 심사 제출 — 빌드 처리 대기 → 버전 생성(수동 출시) → 「새로운 기능」 → 빌드 연결 → 제출.
 * 쓰는 법: node scripts/ios-submit.mjs <버전> <빌드번호> <새로운기능.txt>
 * 「새로운 기능」 문구는 Kay 검토를 받은 것만 넣는다(파일로 받는 이유). */
import { readFileSync } from 'node:fs';
import { call, APP_ID } from './asc.mjs';
const [, , VER, BUILD, NOTES] = process.argv;
if (!VER || !BUILD || !NOTES) { console.log('사용: node scripts/ios-submit.mjs 1.2.5 64 notes.txt'); process.exit(1); }
const whatsNew = readFileSync(NOTES, 'utf8').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const err = r => JSON.stringify(r.body.errors?.map(e => e.detail) || '');
let build;
for (let i = 0; i < 40; i++) {
  const b = (await call(`/v1/builds?filter[app]=${APP_ID}&filter[version]=${BUILD}`)).body.data?.[0];
  if (b?.attributes.processingState === 'VALID') { build = b; break; }
  await sleep(30000);
}
if (!build) { console.log('빌드 처리가 끝나지 않았다'); process.exit(1); }
let v = (await call(`/v1/apps/${APP_ID}/appStoreVersions`)).body.data.find(x => x.attributes.versionString === VER);
if (!v) {
  const r = await call('/v1/appStoreVersions', 'POST', { data: { type: 'appStoreVersions',
    attributes: { platform: 'IOS', versionString: VER, copyright: '2026 RufnekCrew', releaseType: 'MANUAL' },
    relationships: { app: { data: { type: 'apps', id: APP_ID } } } } });
  console.log('버전 생성', r.status, err(r)); v = r.body.data;
}
const loc = (await call(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`)).body.data[0];
let r = await call(`/v1/appStoreVersionLocalizations/${loc.id}`, 'PATCH', { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } } });
console.log('새로운 기능', r.status, err(r));
r = await call(`/v1/appStoreVersions/${v.id}/relationships/build`, 'PATCH', { data: { type: 'builds', id: build.id } });
console.log('빌드 연결', r.status);
const sub = await call('/v1/reviewSubmissions', 'POST', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } } });
const sid = sub.body.data?.id; console.log('제출 건', sub.status, err(sub));
r = await call('/v1/reviewSubmissionItems', 'POST', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sid } }, appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } } });
console.log('항목', r.status, err(r));
if (r.status < 300) {
  r = await call(`/v1/reviewSubmissions/${sid}`, 'PATCH', { data: { type: 'reviewSubmissions', id: sid, attributes: { submitted: true } } });
  console.log('제출', r.status, r.body.data?.attributes?.state, err(r));
}
