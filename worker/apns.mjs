const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlJson(value) {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function pemToBytes(pem) {
  const body = String(pem || '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('APNS_PRIVATE_KEY 서버 설정이 필요합니다');
  const binary = atob(body);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function apnsConfigured(env) {
  return !!(env?.APNS_KEY_ID && env?.APNS_TEAM_ID && env?.APNS_PRIVATE_KEY && env?.APNS_TOPIC);
}

export function sanitizeNativeDevice(value) {
  const token = String(value?.token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32,512}$/.test(token)) return null;
  const platform = String(value?.platform || '').toLowerCase();
  if (platform !== 'ios') return null;
  const environment = ['production', 'sandbox', 'auto'].includes(value?.environment)
    ? value.environment
    : 'auto';
  return {
    token,
    platform,
    environment,
    bundleId: String(value?.bundleId || '').trim().slice(0, 160),
    updatedAt: new Date().toISOString(),
  };
}

export async function createApnsProviderToken(env, now = Date.now()) {
  const header = base64UrlJson({ alg: 'ES256', kid: String(env.APNS_KEY_ID).trim() });
  const payload = base64UrlJson({ iss: String(env.APNS_TEAM_ID).trim(), iat: Math.floor(now / 1000) });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(env.APNS_PRIVATE_KEY),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function apnsHosts(environment) {
  if (environment === 'sandbox') return ['api.sandbox.push.apple.com'];
  if (environment === 'production') return ['api.push.apple.com'];
  return ['api.push.apple.com', 'api.sandbox.push.apple.com'];
}

export async function sendApnsNotification(env, device, message, fetchImpl = fetch) {
  if (!apnsConfigured(env)) return { ok: false, skipped: true, reason: 'not_configured' };
  const cleanDevice = sanitizeNativeDevice(device);
  if (!cleanDevice) return { ok: false, permanent: true, reason: 'invalid_device' };

  const providerToken = await createApnsProviderToken(env);
  const topic = cleanDevice.bundleId || String(env.APNS_TOPIC).trim();
  const payload = {
    aps: {
      alert: { title: String(message?.title || 'CrewSwap'), body: String(message?.body || '') },
      sound: 'default',
      'thread-id': 'premium-swap-alerts',
    },
    route: String(message?.route || 'find'),
    postId: String(message?.postId || ''),
  };

  let lastResult = null;
  for (const host of apnsHosts(cleanDevice.environment)) {
    const response = await fetchImpl(`https://${host}/3/device/${cleanDevice.token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${providerToken}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, environment: host.includes('sandbox') ? 'sandbox' : 'production' };

    const reason = responseBody?.reason || `HTTP_${response.status}`;
    lastResult = { ok: false, status: response.status, reason };
    // 자동 판별은 production 토큰 불일치일 때만 sandbox로 한 번 더 확인한다.
    if (cleanDevice.environment !== 'auto' || reason !== 'BadDeviceToken') break;
  }

  const permanentReasons = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered', 'TopicDisallowed']);
  return { ...lastResult, permanent: permanentReasons.has(lastResult?.reason) };
}
