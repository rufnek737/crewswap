/* 안드로이드 푸시(FCM v1).
 *
 * APNs는 인증키로 만든 JWT를 그대로 요청에 싣지만, FCM은 한 단계를 더 거친다.
 * 서비스 계정으로 JWT를 만들어 구글에서 액세스 토큰을 받고, 그 토큰으로 보낸다.
 * 토큰은 1시간짜리라 매번 받지 않고 캐시한다 — 알림 한 건마다 왕복을 두 번 하면
 * 급구처럼 수십 명에게 한꺼번에 보낼 때 그대로 지연이 된다.
 */
const encoder = new TextEncoder();
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

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
    .replace(/\\n/g, '\n')                       // 시크릿에 한 줄로 넣은 경우
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('FCM_PRIVATE_KEY 서버 설정이 필요합니다');
  return Uint8Array.from(atob(body), char => char.charCodeAt(0));
}

export function fcmConfigured(env) {
  return !!(env?.FCM_PROJECT_ID && env?.FCM_CLIENT_EMAIL && env?.FCM_PRIVATE_KEY);
}

let _cachedToken = null;   // { value, expiresAt, email }

export async function fcmAccessToken(env, now = Date.now(), fetchImpl = fetch) {
  const email = String(env.FCM_CLIENT_EMAIL).trim();
  if (_cachedToken && _cachedToken.email === email && _cachedToken.expiresAt > now + 60_000) {
    return _cachedToken.value;
  }
  const issuedAt = Math.floor(now / 1000);
  const claims = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const signingInput = `${base64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${base64UrlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8', pemToBytes(env.FCM_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  const assertion = `${signingInput}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`FCM 액세스 토큰 발급 실패 (${response.status})`);
  }
  _cachedToken = {
    value: data.access_token,
    email,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return _cachedToken.value;
}

/* 등록이 끊긴 토큰은 지워야 목록이 계속 불어나지 않는다. FCM은 이 둘로 알려준다.
   그 밖의 실패(일시 오류·권한 문제)에 토큰을 지우면 멀쩡한 기기가 알림을 잃는다. */
export function fcmTokenGone(status, body) {
  if (status === 404) return true;
  const code = body?.error?.details?.find?.(d => d?.errorCode)?.errorCode || body?.error?.status;
  return code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT';
}

export async function sendFcmNotification(env, device, payload, fetchImpl = fetch) {
  const token = await fcmAccessToken(env, Date.now(), fetchImpl);
  const message = {
    token: device.token,
    notification: { title: payload.title, body: payload.body },
    // data 값은 문자열만 허용된다. 객체를 그대로 넣으면 조용히 거부된다.
    data: Object.fromEntries(
      Object.entries(payload.data || {}).map(([k, v]) => [k, String(v ?? '')]),
    ),
    android: {
      priority: 'high',
      notification: { tag: payload.tag || 'crewswap', default_sound: true },
    },
  };
  const response = await fetchImpl(
    `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
  if (response.ok) return { ok: true };
  const body = await response.json().catch(() => ({}));
  const gone = fcmTokenGone(response.status, body);
  const error = new Error(body?.error?.message || `FCM 전송 실패 (${response.status})`);
  error.status = response.status;
  error.gone = gone;
  throw error;
}
