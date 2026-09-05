// 안드로이드 푸시(FCM). 토큰 형식과 "끊긴 토큰" 판정을 틀리면 조용히 알림이 사라지거나,
// 반대로 멀쩡한 기기를 목록에서 지워버린다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { fcmConfigured, fcmTokenGone, fcmAccessToken, sendFcmNotification } from '../worker/fcm.mjs';
import { sanitizeNativeDevice } from '../worker/apns.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test('설정이 다 있어야 켜진 것으로 본다', () => {
  assert.equal(fcmConfigured({ FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e', FCM_PRIVATE_KEY: 'k' }), true);
  assert.equal(fcmConfigured({ FCM_PROJECT_ID: 'p', FCM_CLIENT_EMAIL: 'e' }), false);
  assert.equal(fcmConfigured({}), false);
});

test('플랫폼마다 토큰 형식이 다르다', () => {
  // APNs는 16진수, FCM은 콜론·하이픈·대소문자가 섞인다. 하나로 묶으면 한쪽이 막힌다.
  const apns = 'a'.repeat(64);
  const fcm = 'cXyZ_ab:APA91bH' + 'x'.repeat(120);

  assert.ok(sanitizeNativeDevice({ token: apns, platform: 'ios' }));
  assert.ok(sanitizeNativeDevice({ token: fcm, platform: 'android' }));

  // 서로 바꿔 넣으면 안 된다
  assert.equal(sanitizeNativeDevice({ token: fcm, platform: 'ios' }), null);
  assert.equal(sanitizeNativeDevice({ token: 'short', platform: 'android' }), null);
  assert.equal(sanitizeNativeDevice({ token: apns, platform: 'web' }), null);
});

test('등록이 끊긴 토큰만 지운다', () => {
  assert.equal(fcmTokenGone(404, {}), true);
  assert.equal(fcmTokenGone(400, { error: { details: [{ errorCode: 'UNREGISTERED' }] } }), true);
  assert.equal(fcmTokenGone(400, { error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } }), true);

  // 일시 오류·권한 문제에 토큰을 지우면 멀쩡한 기기가 알림을 영영 못 받는다
  assert.equal(fcmTokenGone(500, {}), false);
  assert.equal(fcmTokenGone(503, { error: { status: 'UNAVAILABLE' } }), false);
  assert.equal(fcmTokenGone(401, { error: { status: 'UNAUTHENTICATED' } }), false);
});

// 테스트용 서비스 계정 (실제 키 아님)
async function testEnv() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = Buffer.from(pkcs8).toString('base64').replace(/(.{64})/g, '$1\n');
  return {
    FCM_PROJECT_ID: 'crewswap-test',
    FCM_CLIENT_EMAIL: `svc-${Math.random()}@test.iam.gserviceaccount.com`,
    FCM_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  };
}

test('액세스 토큰은 JWT로 받아오고 캐시한다', async () => {
  const env = await testEnv();
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.match(init.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
    return { ok: true, status: 200, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
  };
  assert.equal(await fcmAccessToken(env, Date.now(), fetchImpl), 'tok-1');
  // 두 번째는 캐시 — 알림마다 왕복하면 급구처럼 여러 명에게 보낼 때 그대로 지연이 된다
  assert.equal(await fcmAccessToken(env, Date.now(), fetchImpl), 'tok-1');
  assert.equal(calls, 1);
});

test('보낼 때 data 값은 전부 문자열로 바꾼다', async () => {
  const env = await testEnv();
  let sent = null;
  const fetchImpl = async (url, init) => {
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  await sendFcmNotification(env, { token: 'x'.repeat(80), platform: 'android' },
    { title: '급구', body: '지금 확인', tag: 'u1', data: { postId: 123, url: './#find' } }, fetchImpl);

  // 객체나 숫자를 그대로 넣으면 FCM이 조용히 거부한다
  assert.deepEqual(sent.message.data, { postId: '123', url: './#find' });
  assert.equal(sent.message.android.priority, 'high');
  assert.equal(sent.message.notification.title, '급구');
});

test('끊긴 토큰은 gone으로 알려 목록에서 지우게 한다', async () => {
  const env = await testEnv();
  const fetchImpl = async (url) => {
    if (url.includes('oauth2')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
  await assert.rejects(
    sendFcmNotification(env, { token: 'x'.repeat(80), platform: 'android' }, { title: 'a', body: 'b' }, fetchImpl),
    error => error.gone === true,
  );
});
