/* App Store Connect API 호출 도우미. 키는 저장소 밖(~/.appstoreconnect)에서 읽는다.
 * 임시 폴더에 두었다가 두 번 사라져서 여기로 옮겼다(2026-10-07).
 * 앱이 다른 계정으로 넘어가면 KEY_ID·ISSUER 를 새 계정 것으로 바꾼다. */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = 'PD2TJSVAU4';
const ISSUER = 'b355e8a8-97a7-4aa3-8823-ead588bc796a';
export const APP_ID = '6803906439';

const key = readFileSync(`${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`, 'utf8');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
const signer = createSign('SHA256'); signer.update(head); signer.end();
const JWT = `${head}.${signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

export async function call(path, method = 'GET', body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${JWT}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (r.status === 204 || r.status === 404) ? {} : await r.json().catch(() => ({})) };
}
