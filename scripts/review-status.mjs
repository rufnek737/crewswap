#!/usr/bin/env node
/* 심사 상태 — 지금 누구 차례인지 한 줄로 답한다.
 *
 * 2026-09-22에 이 스크립트가 없어서 5일을 버렸다. 버전이 REJECTED 이길래 "답장 보냈으니
 * 애플 차례"라고 추론했는데, 실제로는 제출 건이 UNRESOLVED_ISSUES — 개발자 조치 대기였다.
 * 앱은 애플 대기열에서 빠져 있었고 양쪽이 서로를 기다렸다.
 *
 * 누구 차례인지는 appStoreState 가 아니라 reviewSubmissions.state 가 말해준다.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = 'PD2TJSVAU4';
const ISSUER = 'b355e8a8-97a7-4aa3-8823-ead588bc796a';
const APP_ID = '6803906439';

const key = readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`, 'utf8');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
const signer = createSign('SHA256'); signer.update(head); signer.end();
const JWT = `${head}.${signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

const api = async path => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${JWT}` } });
  if (!r.ok) throw new Error(`${r.status} ${path}\n${await r.text()}`);
  return r.json();
};

/* 제출 건 상태가 곧 "누구 차례"다. */
const WHOSE_TURN = {
  WAITING_FOR_REVIEW:  ['애플',  '대기열에 있다. 기다리면 된다.'],
  IN_REVIEW:           ['애플',  '심사 중이다.'],
  UNRESOLVED_ISSUES:   ['우리',  '★ 애플 대기열에서 빠져 반환된 상태다. Resolution Center 답장만으로는 다시 들어가지 않는다 — 재제출해야 한다.'],
  READY_FOR_REVIEW:    ['우리',  '★ 만들어만 두고 아직 제출하지 않았다.'],
  COMPLETE:            ['-',     '끝난 건이다.'],
  CANCELING:           ['-',     '취소 처리 중이다.'],
};

const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=3`);
for (const v of versions.data) {
  console.log(`버전 ${v.attributes.versionString} — ${v.attributes.appStoreState}`);
}

const subs = await api(`/v1/apps/${APP_ID}/reviewSubmissions?limit=5`);
/* 항목이 없는 제출 건은 껍데기다(취소가 403 이라 지워지지 않고 남는다). 그걸 "우리 차례"로
   알리면 매번 거짓 경보가 되고, 그러면 진짜 경보도 무시하게 된다. */
const withItems = await Promise.all(subs.data.map(async s => {
  const items = await api(`/v1/reviewSubmissions/${s.id}/items`);
  return { s, count: items.data.length };
}));
const live = withItems.filter(({ s, count }) => s.attributes.state !== 'COMPLETE' && count > 0).map(({ s }) => s);
console.log(live.length ? '\n진행 중인 제출 건:' : '\n진행 중인 제출 건이 없다 — 아무것도 심사에 올라가 있지 않다.');
for (const s of live) {
  const [turn, note] = WHOSE_TURN[s.attributes.state] || ['?', ''];
  console.log(`  ${s.attributes.state}  (제출 ${s.attributes.submittedDate || '안 함'})`);
  console.log(`  → 지금은 ${turn} 차례. ${note}`);
}
