import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  apnsConfigured,
  createApnsProviderToken,
  sanitizeNativeDevice,
  sendApnsNotification,
} from '../worker/apns.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

async function testEnv() {
  const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', key.privateKey));
  const pem = Buffer.from(pkcs8).toString('base64').match(/.{1,64}/g).join('\n');
  return {
    APNS_KEY_ID: 'ABCDEFGHIJ',
    APNS_TEAM_ID: 'KLMNOPQRST',
    APNS_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`,
    APNS_TOPIC: 'com.rufnekcrewswap.app',
  };
}

test('iOS device tokens must be hexadecimal APNs tokens', () => {
  const token = 'a'.repeat(64);
  const device = sanitizeNativeDevice({ token: token.toUpperCase(), platform: 'ios' });
  assert.equal(device.token, token);
  assert.equal(device.platform, 'ios');
  assert.equal(device.environment, 'auto');
  assert.equal(device.bundleId, '');
  assert.ok(Number.isFinite(Date.parse(device.updatedAt)));
  assert.equal(sanitizeNativeDevice({ token: 'not-a-token', platform: 'ios' }), null);
  // 안드로이드(FCM)는 형식이 달라 별도로 받는다 — tests/fcm.test.mjs 참조
  assert.equal(sanitizeNativeDevice({ token, platform: 'web' }), null);
});

test('APNs provider JWT contains ES256 key and team claims', async () => {
  const env = await testEnv();
  assert.equal(apnsConfigured(env), true);
  const jwt = await createApnsProviderToken(env, 1_700_000_000_000);
  const [header, payload, signature] = jwt.split('.');
  const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString());
  assert.deepEqual(decode(header), { alg: 'ES256', kid: env.APNS_KEY_ID });
  assert.deepEqual(decode(payload), { iss: env.APNS_TEAM_ID, iat: 1_700_000_000 });
  assert.ok(signature.length > 40);
});

test('auto APNs device falls back from production BadDeviceToken to sandbox', async () => {
  const env = await testEnv();
  const calls = [];
  const result = await sendApnsNotification(env, {
    token: 'b'.repeat(64), platform: 'ios', environment: 'auto', bundleId: env.APNS_TOPIC,
  }, {
    title: '새 스왑', body: 'DPS 조건', route: 'find', postId: 'POST-1',
  }, async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return url.includes('sandbox')
      ? new Response(null, { status: 200 })
      : new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 });
  });
  assert.equal(result.ok, true);
  assert.equal(result.environment, 'sandbox');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.route, 'find');
  assert.equal(calls[1].options.headers['apns-topic'], env.APNS_TOPIC);
});
