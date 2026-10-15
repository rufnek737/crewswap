/* 받는 계정에 새로 만든 iOS 앱에 예전 앱의 스토어 정보를 옮겨 넣는다(2026-10 계정 이전 대신).
 * 원본은 저장소 밖 백업(appstore-metadata.json)에서 읽는다. 여러 번 돌려도 같은 결과가 되게 짠다. */
import { readFileSync } from 'node:fs';
import { call, APP_ID } from './asc.mjs';

const BACKUP = `${process.env.HOME}/projects/crewswap-transfer-backup/appstore-20261015/appstore-metadata.json`;
const src = JSON.parse(readFileSync(BACKUP, 'utf8'));
const oldVer = src.versions[0];
const oldLoc = oldVer.localizations[0];
const oldInfo = src.appInfos[1];

const ok = (label, r) => {
  const good = r.status >= 200 && r.status < 300;
  console.log(good ? '✓' : '✗', label, r.status, good ? '' : JSON.stringify(r.body.errors?.map(e => e.detail || e.title)));
  return r;
};
const one = async path => (await call(path)).body.data?.[0] ?? (await call(path)).body.data;

// 1) 버전·저작권
const ver = await one(`/v1/apps/${APP_ID}/appStoreVersions`);
ok('버전 1.2.1·저작권', await call(`/v1/appStoreVersions/${ver.id}`, 'PATCH', { data: { type: 'appStoreVersions', id: ver.id,
  attributes: { versionString: '1.2.1', copyright: '2026 RufnekCrew' } } }));

// 2) 버전 현지화(설명·키워드·URL)
const vloc = await one(`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`);
ok('설명·키워드·URL', await call(`/v1/appStoreVersionLocalizations/${vloc.id}`, 'PATCH', { data: { type: 'appStoreVersionLocalizations', id: vloc.id,
  attributes: { description: oldLoc.description, keywords: oldLoc.keywords, marketingUrl: oldLoc.marketingUrl, supportUrl: oldLoc.supportUrl } } }));

// 3) 앱 정보: 카테고리, 부제·개인정보처리방침
const info = await one(`/v1/apps/${APP_ID}/appInfos`);
ok('카테고리', await call(`/v1/appInfos/${info.id}`, 'PATCH', { data: { type: 'appInfos', id: info.id, relationships: {
  primaryCategory: { data: { type: 'appCategories', id: oldInfo.primaryCategory } },
  secondaryCategory: { data: { type: 'appCategories', id: oldInfo.secondaryCategory } } } } }));
const iloc = await one(`/v1/appInfos/${info.id}/appInfoLocalizations`);
ok('부제·개인정보 URL', await call(`/v1/appInfoLocalizations/${iloc.id}`, 'PATCH', { data: { type: 'appInfoLocalizations', id: iloc.id,
  attributes: { subtitle: oldInfo.localizations[0].subtitle, privacyPolicyUrl: oldInfo.localizations[0].privacyPolicyUrl } } }));

// 4) 연령 등급
const age = (await call(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).body.data;
const ageAttrs = Object.fromEntries(Object.entries(oldInfo.ageRating).filter(([k, v]) => v !== null && k !== 'ageRatingOverride'));
ok('연령 등급', await call(`/v1/ageRatingDeclarations/${age.id}`, 'PATCH', { data: { type: 'ageRatingDeclarations', id: age.id, attributes: ageAttrs } }));

// 5) 콘텐츠 권한
ok('콘텐츠 권한', await call(`/v1/apps/${APP_ID}`, 'PATCH', { data: { type: 'apps', id: APP_ID,
  attributes: { contentRightsDeclaration: src.app.contentRightsDeclaration } } }));

// 6) 심사 정보(연락처는 계정 소유자 이름으로)
const rd = oldVer.reviewDetail;
const reviewAttrs = { contactFirstName: 'Ryeojin', contactLastName: 'Jung', contactPhone: rd.contactPhone, contactEmail: rd.contactEmail,
  demoAccountName: rd.demoAccountName, demoAccountPassword: rd.demoAccountPassword, demoAccountRequired: true, notes: rd.notes };
const existing = (await call(`/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).body.data;
if (existing) ok('심사 정보', await call(`/v1/appStoreReviewDetails/${existing.id}`, 'PATCH', { data: { type: 'appStoreReviewDetails', id: existing.id, attributes: reviewAttrs } }));
else ok('심사 정보', await call('/v1/appStoreReviewDetails', 'POST', { data: { type: 'appStoreReviewDetails', attributes: reviewAttrs,
  relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } }));

// 7) 스크린샷 — 세트가 이미 차 있으면 건너뛴다
import { statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const SHOTS = `${process.env.HOME}/projects/crewswap-transfer-backup/appstore-20261015/screenshots`;
const sets = (await call(`/v1/appStoreVersionLocalizations/${vloc.id}/appScreenshotSets?include=appScreenshots`)).body;
for (const type of ['APP_IPHONE_67', 'APP_IPAD_PRO_3GEN_129']) {
  let set = sets.data?.find(s => s.attributes.screenshotDisplayType === type);
  if (set && (set.relationships.appScreenshots.data || []).length >= 5) { console.log('✓ 스크린샷', type, '이미 있음'); continue; }
  if (!set) set = ok(`스크린샷 세트 ${type}`, await call('/v1/appScreenshotSets', 'POST', { data: { type: 'appScreenshotSets',
    attributes: { screenshotDisplayType: type },
    relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: vloc.id } } } } })).body.data;
  for (const file of readdirSync(`${SHOTS}/${type}`).filter(f => f.endsWith('.png')).sort()) {
    const path = `${SHOTS}/${type}/${file}`;
    const bytes = readFileSync(path);
    const shot = (await call('/v1/appScreenshots', 'POST', { data: { type: 'appScreenshots',
      attributes: { fileName: file, fileSize: statSync(path).size },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).body.data;
    for (const op of shot.attributes.uploadOperations) {
      await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map(h => [h.name, h.value])),
        body: bytes.subarray(op.offset, op.offset + op.length) });
    }
    ok(`스크린샷 ${type}/${file}`, await call(`/v1/appScreenshots/${shot.id}`, 'PATCH', { data: { type: 'appScreenshots', id: shot.id,
      attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') } } }));
  }
}
