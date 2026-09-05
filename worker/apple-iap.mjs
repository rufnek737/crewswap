export const CREWSWAP_PRO_PRODUCT_ID = 'com.rufnekcrewswap.pro.lifetime';
export const CREWSWAP_BUNDLE_ID = 'com.rufnekcrewswap.app';

// 급구 쿠폰 — 소모형(consumable). 상품 ID가 곧 지급 수량이라 서버가 클라이언트의
// 수량 주장을 믿지 않는다. 상품을 늘릴 때는 이 표에만 한 줄 더하면 된다.
export const CREWSWAP_COUPON_PRODUCTS = Object.freeze({
  'com.rufnekcrewswap.coupon.urgent5': 5,
  'com.rufnekcrewswap.coupon.urgent10': 10,
});

export const CREWSWAP_COUPON_PRODUCT_IDS = Object.freeze(Object.keys(CREWSWAP_COUPON_PRODUCTS));

export function couponsForProduct(productId) {
  return CREWSWAP_COUPON_PRODUCTS[String(productId || '')] || 0;
}

function base64urlBytes(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlText(value) {
  return base64urlBytes(new TextEncoder().encode(value));
}

function decodeBase64urlJson(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(value || '').length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function required(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`${name} 서버 설정이 필요합니다`);
  return value;
}

async function importP8(value) {
  const der = Uint8Array.from(
    atob(value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '')),
    char => char.charCodeAt(0),
  );
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function createAppStoreServerToken(env, now = Date.now()) {
  const keyID = required(env, 'APPLE_IAP_KEY_ID');
  const issuerID = required(env, 'APPLE_IAP_ISSUER_ID');
  const privateKey = required(env, 'APPLE_IAP_PRIVATE_KEY');
  const issuedAt = Math.floor(now / 1000);
  const header = base64urlText(JSON.stringify({ alg: 'ES256', kid: keyID, typ: 'JWT' }));
  const payload = base64urlText(JSON.stringify({
    iss: issuerID,
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
    aud: 'appstoreconnect-v1',
    bid: CREWSWAP_BUNDLE_ID,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await importP8(privateKey);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlBytes(signature)}`;
}

export function decodeAppleTransaction(signedTransactionInfo) {
  const parts = String(signedTransactionInfo || '').split('.');
  if (parts.length !== 3) throw new Error('Apple 거래 서명이 올바르지 않습니다');
  return decodeBase64urlJson(parts[1]);
}

// productIds를 넘기지 않으면 PRO 거래로 본다. 쿠폰 거래를 PRO로, PRO 거래를 쿠폰으로
// 받아들이지 않도록 호출하는 쪽이 기대 상품을 명시한다.
export function validateCrewSwapTransaction(payload, requestedTransactionID = '', productIds = [CREWSWAP_PRO_PRODUCT_ID]) {
  if (!payload || String(payload.bundleId || '') !== CREWSWAP_BUNDLE_ID) {
    return { ok: false, code: 'BUNDLE_MISMATCH' };
  }
  if (!productIds.includes(String(payload.productId || ''))) {
    return { ok: false, code: 'PRODUCT_MISMATCH' };
  }
  if (requestedTransactionID && String(payload.transactionId || '') !== String(requestedTransactionID)) {
    return { ok: false, code: 'TRANSACTION_MISMATCH' };
  }
  if (!payload.transactionId || !payload.originalTransactionId) {
    return { ok: false, code: 'TRANSACTION_INCOMPLETE' };
  }
  if (payload.revocationDate || payload.revocationReason !== undefined) {
    return { ok: false, code: 'PURCHASE_REVOKED', revoked: true };
  }
  return { ok: true };
}

export async function fetchAppleTransaction(env, transactionID, fetchImpl = fetch, productIds = [CREWSWAP_PRO_PRODUCT_ID]) {
  const id = String(transactionID || '').trim();
  if (!/^\d{5,30}$/.test(id)) throw new Error('유효한 App Store 거래 번호가 필요합니다');
  const token = await createAppStoreServerToken(env);
  const bases = [
    ['production', 'https://api.storekit.apple.com'],
    ['sandbox', 'https://api.storekit-sandbox.apple.com'],
  ];
  let lastError = null;
  for (const [environment, base] of bases) {
    const response = await fetchImpl(`${base}/inApps/v1/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (response.status === 404) {
      lastError = new Error(`${environment}에서 거래를 찾지 못했습니다`);
      continue;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Apple 거래 확인 실패 (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
    }
    const data = await response.json();
    const payload = decodeAppleTransaction(data.signedTransactionInfo);
    const validation = validateCrewSwapTransaction(payload, id, productIds);
    return { ...validation, environment, payload, signedTransactionInfo: data.signedTransactionInfo };
  }
  throw lastError || new Error('Apple 거래를 찾지 못했습니다');
}
