import webpush from 'web-push';
import {
  matchingSearches,
  sanitizeSavedSearches,
  subscriberCanUsePost,
} from './premium-alerts.mjs';
import { buildAccountDeletionPlan } from './account-delete.mjs';
import { activateProTrial, getProStatus, PRO_SANDBOX_DURATION_MS } from './pro-entitlement.mjs';
import { applyWalletCommand, normalizeWallet, publicWallet } from './credit-wallet.mjs';
import { apnsConfigured, sanitizeNativeDevice, sendApnsNotification } from './apns.mjs';
import {
  CREWSWAP_BUNDLE_ID,
  CREWSWAP_PRO_PRODUCT_ID,
  decodeAppleTransaction,
  fetchAppleTransaction,
  validateCrewSwapTransaction,
} from './apple-iap.mjs';
import '../mogiji-policy.js';
import '../cabin-policy.js';

const mogijiPolicy = globalThis.CrewSwapMogijiPolicy;
const cabinPolicy = globalThis.CrewSwapCabinPolicy;

// CrewSwap API — Cloudflare Workers
// 라우팅: /api/send-verify, /api/check-verify, /api/posts-get,
//          /api/posts-create, /api/posts-delete, /api/crewconnex

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PUBLIC_PATHS = new Set([
  '/api/send-verify', '/api/check-verify', '/api/user-signup', '/api/user-login',
  '/api/user-reset-password', '/api/posts-get', '/api/premium-alert-config',
]);

const POLICY_VERSION = '2026-08-21';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function allowedOrigin(origin) {
  if (!origin) return null;
  if ([
    "https://rufnek737.github.io",
    "https://rufnekcrew.com",
    "capacitor://localhost",
    "https://localhost",
  ].includes(origin)) return origin;
  if (/^http:\/\/localhost(?::\d+)?$/.test(origin)) return origin;
  return null;
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  const origin = allowedOrigin(request.headers.get("Origin"));
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CrewSwap-Store-Environment");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/* ── Web Crypto 헬퍼 (Node.js crypto 대체) ─────────────────── */

async function hmacHex(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toBase64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(str) {
  const padded = str + '='.repeat((4 - str.length % 4) % 4);
  return decodeURIComponent(escape(atob(padded.replace(/-/g, '+').replace(/_/g, '/'))));
}

function requireSecret(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new Error(`${name} 서버 설정이 필요합니다`);
  return value;
}

export async function issueSessionToken(env, email, now = Date.now()) {
  const payload = toBase64url(JSON.stringify({ sub: String(email).trim().toLowerCase(), iat: now, exp: now + SESSION_TTL_MS, v: 1 }));
  const signature = await hmacHex(requireSecret(env, 'AUTH_SECRET'), payload);
  return `${payload}.${signature}`;
}

export async function verifySessionToken(env, token, now = Date.now()) {
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) return null;
  const expected = await hmacHex(requireSecret(env, 'AUTH_SECRET'), payload);
  if (!timingSafeEqual(expected, signature)) return null;
  let data;
  try { data = JSON.parse(fromBase64url(payload)); } catch { return null; }
  if (data?.v !== 1 || !data.sub || !Number.isFinite(data.exp) || data.exp <= now) return null;
  return { email: String(data.sub).trim().toLowerCase(), expiresAt: data.exp };
}

async function authenticateRequest(request, env) {
  const match = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try { return await verifySessionToken(env, match[1]); } catch { return null; }
}

function requestAllowsSandboxPro(request) {
  return request.headers.get('X-CrewSwap-Store-Environment') === 'sandbox';
}

async function rateLimit(env, request, scope, identity, limit, windowSeconds) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await hmacHex(requireSecret(env, 'AUTH_SECRET'), `${scope}:${ip}:${String(identity).toLowerCase()}`);
  const limiter = scope === 'verify' ? env.VERIFY_RATE_LIMITER : env.LOGIN_RATE_LIMITER;
  if (limiter?.limit) {
    const result = await limiter.limit({ key: digest.slice(0, 32) });
    return result.success;
  }

  // 로컬 테스트 및 이전 배포 환경용 폴백. 운영 환경에서는 위의 전용
  // Rate Limiting 바인딩을 사용해 사용자 데이터용 KV 쓰기 한도를 소모하지 않는다.
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rate:${scope}:${digest.slice(0, 24)}:${bucket}`;
  const count = Number(await env.POSTS.get(key) || 0);
  if (count >= limit) return false;
  await env.POSTS.put(key, String(count + 1), { expirationTtl: Math.max(60, windowSeconds + 60) });
  return true;
}

/* ── 이메일 인증 토큰 검증 (send-verify가 발급한 HMAC 토큰) ─────── */
async function verifyEmailToken(env, email, code, token) {
  email = (email || '').trim().toLowerCase();
  code = (code || '').trim().replace(/\s/g, '');
  if (!email || !code || !token) return { ok: false, error: '이메일, 코드, 토큰을 모두 전달해주세요' };
  let parsed;
  try { parsed = JSON.parse(fromBase64url(token)); } catch { return { ok: false, error: '토큰 형식 오류' }; }
  const { t: ts, h: storedHmac } = parsed;
  if (!ts || !storedHmac) return { ok: false, error: '토큰 형식 오류' };
  if (Date.now() - parseInt(ts, 10) > 10 * 60 * 1000)
    return { ok: false, error: '인증 코드가 만료되었습니다. 코드를 다시 발송해 주세요.' };
  const secret = requireSecret(env, 'VERIFY_SECRET');
  const expectedHmac = await hmacHex(secret, `${email}:${code}:${ts}`);
  if (!timingSafeEqual(expectedHmac, storedHmac))
    return { ok: false, error: '인증 코드가 올바르지 않습니다' };
  return { ok: true, email };
}

/* ── 비밀번호 해싱 (PBKDF2-SHA256, 10만 회) ───────────────────── */
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  return { salt: saltHex || bytesToHex(salt), hash: bytesToHex(bits) };
}
async function verifyPassword(password, saltHex, expectedHash) {
  const { hash } = await hashPassword(password, saltHex);
  return timingSafeEqual(hash, expectedHash);
}

/* ── user-signup / user-login / user-update / user-reset-password ──
   계정 기준 = 회사 이메일(고유). 프로필+비번해시를 user:<email>에 저장해
   여러 기기에서 같은 이메일로 로그인하면 동일 프로필로 동기화된다. ── */

const PROFILE_FIELDS = [
  'nickname', 'airline', 'crewType', 'roleType', 'aircraft', 'base',
  'edto', 'cat2', 'cat3', 'gender', 'languages', 'hasBroadcastRating',
  'realName', 'employeeId', 'phone',
];
function pickProfile(src) {
  const p = {};
  PROFILE_FIELDS.forEach(k => { if (src && src[k] !== undefined) p[k] = src[k]; });
  return p;
}

async function runWalletCommand(env, email, command = {}) {
  const key = `wallet:${String(email || '').trim().toLowerCase()}`;
  const stored = await env.POSTS.get(key, { type: 'json' });
  const result = applyWalletCommand(stored, command);
  if (result.ok) await env.POSTS.put(key, JSON.stringify(result.wallet));
  return { ...result, wallet: publicWallet(result.wallet) };
}

async function walletStatus(env, email) {
  return runWalletCommand(env, email, { type: 'status' });
}

async function handleUserSignup(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const { email: rawEmail, code, token, username, password, profile, policyConsent } = body || {};
  const email = (rawEmail || '').trim().toLowerCase();
  if (!email || !username || !password) return json({ error: '이메일·아이디·비밀번호를 모두 입력해주세요' }, 400);
  if (password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다' }, 400);
  if (policyConsent?.privacyVersion !== POLICY_VERSION || policyConsent?.termsVersion !== POLICY_VERSION)
    return json({ error: '개인정보처리방침과 이용약관에 동의해주세요' }, 400);
  const v = await verifyEmailToken(env, email, code, token);
  if (!v.ok) return json({ error: v.error }, 400);
  const existing = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (existing) return json({ error: '이미 가입된 이메일입니다. 로그인해주세요.' }, 409);
  const { salt, hash } = await hashPassword(password);
  const rec = {
    email, username: username.trim(), salt, hash,
    createdAt: new Date().toISOString(),
    profile: { ...pickProfile(profile), nickname: username.trim() },
    policyConsent: {
      privacyVersion: POLICY_VERSION,
      termsVersion: POLICY_VERSION,
      acceptedAt: new Date().toISOString(),
    },
  };
  await env.POSTS.put(`user:${email}`, JSON.stringify(rec));
  const sessionToken = await issueSessionToken(env, email);
  const wallet = await walletStatus(env, email);
  return json({ ok: true, email, username: rec.username, profile: rec.profile, premium: getProStatus(rec), wallet: wallet.wallet, sessionToken, sessionExpiresAt: Date.now() + SESSION_TTL_MS });
}

async function handleUserLogin(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!email || !password) return json({ error: '이메일과 비밀번호를 입력해주세요' }, 400);
  if (!(await rateLimit(env, request, 'login', email, 10, 600)))
    return json({ error: '로그인 시도가 너무 많습니다. 10분 후 다시 시도해주세요.' }, 429);
  const rec = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (!rec) return json({ error: '가입되지 않은 이메일입니다. 회원가입을 진행해주세요.' }, 404);
  const ok = await verifyPassword(password, rec.salt, rec.hash);
  if (!ok) return json({ error: '비밀번호가 올바르지 않습니다.' }, 401);
  const sessionToken = await issueSessionToken(env, email);
  const wallet = await walletStatus(env, email);
  return json({ ok: true, email, username: rec.username, profile: rec.profile, premium: getProStatus(rec), wallet: wallet.wallet, sessionToken, sessionExpiresAt: Date.now() + SESSION_TTL_MS });
}

async function handleUserUpdate(request, env, authEmail) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const email = authEmail;
  const rec = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (!rec) return json({ error: '계정을 찾을 수 없습니다' }, 404);
  rec.profile = { ...rec.profile, ...pickProfile(body.profile) };
  await env.POSTS.put(`user:${email}`, JSON.stringify(rec));
  return json({ ok: true, profile: rec.profile });
}

async function handleCreditsStatus(env, authEmail) {
  const result = await walletStatus(env, authEmail);
  return json({ wallet: result.wallet });
}

async function handleUserResetPassword(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  const { code, token, password } = body;
  if (!email || !password) return json({ error: '이메일과 새 비밀번호를 입력해주세요' }, 400);
  if (password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다' }, 400);
  const v = await verifyEmailToken(env, email, code, token);
  if (!v.ok) return json({ error: v.error }, 400);
  const rec = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (!rec) return json({ error: '가입되지 않은 이메일입니다.' }, 404);
  const { salt, hash } = await hashPassword(password);
  rec.salt = salt; rec.hash = hash;
  await env.POSTS.put(`user:${email}`, JSON.stringify(rec));
  return json({ ok: true });
}

/* ── user-delete ──────────────────────────────────────────────
   비밀번호를 다시 확인한 뒤 계정과 연결된 글·요청·PRO 푸시정보를
   서버에서 함께 삭제한다. 클라이언트의 로컬 데이터 삭제는 성공 응답 후 수행한다. ── */
async function handleUserDelete(request, env, authEmail) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const email = authEmail;
  const password = String(body?.password || '');
  if (!email || !password) return json({ error: '이메일과 비밀번호를 입력해주세요' }, 400);

  const user = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (!user) return json({ error: '계정을 찾을 수 없습니다' }, 404);
  if (!(await verifyPassword(password, user.salt, user.hash)))
    return json({ error: '비밀번호가 올바르지 않습니다' }, 401);

  try {
    const [posts, requests, premiumRecords] = await Promise.all([
      getPostsIndex(env),
      getRequestsIndex(env),
      getPremiumAlertIndex(env),
    ]);
    const plan = buildAccountDeletionPlan(email, posts, requests, premiumRecords);

    await Promise.all([
      ...plan.postsToDelete.map(post => env.POSTS.delete(`post:${post.id}`)),
      ...plan.requestsToDelete.map(req => env.POSTS.delete(`req:${req.id}`)),
      ...plan.requestsToDelete.map(req => env.POSTS.delete(`reqval:${req.id}`)),
    ]);
    await Promise.all([
      savePostsIndex(env, plan.remainingPosts),
      saveRequestsIndex(env, plan.remainingRequests),
      savePremiumAlertIndex(env, plan.remainingPremiumRecords),
    ]);
    await Promise.all([
      env.POSTS.delete(`user:${email}`),
      env.POSTS.delete(`wallet:${email}`),
      ...(user?.proPurchase?.originalTransactionId
        ? [
            env.POSTS.delete(`iap:apple:${user.proPurchase.originalTransactionId}`),
            env.POSTS.delete(`iap:apple:production:${user.proPurchase.originalTransactionId}`),
            env.POSTS.delete(`iap:apple:sandbox:${user.proPurchase.originalTransactionId}`),
          ]
        : []),
    ]);

    return json({
      ok: true,
      deleted: {
        posts: plan.postsToDelete.length,
        requests: plan.requestsToDelete.length,
        premiumAlerts: plan.removedPremiumRecords,
      },
    });
  } catch (error) {
    return json({ error: `탈퇴 처리 중 오류: ${error.message}` }, 500);
  }
}

/* ── send-verify ────────────────────────────────────────────── */

async function handleSendVerify(request, env) {
  let email;
  try { ({ email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = (email || '').trim().toLowerCase();
  if (!email) return json({ error: '이메일을 입력해주세요' }, 400);
  if (!email.endsWith('@jejuair.net'))
    return json({ error: '제주항공 이메일(@jejuair.net)만 가입할 수 있습니다' }, 400);
  if (!(await rateLimit(env, request, 'verify', email, 5, 600)))
    return json({ error: '인증 코드 요청이 너무 많습니다. 10분 후 다시 시도해주세요.' }, 429);

  const EXPIRY = 10 * 60 * 1000;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const ts = Date.now().toString();
  const secret = requireSecret(env, 'VERIFY_SECRET');
  const hmac = await hmacHex(secret, `${email}:${code}:${ts}`);
  const token = toBase64url(JSON.stringify({ t: ts, h: hmac }));

  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    console.error('Email delivery is not configured: RESEND_API_KEY or RESEND_FROM is missing');
    return json({ error: '이메일 발송 설정 오류입니다. 잠시 후 다시 시도해주세요.' }, 503);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: email,
        subject: '[CrewSwap] 이메일 인증 코드',
        html: `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;">
          <div style="background:#2B9FD9;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
            <strong style="font-size:18px;">CrewSwap</strong>
            <span style="opacity:.8;font-size:12px;margin-left:8px;">승무원 스케줄 스왑 매칭</span>
          </div>
          <div style="border:1px solid #dce3ec;border-top:0;padding:28px;border-radius:0 0 10px 10px;background:#fff;">
            <p style="color:#637083;font-size:14px;margin:0 0 20px;">아래 인증 코드를 10분 이내에 입력해 주세요.</p>
            <div style="letter-spacing:8px;font-size:34px;font-weight:800;color:#17202e;
                        padding:18px;background:#f5f7fa;border-radius:8px;text-align:center;">${code}</div>
            <p style="color:#9ba6b7;font-size:12px;margin:18px 0 0;line-height:1.6;">
              본인이 요청하지 않았다면 이 메일을 무시해도 됩니다.<br/>코드는 10분 후 만료됩니다.
            </p>
          </div>
        </div>`,
      }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return json({ error: `이메일 발송 실패 (${res.status}): ${b.message || '알 수 없는 오류'}` }, 502);
    }
  } catch (e) {
    return json({ error: `이메일 발송 중 오류: ${e.message}` }, 502);
  }
  return json({ token, expiresAt: Date.now() + EXPIRY });
}

/* ── check-verify ───────────────────────────────────────────── */

async function handleCheckVerify(request, env) {
  let email, code, token;
  try { ({ email, code, token } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  const v = await verifyEmailToken(env, email, code, token);
  if (!v.ok) return json({ error: v.error }, 400);
  // 이미 가입된 이메일인지도 알려줌 (클라이언트가 가입/로그인 분기)
  const registered = !!(await env.POSTS.get(`user:${v.email}`, { type: 'json' }));
  return json({ verified: true, email: v.email, registered });
}

/* ── 글/요청 인덱스 캐시 ──────────────────────────────────────────
   KV list()는 무료 플랜 하루 1,000회로 한도가 작아 화면 조회마다 쓰면 금방 바닥남.
   대신 전체 목록을 idx:posts / idx:requests 키 하나에 캐싱해두고 get()(하루 100,000회)만 사용.
   인덱스가 없을 때(최초 1회, 또는 키 유실 시)만 list()로 재구성. ── */

async function getPostsIndex(env) {
  let idx = await env.POSTS.get('idx:posts', { type: 'json' });
  if (idx) return idx;
  const { keys } = await env.POSTS.list({ prefix: 'post:' });
  const posts = await Promise.all(keys.map(({ name }) => env.POSTS.get(name, { type: 'json' })));
  idx = posts.filter(Boolean);
  await env.POSTS.put('idx:posts', JSON.stringify(idx));
  return idx;
}
async function savePostsIndex(env, arr) {
  await env.POSTS.put('idx:posts', JSON.stringify(arr));
}

async function getRequestsIndex(env) {
  let idx = await env.POSTS.get('idx:requests', { type: 'json' });
  if (idx) return idx;
  const { keys } = await env.POSTS.list({ prefix: 'req:' });
  const all = await Promise.all(keys.map(({ name }) => env.POSTS.get(name, { type: 'json' })));
  idx = all.filter(Boolean);
  await env.POSTS.put('idx:requests', JSON.stringify(idx));
  return idx;
}
async function saveRequestsIndex(env, arr) {
  await env.POSTS.put('idx:requests', JSON.stringify(arr));
}
async function updateRequestsIndexEntry(env, updated) {
  const idx = await getRequestsIndex(env);
  const i = idx.findIndex(r => r.id === updated.id);
  if (i >= 0) idx[i] = updated; else idx.push(updated);
  await saveRequestsIndex(env, idx);
}

/* ── PRO 저장조건·백그라운드 Web Push ────────────────────────────
   PRO는 1회성 영구 이용권이며, 가입자는 원하는 시점에 계정당 한 번
   30일 무료 이용권을 활성화할 수 있다. ── */

const PREMIUM_ALERT_INDEX_KEY = 'idx:premium-alert-subscribers';

function webPushConfigured(env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

async function isPremiumAccount(env, email, allowSandbox = false) {
  if (String(env.BETA_ALL_PREMIUM || '').toLowerCase() === 'true') return true;
  const user = await env.POSTS.get(`user:${email}`, { type: 'json' });
  return getProStatus(user || {}, Date.now(), { allowSandbox }).active;
}

async function handlePremiumStatus(env, authEmail, allowSandbox = false) {
  const user = await refreshStoredApplePurchase(env, authEmail);
  if (!user) return json({ error: '가입된 계정을 찾을 수 없습니다' }, 404);
  return json({ ok: true, premium: getProStatus(user, Date.now(), { allowSandbox }) });
}

const APPLE_PURCHASE_REFRESH_MS = 6 * 60 * 60 * 1000;

function appleIapConfigured(env) {
  return !!(env.APPLE_IAP_KEY_ID && env.APPLE_IAP_ISSUER_ID && env.APPLE_IAP_PRIVATE_KEY);
}

function applePurchasePublicConfig(env) {
  return {
    productId: CREWSWAP_PRO_PRODUCT_ID,
    bundleId: CREWSWAP_BUNDLE_ID,
    verificationEnabled: appleIapConfigured(env),
  };
}

async function refreshStoredApplePurchase(env, email, force = false) {
  const key = `user:${email}`;
  const user = await env.POSTS.get(key, { type: 'json' });
  if (!user?.proPurchase?.transactionId || user.proLifetimeSource !== 'apple' || !appleIapConfigured(env)) return user;
  const checkedAt = Date.parse(user.proPurchase.lastVerifiedAt || '');
  if (!force && Number.isFinite(checkedAt) && Date.now() - checkedAt < APPLE_PURCHASE_REFRESH_MS) return user;
  try {
    const verified = await fetchAppleTransaction(env, user.proPurchase.transactionId);
    const sandboxPurchase = verified.environment === 'sandbox';
    const next = {
      ...user,
      proLifetime: sandboxPurchase ? user.proLifetime === true : verified.ok,
      proSandboxExpiresAt: sandboxPurchase
        ? (verified.ok ? user.proSandboxExpiresAt || new Date(Date.now() + PRO_SANDBOX_DURATION_MS).toISOString() : null)
        : user.proSandboxExpiresAt || null,
      proPurchase: {
        ...user.proPurchase,
        environment: verified.environment,
        lastVerifiedAt: new Date().toISOString(),
        revokedAt: verified.revoked ? new Date().toISOString() : null,
      },
    };
    await env.POSTS.put(key, JSON.stringify(next));
    return next;
  } catch (error) {
    console.warn('Apple PRO entitlement refresh failed', error?.message || error);
    return user;
  }
}

async function handleProPurchaseConfig(env) {
  return json(applePurchasePublicConfig(env));
}

async function handleProPurchaseVerify(request, env, authEmail) {
  if (!appleIapConfigured(env)) return json({ error: 'App Store 결제 검증 서버 설정이 필요합니다', code: 'APPLE_IAP_NOT_CONFIGURED' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청입니다' }, 400); }
  const transactionId = String(body?.transactionId || '').trim();
  const signedTransaction = String(body?.signedTransaction || '').trim();
  if (!transactionId || !signedTransaction) return json({ error: 'App Store 거래 정보가 필요합니다' }, 400);

  try {
    const clientPayload = decodeAppleTransaction(signedTransaction);
    const clientValidation = validateCrewSwapTransaction(clientPayload, transactionId);
    if (!clientValidation.ok && !clientValidation.revoked) {
      return json({ error: 'CrewSwap PRO 거래 정보가 일치하지 않습니다', code: clientValidation.code }, 400);
    }
  } catch {
    return json({ error: 'App Store 거래 정보 형식이 올바르지 않습니다' }, 400);
  }

  let verified;
  try {
    verified = await fetchAppleTransaction(env, transactionId);
  } catch (error) {
    return json({ error: 'Apple에서 구매 내역을 확인하지 못했습니다', code: 'APPLE_VERIFY_FAILED' }, 502);
  }

  const payload = verified.payload || {};
  const originalTransactionId = String(payload.originalTransactionId || '');
  const bindingKey = `iap:apple:${verified.environment}:${originalTransactionId}`;
  const existingOwner = await env.POSTS.get(bindingKey, { type: 'json' });
  if (existingOwner?.email && existingOwner.email !== authEmail) {
    return json({ error: '이 App Store 구매는 다른 CrewSwap 계정에 연결되어 있습니다', code: 'PURCHASE_ALREADY_LINKED' }, 409);
  }

  const userKey = `user:${authEmail}`;
  const user = await env.POSTS.get(userKey, { type: 'json' });
  if (!user) return json({ error: '가입된 계정을 찾을 수 없습니다' }, 404);
  const now = new Date().toISOString();
  const sandboxPurchase = verified.environment === 'sandbox';
  const next = {
    ...user,
    proLifetime: sandboxPurchase ? user.proLifetime === true : verified.ok,
    proLifetimeSource: sandboxPurchase ? user.proLifetimeSource || null : 'apple',
    proSandboxExpiresAt: sandboxPurchase && verified.ok
      ? new Date(Date.now() + PRO_SANDBOX_DURATION_MS).toISOString()
      : user.proSandboxExpiresAt || null,
    proPurchase: {
      productId: CREWSWAP_PRO_PRODUCT_ID,
      transactionId: String(payload.transactionId || transactionId),
      originalTransactionId,
      environment: verified.environment,
      purchasedAt: payload.purchaseDate ? new Date(Number(payload.purchaseDate)).toISOString() : now,
      lastVerifiedAt: now,
      revokedAt: verified.revoked ? now : null,
    },
  };
  await env.POSTS.put(userKey, JSON.stringify(next));
  await env.POSTS.put(bindingKey, JSON.stringify({ email: authEmail, productId: CREWSWAP_PRO_PRODUCT_ID, linkedAt: existingOwner?.linkedAt || now }));

  if (!verified.ok) {
    return json({ error: '환불되거나 취소된 구매입니다', code: verified.code, premium: getProStatus(next, Date.now(), { allowSandbox: sandboxPurchase }) }, 409);
  }
  return json({
    ok: true,
    premium: getProStatus(next, Date.now(), { allowSandbox: sandboxPurchase }),
    transactionId: next.proPurchase.transactionId,
    environment: verified.environment,
  });
}

async function handlePremiumTrialActivate(env, authEmail) {
  const key = `user:${authEmail}`;
  const user = await env.POSTS.get(key, { type: 'json' });
  if (!user) return json({ error: '가입된 계정을 찾을 수 없습니다' }, 404);
  const activation = activateProTrial(user);
  if (!activation.ok) {
    const error = activation.code === 'PRO_ALREADY_LIFETIME'
      ? '이미 PRO 영구 이용권을 사용 중입니다'
      : 'PRO 30일 무료 이용권은 계정당 한 번만 사용할 수 있습니다';
    return json({ error, code: activation.code, premium: activation.status }, 409);
  }
  await env.POSTS.put(key, JSON.stringify(activation.user));
  return json({ ok: true, premium: activation.status });
}

async function getPremiumAlertIndex(env) {
  const value = await env.POSTS.get(PREMIUM_ALERT_INDEX_KEY, { type: 'json' });
  return Array.isArray(value) ? value : [];
}

async function savePremiumAlertIndex(env, records) {
  await env.POSTS.put(PREMIUM_ALERT_INDEX_KEY, JSON.stringify(records));
}

function sanitizePushSubscription(value) {
  const endpoint = String(value?.endpoint || '').trim();
  const p256dh = String(value?.keys?.p256dh || '').trim();
  const auth = String(value?.keys?.auth || '').trim();
  if (!endpoint.startsWith('https://') || !p256dh || !auth) return null;
  return { endpoint: endpoint.slice(0, 2048), expirationTime: value?.expirationTime || null, keys: { p256dh, auth } };
}

async function handlePremiumAlertConfig(env) {
  return json({
    enabled: webPushConfigured(env) || apnsConfigured(env),
    webPushEnabled: webPushConfigured(env),
    nativePushEnabled: apnsConfigured(env),
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
    betaAllPremium: String(env.BETA_ALL_PREMIUM || '').toLowerCase() === 'true',
  });
}

async function handlePremiumAlertSync(request, env, authEmail, allowSandbox = false) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const email = authEmail;
  if (!email.endsWith('@jejuair.net')) return json({ error: '제주항공 계정이 필요합니다' }, 400);
  const user = await env.POSTS.get(`user:${email}`, { type: 'json' });
  if (!user) return json({ error: '가입된 계정을 찾을 수 없습니다' }, 404);
  if (!(await isPremiumAccount(env, email, allowSandbox))) return json({ error: 'PRO 전용 기능입니다', code: 'PREMIUM_REQUIRED' }, 403);

  const searches = sanitizeSavedSearches(body?.searches);
  const subscription = sanitizePushSubscription(body?.subscription);
  const nativeDevice = sanitizeNativeDevice(body?.nativeDevice);
  const profile = pickProfile(user.profile || {});
  const records = await getPremiumAlertIndex(env);
  const index = records.findIndex(record => record.email === email);
  const previous = index >= 0 ? records[index] : { email, subscriptions: [], nativeDevices: [], notifiedPostIds: [] };
  const subscriptions = Array.isArray(previous.subscriptions) ? previous.subscriptions : [];
  const nativeDevices = Array.isArray(previous.nativeDevices) ? previous.nativeDevices : [];

  if (subscription && !subscriptions.some(item => item.endpoint === subscription.endpoint)) {
    subscriptions.push(subscription);
  }
  if (nativeDevice) {
    const deviceIndex = nativeDevices.findIndex(item => item.token === nativeDevice.token);
    if (deviceIndex >= 0) nativeDevices[deviceIndex] = nativeDevice;
    else nativeDevices.push(nativeDevice);
  }

  const next = {
    ...previous,
    email,
    profile,
    searches,
    subscriptions: subscriptions.slice(-5),
    nativeDevices: nativeDevices.slice(-5),
    notifiedPostIds: Array.isArray(previous.notifiedPostIds) ? previous.notifiedPostIds.slice(-300) : [],
    storeEnvironment: allowSandbox ? 'sandbox' : 'production',
    sandboxProUntil: allowSandbox ? user.proSandboxExpiresAt || null : null,
    updatedAt: new Date().toISOString(),
  };

  if (index >= 0) records[index] = next; else records.push(next);
  await savePremiumAlertIndex(env, records);
  return json({
    ok: true,
    searches: searches.length,
    devices: next.subscriptions.length + next.nativeDevices.length,
    webPushEnabled: webPushConfigured(env),
    nativePushEnabled: apnsConfigured(env),
  });
}

async function handlePremiumAlertTest(env, authEmail, allowSandbox = false) {
  if (!(await isPremiumAccount(env, authEmail, allowSandbox))) {
    return json({ error: 'PRO 전용 기능입니다', code: 'PREMIUM_REQUIRED' }, 403);
  }
  if (!apnsConfigured(env)) return json({ error: 'APNs 서버 설정이 필요합니다' }, 503);

  const records = await getPremiumAlertIndex(env);
  const index = records.findIndex(record => record.email === authEmail);
  if (index < 0 || !(records[index].nativeDevices || []).length) {
    return json({ error: '등록된 iPhone 알림 기기가 없습니다' }, 409);
  }

  const record = records[index];
  const alive = [];
  const failures = [];
  let delivered = 0;
  for (const device of record.nativeDevices || []) {
    try {
      const result = await sendApnsNotification(env, device, {
        title: '🔔 CrewSwap 알림 테스트',
        body: 'iPhone 백그라운드 알림이 정상 연결되었습니다.',
        route: 'find',
        postId: '',
      });
      if (result.ok) {
        alive.push({ ...device, environment: result.environment || device.environment });
        delivered += 1;
      } else {
        failures.push(result.reason || 'APNS_DELIVERY_FAILED');
        if (!result.permanent) alive.push(device);
      }
    } catch (error) {
      failures.push(error?.message || 'APNS_DELIVERY_FAILED');
      alive.push(device);
    }
  }

  record.nativeDevices = alive;
  record.updatedAt = new Date().toISOString();
  records[index] = record;
  await savePremiumAlertIndex(env, records);
  if (!delivered) return json({ error: 'iPhone 테스트 알림 전송에 실패했습니다', failures }, 502);
  return json({ ok: true, delivered });
}

async function notifyPremiumSubscribers(env, post) {
  const canWebPush = webPushConfigured(env);
  const canNativePush = apnsConfigured(env);
  if (!canWebPush && !canNativePush) return;
  const records = await getPremiumAlertIndex(env);
  if (!records.length) return;

  if (canWebPush) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  let changed = false;

  for (const record of records) {
    if (!record?.email || record.email === post.ownerEmail) continue;
    const sandboxRecord = record.storeEnvironment === 'sandbox'
      && Date.parse(record.sandboxProUntil || '') > Date.now();
    if (!(await isPremiumAccount(env, record.email, sandboxRecord))) continue;
    if (!subscriberCanUsePost(record.profile, post)) continue;
    if ((record.notifiedPostIds || []).includes(post.id)) continue;

    const matched = matchingSearches(post, record.searches);
    if (!matched.length) continue;
    const label = matched.map(search => search.label).filter(Boolean).slice(0, 2).join(', ') || '저장한 조건';
    const body = `${label} · ${post.offered?.patternName || post.offered?.summary || post.offered?.type || '새 스왑'}`;
    const payload = JSON.stringify({
      title: '🔔 조건에 맞는 새 스왑',
      body,
      tag: `crewswap-${post.id}`,
      data: { url: './#find', postId: post.id },
    });

    const alive = [];
    let delivered = false;
    for (const subscription of canWebPush ? (record.subscriptions || []) : []) {
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'high', topic: String(post.id).slice(-32) });
        alive.push(subscription);
        delivered = true;
      } catch (error) {
        const status = error?.statusCode || error?.status || 0;
        if (status !== 404 && status !== 410) alive.push(subscription);
      }
    }

    record.subscriptions = alive;
    const aliveNative = [];
    for (const device of canNativePush ? (record.nativeDevices || []) : []) {
      try {
        const result = await sendApnsNotification(env, device, {
          title: '🔔 조건에 맞는 새 스왑',
          body,
          route: 'find',
          postId: post.id,
        });
        if (result.ok) {
          aliveNative.push({ ...device, environment: result.environment || device.environment });
          delivered = true;
        } else if (!result.permanent) {
          aliveNative.push(device);
        }
      } catch {
        aliveNative.push(device);
      }
    }
    record.nativeDevices = aliveNative;
    if (delivered) record.notifiedPostIds = [...(record.notifiedPostIds || []), post.id].slice(-300);
    changed = true;
  }

  if (changed) await savePremiumAlertIndex(env, records);
}

/* ── posts-get ──────────────────────────────────────────────── */

async function handlePostsGet(env) {
  try {
    const idx = await getPostsIndex(env);
    const posts = idx.filter(p => p && p.status === 'active').map(p => {
      const { deleteToken, ownerEmail, ownerValidationRoster, ...pub } = p;
      // 이메일 자체는 비공개, 연락 가능 여부만 노출 (구버전 글 식별용)
      pub.contactable = !!ownerEmail;
      return pub;
    });
    return json({ posts });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-get-mine (같은 계정이면 어느 기기에서든 내가 등록한 글 동기화) ── */

async function handlePostsGetMine(request, env, authEmail) {
  const email = authEmail;
  try {
    const idx = await getPostsIndex(env);
    const mine = idx
      .filter(p => p && p.ownerEmail === email && p.status === 'active')
      .map(({ ownerValidationRoster, ...post }) => post);
    return json({ posts: mine });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-create ───────────────────────────────────────────── */

const POST_FIELDS = [
  'id', 'deleteToken', 'registeredAt',
  'airline', 'crewType', 'ownerRole', 'ownerNick', 'ownerRating', 'ownerBase', 'ownerEmail',
  'offered', 'wanted', 'ownerValidationRoster',
  'deadlineDay', 'deadlineMonth', 'watchers', 'status', 'creditSpent',
];

async function handlePostsCreate(request, env, ctx, authEmail, allowSandbox = false) {
  let post;
  try { post = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!post.id || !post.deleteToken || !post.offered || !post.wanted)
    return json({ error: '필수 필드 누락' }, 400);

  const clean = {};
  POST_FIELDS.forEach(k => { if (post[k] !== undefined) clean[k] = post[k]; });
  clean.ownerEmail = authEmail;
  clean.status = 'active';
  clean.registeredAt = clean.registeredAt || new Date().toISOString();
  // 등록비는 서버의 PRO 권한을 기준으로 확정한다. 무료 체험과 영구 PRO 모두 무제한이다.
  const unlimited = await isPremiumAccount(env, authEmail, allowSandbox);
  clean.creditSpent = unlimited ? 0 : 1;

  let debited = false;
  try {
    const existing = await env.POSTS.get(`post:${clean.id}`, { type: 'json' });
    if (existing) {
      if (existing.ownerEmail !== authEmail) return json({ error: '이미 사용된 글 ID입니다' }, 409);
      const current = await walletStatus(env, authEmail);
      return json({ id: existing.id, creditSpent: existing.creditSpent || 0, wallet: current.wallet, duplicate: true });
    }
    const debit = await runWalletCommand(env, authEmail, {
      type: 'spend', operationId: `post:create:${clean.id}`, amount: 1, unlimited,
    });
    if (!debit.ok) return json({ error: '크레딧이 부족합니다', code: debit.code, wallet: debit.wallet }, 402);
    debited = clean.creditSpent > 0;
    await env.POSTS.put(`post:${clean.id}`, JSON.stringify(clean));
    const idx = await getPostsIndex(env);
    idx.push(clean);
    await savePostsIndex(env, idx);
    if (ctx?.waitUntil) ctx.waitUntil(notifyPremiumSubscribers(env, clean));
    return json({ id: clean.id, creditSpent: clean.creditSpent, wallet: debit.wallet });
  } catch (e) {
    if (debited) await runWalletCommand(env, authEmail, {
      type: 'reverse', operationId: `post:create-reverse:${clean.id}`, amount: clean.creditSpent,
    }).catch(() => {});
    return json({ error: e.message }, 500);
  }
}

/* ── posts-update (희망 조건만 수정, 오퍼/크레딧 변경 없음) ──── */

async function handlePostsUpdate(request, env, authEmail) {
  let id, deleteToken, wanted;
  try { ({ id, deleteToken, wanted } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!id || !deleteToken || !wanted) return json({ error: '필수 필드 누락' }, 400);

  try {
    const post = await env.POSTS.get(`post:${id}`, { type: 'json' });
    if (!post) return json({ error: '글을 찾을 수 없음' }, 404);
    if (post.ownerEmail !== authEmail || post.deleteToken !== deleteToken) return json({ error: '권한 없음' }, 403);
    post.wanted = wanted;
    await env.POSTS.put(`post:${id}`, JSON.stringify(post));
    const idx = await getPostsIndex(env);
    const i = idx.findIndex(p => p.id === id);
    if (i >= 0) idx[i] = post; else idx.push(post);
    await savePostsIndex(env, idx);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-create (요청하기 / 양도 의향 묻기 — 서버 경유 전달) ── */

function randId() {
  return Math.random().toString(36).slice(2, 10);
}

// 메시지에 연락처/신상정보 포함 시 차단 (크레딧 우회 직거래 방지) — 실제 보안 경계는 서버
const PERSONAL_INFO_RE = /(01[0-9][-.\s]?\d{3,4}[-.\s]?\d{4})|(\d{6}[-.\s]?[1-4]\d{6})|(카카오\s?(아이디|id|톡)?\s?[:：]?\s?[a-zA-Z0-9_.]{2,})|(010|011|016|017|018|019)\s*[-.\s]?\s*\d/;

function normalizedLockedDays(value) {
  return new Set((Array.isArray(value) ? value : [])
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 31));
}

function publicOpenRoster(openRoster, lockedDays) {
  const hidden = normalizedLockedDays(lockedDays);
  return (Array.isArray(openRoster) ? openRoster : [])
    .filter(entry => !hidden.has(Number(entry?.day)));
}

function requestWithPrivateDaysRemoved(record) {
  if (!record || !Array.isArray(record.openRoster)) return record;
  return { ...record, openRoster: publicOpenRoster(record.openRoster, record.lockedDays) };
}

async function handleRequestsCreate(request, env, authEmail, allowSandbox = false) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const {
    requestId, postId, fromNick, fromBase, fromRole,
    fromRealName, fromEmployeeId, fromPhone,
    type, message, offered, openRoster, lockedDays, validationRoster,
  } = body || {};
  if (!postId || !fromNick || !type)
    return json({ error: '필수 필드 누락' }, 400);
  const safeLockedDays = [...normalizedLockedDays(lockedDays)];
  const safeOpenRoster = publicOpenRoster(openRoster, safeLockedDays);
  // 새 모델: offered 대신 openRoster(공개 로스터)를 첨부. 둘 중 하나는 있어야 함.
  if (!offered && !safeOpenRoster.length)
    return json({ error: '공개할 근무가 없습니다' }, 400);
  if (PERSONAL_INFO_RE.test(message || ''))
    return json({ error: '연락처/신상정보는 보낼 수 없습니다 (상호 수락 후 공개)' }, 400);

  let debitSpent = 0;
  let requestKey = '';
  try {
    const post = await env.POSTS.get(`post:${postId}`, { type: 'json' });
    if (!post) return json({ error: '글을 찾을 수 없음' }, 404);
    if (!post.ownerEmail) return json({ error: '상대방 연락 정보가 없는 글입니다 (구버전 글)' }, 400);

    const requestedId = String(requestId || '').trim();
    const id = /^REQ-[A-Za-z0-9-]{8,100}$/.test(requestedId)
      ? requestedId
      : 'REQ-' + Date.now() + '-' + randId();
    requestKey = `req:${id}`;
    const existing = await env.POSTS.get(requestKey, { type: 'json' });
    if (existing) {
      if (existing.fromEmail !== authEmail) return json({ error: '이미 사용된 요청 ID입니다' }, 409);
      const current = await walletStatus(env, authEmail);
      return json({ id, creditSpent: existing.creditSpent || 0, wallet: current.wallet, duplicate: true });
    }
    const unlimited = await isPremiumAccount(env, authEmail, allowSandbox);
    const chargeable = type === 'request';
    const debit = await runWalletCommand(env, authEmail, {
      type: 'spend', operationId: `request:create:${id}`, amount: chargeable ? 1 : 0, unlimited,
    });
    if (!debit.ok) return json({ error: '크레딧이 부족합니다', code: debit.code, wallet: debit.wallet }, 402);
    debitSpent = chargeable && !unlimited ? 1 : 0;
    const rec = {
      id, postId, type,
      postTitle: post.offered?.patternName || '',
      postOwnerRole: post.ownerRole || null,
      aircraft: post.offered?.aircraft || '-',
      quals: [post.offered?.edto ? 'EDTO' : null, post.offered?.cat3 ? 'CAT III' : null].filter(Boolean).join(' / ') || '일반',
      base: post.ownerBase || null,
      message: message || '',
      fromEmail: authEmail, fromNick, fromBase: fromBase || null, fromRole: fromRole || null,
      fromRealName: fromRealName || '', fromEmployeeId: fromEmployeeId || '', fromPhone: fromPhone || '',
      offered: offered || null,             // 상대가 날짜를 고르면 확정됨 (구버전은 즉시 값 있음)
      openRoster: Array.isArray(openRoster) ? safeOpenRoster : null, // 비공개 날짜를 서버에서도 강제 제거
      lockedDays: safeLockedDays,
      toEmail: post.ownerEmail, toNick: post.ownerNick || null,
      status: offered ? (type === 'ask' ? '의향 문의' : '요청 대기') : '상대가 바꿀 날 고르는 중',
      stage: 1,
      creditSpent: debitSpent,
      createdAt: new Date().toISOString(),
    };
    await env.POSTS.put(requestKey, JSON.stringify(rec));
    if (Array.isArray(validationRoster) && validationRoster.length) {
      await env.POSTS.put(`reqval:${id}`, JSON.stringify(validationRoster));
    }
    const idx = await getRequestsIndex(env);
    idx.push(rec);
    await saveRequestsIndex(env, idx);
    return json({ id, creditSpent: debitSpent, wallet: debit.wallet });
  } catch (e) {
    if (debitSpent && requestKey) await runWalletCommand(env, authEmail, {
      type: 'reverse', operationId: `request:create-reverse:${requestKey.slice(4)}`, amount: debitSpent,
    }).catch(() => {});
    return json({ error: e.message }, 500);
  }
}

/* ── requests-accept (받은 요청 상호 수락) ───────────────────── */

async function handleRequestsAccept(request, env, authEmail) {
  let id, email, realName, employeeId, phone;
  try { ({ id, email, realName, employeeId, phone } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.toEmail !== email) return json({ error: '수락 권한이 없습니다' }, 403);
    const post = rec.postId ? await env.POSTS.get(`post:${rec.postId}`, { type: 'json' }) : null;
    const requesterValidationRoster = await env.POSTS.get(`reqval:${id}`, { type: 'json' });
    const cabinViolation = validateCabinExchange(rec, post, rec.offered, requesterValidationRoster);
    if (cabinViolation) return cabinRestViolationResponse(cabinViolation);
    const mogijiViolation = validateMogijiExchange(rec, post, rec.offered, requesterValidationRoster);
    if (mogijiViolation) return mogijiViolationResponse(mogijiViolation);
    rec.stage = 3;
    rec.status = '상호 수락 — 회사 상신 필요';
    rec.acceptedAt = new Date().toISOString();
    // 수락자(받은 사람) 연락처 저장
    rec.toRealName = realName || '';
    rec.toEmployeeId = employeeId || '';
    rec.toPhone = phone || '';
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    await env.POSTS.delete(`reqval:${id}`);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-poster-select (글작성자가 상대 공개 로스터에서 바꿀 날을 골라 승인 요청) ── */

function scheduleEntriesFromPost(post) {
  const offered = post?.offered;
  if (!offered) return [];
  if (Array.isArray(offered.daySchedules) && offered.daySchedules.length) return offered.daySchedules;
  const month = String(offered.startDate || post.deadlineMonth || '').slice(0, 7);
  const firstDay = Math.min(...(offered.days || []));
  return (offered.days || []).map(day => ({
    month,
    day,
    type: day === firstDay && offered.reportTime ? (offered.type || '근무') : 'OFF',
    title: day === firstDay ? offered.patternName : 'OFF',
  }));
}

function markerEntries(markers) {
  return (Array.isArray(markers) ? markers : []).map(marker => {
    const [year, month, day] = String(marker.dayKey || '').split('-');
    return {
      month: year && month ? `${year}-${month}` : null,
      day: Number(day),
      type: 'OFF',
      mogijiRest: marker,
    };
  }).filter(entry => entry.month && entry.day);
}

function validateMogijiExchange(rec, post, selectedOffered, requesterValidationRoster) {
  if (!mogijiPolicy || post?.crewType === 'CABIN') return null;
  const selectedDays = new Set(selectedOffered?.days || []);
  const requesterRoster = requesterValidationRoster || rec.openRoster || [];
  const requesterGives = requesterRoster.filter(entry => selectedDays.has(entry.day));
  const requesterViolation = mogijiPolicy.findProtectedRestViolation(
    requesterRoster,
    scheduleEntriesFromPost(post),
  );
  if (requesterViolation) return { side: '상대 일정', issue: requesterViolation };

  const posterProtectedRoster = markerEntries(post?.offered?.mogijiProtectedDays);
  const posterViolation = mogijiPolicy.findProtectedRestViolation(
    posterProtectedRoster,
    requesterGives,
  );
  return posterViolation ? { side: '내 일정', issue: posterViolation } : null;
}

function validateCabinExchange(rec, post, selectedOffered, requesterValidationRoster) {
  if (!cabinPolicy || post?.crewType !== 'CABIN') return null;
  const selectedDays = new Set(selectedOffered?.days || []);
  const requesterGives = (requesterValidationRoster || rec.openRoster || []).filter(entry => selectedDays.has(entry.day));
  const posterGives = scheduleEntriesFromPost(post);
  const requesterViolation = cabinPolicy.findRestViolation(
    requesterValidationRoster || rec.openRoster || [],
    requesterGives,
    posterGives,
  );
  if (requesterViolation) return { side: '상대 일정', issue: requesterViolation };

  const posterViolation = cabinPolicy.findRestViolation(
    post.ownerValidationRoster || [],
    posterGives,
    requesterGives,
  );
  return posterViolation ? { side: '내 일정', issue: posterViolation } : null;
}

function mogijiViolationResponse(violation) {
  const [, restMonth, restDay] = violation.issue.dayKey.split('-').map(Number);
  const [, arrivalMonth, arrivalDay] = violation.issue.arrivalDate.split('-').map(Number);
  return json({
    error: `${violation.side}에서 ${restMonth}월 ${restDay}일은 ${arrivalMonth}월 ${arrivalDay}일 모기지 도착 후 필요한 휴식일입니다.`,
    code: 'MOGIJI_REST_VIOLATION',
  }, 409);
}

function cabinRestViolationResponse(violation) {
  const issue = violation.issue;
  return json({
    error: `${violation.side}의 객실 휴식시간이 ${Math.max(0, issue.gapMinutes)}분으로, ${issue.routeKey} 기준 최소 ${issue.requiredMinutes}분보다 부족합니다.`,
    code: 'CABIN_REST_VIOLATION',
  }, 409);
}

async function handleRequestsPosterSelect(request, env, authEmail) {
  let id, email, offered, realName, employeeId, phone;
  try { ({ id, email, offered, realName, employeeId, phone } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  if (!offered || !Array.isArray(offered.days) || !offered.days.length) return json({ error: '바꿀 날을 선택해주세요' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.toEmail !== email) return json({ error: '선택 권한이 없습니다 (글 작성자만)' }, 403);
    if ((rec.stage || 1) >= 3) return json({ error: '이미 상호 수락된 요청입니다' }, 409);
    // 공개 로스터에 없는 날을 고르는 부정 방지
    const visibleRoster = publicOpenRoster(rec.openRoster, rec.lockedDays);
    const openDays = new Set(visibleRoster.map(r => r.day));
    if (rec.openRoster && !offered.days.every(d => openDays.has(d)))
      return json({ error: '공개된 근무가 아닙니다' }, 400);
    const post = rec.postId ? await env.POSTS.get(`post:${rec.postId}`, { type: 'json' }) : null;
    const requesterValidationRoster = await env.POSTS.get(`reqval:${id}`, { type: 'json' });
    const cabinViolation = validateCabinExchange(rec, post, offered, requesterValidationRoster);
    if (cabinViolation) return cabinRestViolationResponse(cabinViolation);
    const mogijiViolation = validateMogijiExchange(rec, post, offered, requesterValidationRoster);
    if (mogijiViolation) return mogijiViolationResponse(mogijiViolation);
    rec.offered = offered;                  // 글작성자가 제안한 '요청자가 줄 근무'
    rec.stage = 2;
    rec.status = '요청자 최종 승인 대기';
    rec.posterSelectedAt = new Date().toISOString();
    rec.posterSelected = true;
    // 글작성자(받는 사람=상신 주체) 연락처 저장
    rec.toRealName = realName || '';
    rec.toEmployeeId = employeeId || '';
    rec.toPhone = phone || '';
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-requester-accept (요청자가 글작성자의 날짜 선택을 최종 승인) ── */

async function handleRequestsRequesterAccept(request, env, authEmail) {
  let id, email, realName, employeeId, phone;
  try { ({ id, email, realName, employeeId, phone } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.fromEmail !== email) return json({ error: '최종 승인 권한이 없습니다 (요청자만)' }, 403);
    if (!rec.posterSelected || !rec.offered || (rec.stage || 1) !== 2)
      return json({ error: '최종 승인할 일정 선택이 없습니다' }, 409);
    const post = rec.postId ? await env.POSTS.get(`post:${rec.postId}`, { type: 'json' }) : null;
    const requesterValidationRoster = await env.POSTS.get(`reqval:${id}`, { type: 'json' });
    const cabinViolation = validateCabinExchange(rec, post, rec.offered, requesterValidationRoster);
    if (cabinViolation) return cabinRestViolationResponse(cabinViolation);
    const mogijiViolation = validateMogijiExchange(rec, post, rec.offered, requesterValidationRoster);
    if (mogijiViolation) return mogijiViolationResponse(mogijiViolation);
    rec.stage = 3;
    rec.status = '상호 수락 — 회사 상신 필요';
    rec.acceptedAt = new Date().toISOString();
    rec.fromRealName = realName || rec.fromRealName || '';
    rec.fromEmployeeId = employeeId || rec.fromEmployeeId || '';
    rec.fromPhone = phone || rec.fromPhone || '';
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    await env.POSTS.delete(`reqval:${id}`);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-requester-decline (선택 조합만 거절하고 글작성자가 다시 고르게 함) ── */

async function handleRequestsRequesterDecline(request, env, authEmail) {
  let id, email;
  try { ({ id, email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.fromEmail !== email) return json({ error: '거절 권한이 없습니다 (요청자만)' }, 403);
    if (!rec.posterSelected || (rec.stage || 1) !== 2)
      return json({ error: '거절할 일정 선택이 없습니다' }, 409);
    rec.offered = null;
    rec.posterSelected = false;
    rec.stage = 1;
    rec.status = '다른 날짜 선택 요청 — 글작성자가 다시 고르는 중';
    rec.posterSelectionDeclinedAt = new Date().toISOString();
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-ask-accept (받은 의향 문의에 "관심 수락" — 자유 텍스트 답장 없음) ── */

async function handleRequestsAskAccept(request, env, authEmail) {
  let id, email;
  try { ({ id, email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.toEmail !== email) return json({ error: '수락 권한이 없습니다' }, 403);
    if (rec.type !== 'ask') return json({ error: '의향 문의가 아닙니다' }, 400);
    rec.askAccepted = true;
    rec.status = '💬 의향 수락 — 정식 요청을 기다리는 중';
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-decline (받은 요청 거절 — 양해 메세지 상태로 저장) ─────── */

async function handleRequestsDecline(request, env, authEmail) {
  let id, email, reason;
  try { ({ id, email, reason } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ ok: true, alreadyGone: true });
    if (rec.toEmail !== email) return json({ error: '거절 권한이 없습니다' }, 403);
    if (reason === 'MOGIJI_REST_CONFLICT') {
      const post = rec.postId ? await env.POSTS.get(`post:${rec.postId}`, { type: 'json' }) : null;
      const violation = validateMogijiExchange(rec, post, { days: [] });
      if (!violation || violation.side !== '상대 일정')
        return json({ error: '모기지 휴무 규정 충돌을 확인할 수 없습니다' }, 409);
      const issue = violation.issue;
      const [, arrivalMonth, arrivalDay] = issue.arrivalDate.split('-').map(Number);
      const [, restMonth, restDay] = issue.dayKey.split('-').map(Number);
      const incomingMonth = Number(String(issue.incoming?.month || issue.dayKey).split('-')[1]);
      const incomingDay = Number(issue.incoming?.day || restDay);
      const incomingDuty = issue.incoming?.title || issue.incoming?.type || '근무';
      rec.status = '⚠️ 모기지 휴무 규정 불일치';
      rec.declineReason = 'MOGIJI_REST_CONFLICT';
      rec.declineMsg = `요청하신 스왑은 ${arrivalMonth}월 ${arrivalDay}일 모기지 도착 후 ${restMonth}월 ${restDay}일 필수 휴무와, 교환받을 ${incomingMonth}월 ${incomingDay}일 ${incomingDuty} 근무가 겹쳐 진행할 수 없습니다. 개인적인 사유가 아닌 휴식 규정 자동 판정에 따른 거절입니다.`;
    } else {
      rec.status = '💔 거절됨';
      rec.declineReason = 'PERSONAL';
      rec.declineMsg = '관심(요청) 감사합니다. 하지만 개인적 사정으로 거절함을 양해 부탁드립니다.';
    }
    rec.declined = true;
    rec.declinedAt = new Date().toISOString();
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    await env.POSTS.delete(`reqval:${id}`);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-submit-nudge (요청자 → 글작성자에게 "회사 상신 독촉") ── */

async function handleRequestsSubmitNudge(request, env, authEmail) {
  let id, email;
  try { ({ id, email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.fromEmail !== email) return json({ error: '확인 메세지 권한이 없습니다' }, 403); // 요청 보낸 사람만
    if ((rec.stage || 1) < 3) return json({ error: '상호 수락 후에만 확인 메세지를 보낼 수 있습니다' }, 400);
    if (rec.submitted) return json({ error: '이미 상신 완료된 건입니다' }, 400);
    rec.submitNudgedAt = new Date().toISOString();
    rec.submitNudgeCount = (rec.submitNudgeCount || 0) + 1;
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-submit-done (글작성자가 "회사 상신 완료" 표시) ───────── */

async function handleRequestsSubmitDone(request, env, authEmail) {
  let id, email;
  try { ({ id, email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.toEmail !== email) return json({ error: '상신 완료 권한이 없습니다 (글 작성자만)' }, 403);
    if ((rec.stage || 1) < 3) return json({ error: '상호 수락 후에만 상신할 수 있습니다' }, 400);
    rec.submitted = true;
    rec.submittedAt = new Date().toISOString();
    rec.status = '✅ 회사 상신 완료';
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    await updateRequestsIndexEntry(env, rec);
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-delete (보낸/받은 요청·의향 삭제) ──────────────────── */

async function handleRequestsDelete(request, env, authEmail) {
  let id, email;
  try { ({ id, email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = authEmail;
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ ok: true, alreadyGone: true });
    if (rec.fromEmail !== email && rec.toEmail !== email)
      return json({ error: '삭제 권한이 없습니다' }, 403);
    await Promise.all([
      env.POSTS.delete(`req:${id}`),
      env.POSTS.delete(`reqval:${id}`),
    ]);
    const idx = await getRequestsIndex(env);
    await saveRequestsIndex(env, idx.filter(r => r.id !== id));
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-get (보낸/받은 요청 조회) ───────────────────────── */

async function handleRequestsGet(request, env, authEmail) {
  const email = authEmail;

  try {
    const idx = await getRequestsIndex(env);
    // 예전 요청에 공개 목록과 비공개 날짜가 함께 저장됐어도 조회할 때 즉시 가린다.
    const sent = idx.filter(r => r.fromEmail === email).map(requestWithPrivateDaysRemoved);
    const received = idx.filter(r => r.toEmail === email).map(requestWithPrivateDaysRemoved);
    return json({ sent, received });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-delete ───────────────────────────────────────────── */

function postDeadlinePassed(post, now = Date.now()) {
  const month = /^\d{4}-\d{2}$/.test(String(post?.deadlineMonth || '')) ? post.deadlineMonth : null;
  const day = Number(post?.deadlineDay);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) return false;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
  return `${month}-${String(day).padStart(2, '0')}` < today;
}

async function handlePostsDelete(request, env, authEmail) {
  let id, deleteToken, reason;
  try { ({ id, deleteToken, reason } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!id || !deleteToken) return json({ error: '필수 필드 누락' }, 400);

  try {
    const post = await env.POSTS.get(`post:${id}`, { type: 'json' });
    if (!post) {
      const current = await walletStatus(env, authEmail);
      return json({ ok: true, alreadyGone: true, wallet: current.wallet, refunded: 0 });
    }
    if (post.ownerEmail !== authEmail || post.deleteToken !== deleteToken) return json({ error: '권한 없음' }, 403);
    if (post.status !== 'active') {
      const current = await walletStatus(env, authEmail);
      return json({ ok: true, alreadyClosed: true, status: post.status, refunded: post.refundGranted || 0, wallet: current.wallet });
    }
    const expired = reason === 'expired' || (!reason && postDeadlinePassed(post));
    const refundRequested = Number(post.creditSpent || 0) * (expired ? 0.5 : 1);
    const refund = await runWalletCommand(env, authEmail, {
      type: 'refund',
      operationId: `post:${expired ? 'expire' : 'cancel'}:${id}`,
      amount: refundRequested,
    });
    post.status = expired ? 'expired' : 'cancelled';
    post.refunded = true;
    post.refundGranted = refund.refunded || 0;
    post.closedAt = new Date().toISOString();
    await env.POSTS.put(`post:${id}`, JSON.stringify(post));
    const idx = await getPostsIndex(env);
    const index = idx.findIndex(item => item.id === id);
    if (index >= 0) idx[index] = post;
    await savePostsIndex(env, idx);
    return json({ ok: true, status: post.status, refunded: refund.refunded || 0, wallet: refund.wallet });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── crewconnex (Netlify 로직 그대로 포팅) ──────────────────── */

const BASE = 'https://crewconnex.jejuair.net';

function stripHtml(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
}
function fmtTime(s) {
  const t = (s || '').trim();
  if (!t) return null;
  const suffix = /\+1/.test(t) ? '+1' : '';
  const clean = t.replace('+1', '').trim();
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}${suffix}`;
  if (/^\d{1,2}:\d{2}/.test(clean)) return `${clean.slice(0, 5)}${suffix}`;
  return null;
}
function blhToMin(s) {
  if (!s) return 0;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
}
function renameF(s) { return s ? s.replace(/^F(\d)/, '7C$1') : s; }
function formatFlight(num) { return /^\d{2,4}$/.test(num) ? `7C${num.padStart(4, '0')}` : num; }
function updateJar(jar, arr) {
  for (const c of arr || []) {
    const [kv] = c.split(';'); const i = kv.indexOf('=');
    if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
}
function jarStr(jar) { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }
function getSetCookies(r) {
  if (typeof r.headers.getSetCookie === 'function') return r.headers.getSetCookie();
  const h = r.headers.get('set-cookie'); return h ? [h] : [];
}
function extractTableRows(tableHtml) {
  const rows = []; const rRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi; let rM;
  while ((rM = rRe.exec(tableHtml)) !== null) {
    const cells = []; const cRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi; let cM;
    while ((cM = cRe.exec(rM[1])) !== null) cells.push(stripHtml(cM[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}
function findRosterTable(html) {
  const tRe = /<table[^>]*>([\s\S]*?)<\/table>/gi; let tM;
  while ((tM = tRe.exec(html)) !== null) {
    const t = tM[0];
    if (/Date/.test(t) && /Pairing/.test(t) && /Activity/.test(t) && /BLH/.test(t)) return t;
  }
  return null;
}
function mapColumns(headerRow) {
  const norm = (s) => s.toLowerCase().replace(/[\s()\/.#]/g, '');
  const headers = headerRow.map(norm);
  const find = (name) => {
    const t = norm(name);
    const exact = headers.findIndex(h => h === t);
    if (exact >= 0) return exact;
    return headers.findIndex(h => t.length >= 3 && h.includes(t));
  };
  const iSTD = find('STDL');
  return {
    iDate: find('Date'), iPair: find('Pairing'), iAct: find('Activity'),
    iFrom: find('From'), iTo: find('To'), iCI: find('CIL'), iCO: find('COL'),
    iSTD: iSTD >= 0 ? iSTD : find('STD'),
    iSTA: find('STAL'), iAC: find('ACHotel'), iBLH: find('BLH'),
    iCC: find('CC'), iPos: find('Pos'),
  };
}
function detectMonth(html) {
  const monthRe = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\b/i;
  const m = monthRe.exec(html); if (!m) return null;
  const monthMap = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
  return { year: 2000 + parseInt(m[2]), month: monthMap[m[1].toUpperCase()] };
}
function detectUserName(html) {
  const m = /([가-힣]{2,4})\s+(?:Mr|Ms)\.?\s+[A-Z]/i.exec(html); return m ? m[1] : null;
}
const DOM_AIRPORTS = new Set(['ICN','GMP','PUS','CJU','TAE','CJJ','RSU','MWX','KPO','USN','WJU','HIN','KUV','KWJ','YEC','KAG']);
const EDTO_AIRPORTS = new Set(['GUM','SPN']);
const HOME_BASES = new Set(['GMP','ICN','PUS','CJU']);
const CAPT_CODES = /^(C|H|L|K|2C|2NC|C1|C2|PC|NC|3PC|3NC)$/i;
const FO_CODES = /^(F|2F|2NF|F1|F2|3F)$/i;
const STBY_CODES = /^S[AB]\d*$/i;
// 휴가/비근무 코드 (CrewConnex 실제 코드): 모두 근무 아님 → 연속근무 계산 제외
//   OV_FE(경조) OV_MAT(배우자출산) OV_MV(주거이전) OV_FLT(비행휴직) OVSICK(공상)
//   OVAC(공무/장기근속) UV_ML(여성보건) VAC(연차) VASICK(연차소진병가) VO(연차/OFF)
//   + 한글 키워드 fallback
const VAC_CODES = /^(OV|UV|VA|VO)([_A-Z0-9]|$)|연차|휴가|경조|병가|공가|공상|휴직|보건|출산|환갑|고희|주거이전/i;

function parseRosterToSchedules(html, userNameHint) {
  const tableHtml = findRosterTable(html);
  if (!tableHtml) return { schedules: [], meta: { error: 'roster_table_not_found' } };
  const allRows = extractTableRows(tableHtml);
  if (allRows.length < 2) return { schedules: [], meta: { error: 'no_data_rows' } };
  const headerIdx = allRows.findIndex(r =>
    r.some(c => /Date/i.test(c)) && r.some(c => /Pairing/i.test(c)) && r.some(c => /Activity/i.test(c))
  );
  if (headerIdx < 0) return { schedules: [], meta: { error: 'header_row_not_found' } };
  const cols = mapColumns(allRows[headerIdx]);
  const dataRows = allRows.slice(headerIdx + 1);
  const userName = userNameHint || detectUserName(html);
  const groups = []; let cur = null;
  dataRows.forEach(row => {
    if (row.length < 5) return;
    const dateText = row[cols.iDate] || '';
    if (/\d{1,2}/.test(dateText)) { cur = { primary: row, legs: [], dateText }; groups.push(cur); }
    else if (cur) cur.legs.push(row);
  });
  const entries = [];
  groups.forEach(g => {
    const p = g.primary; const allRowsG = [p, ...g.legs];
    const dayM = /(\d{1,2})/.exec(p[cols.iDate]); if (!dayM) return;
    const day = parseInt(dayM[1], 10); if (day < 1 || day > 31) return;
    const activity = (p[cols.iAct] || '').trim(); const pairing = (p[cols.iPair] || '').trim();
    let type, title, ground;
    const restrictedType = cabinPolicy?.preserveRestrictedType(activity, pairing);
    const actPair = activity + ' ' + pairing;
    if (restrictedType) {
      type = restrictedType;
      title = restrictedType;
    } else if (/\bSIM\d*\b|\bOPC\b|\bLPC\b|\bLOFT\b|\bSPT\b/i.test(actPair)) {
      // 시뮬레이터 훈련(SIM1 등) — GMP-GMP 형태지만 비행이 아님. SWAP 불가.
      type = 'GND'; ground = 'SIM'; title = 'SIM 훈련';
    } else if (/\bJCRM\b|\bGND\b|GROUND/i.test(actPair)) {
      // 지상수업(JCRM 등) — 비행 아님. SWAP 불가.
      type = 'GND'; ground = '지상'; title = '지상근무';
    } else if (STBY_CODES.test(activity) || STBY_CODES.test(pairing) || /STBY/i.test(activity + ' ' + pairing)) {
      type = 'STBY'; const sc = STBY_CODES.test(activity) ? activity : STBY_CODES.test(pairing) ? pairing : 'STBY'; title = `STBY ${sc}`;
    } else if (/^OFF/i.test(activity) || /^OFF/i.test(pairing)) { type = 'OFF'; title = 'OFF'; }
    else if (VAC_CODES.test(activity) || VAC_CODES.test(pairing)) { type = 'VAC'; title = '휴가'; }
    else if (/RSV/i.test(activity + ' ' + pairing)) { type = 'RSV'; title = 'RSV'; }
    else if (/LAYOV/i.test(activity + ' ' + pairing)) {
      type = 'LAYOV'; const m = /LAYOV\s*\(?([A-Z]{3})/i.exec(activity + ' ' + pairing);
      title = m ? `LAYOV ${m[1]}` : 'LAYOV';
    } else {
      const fr = allRowsG.filter(r => r[cols.iFrom] && r[cols.iTo] && !/^\|$/.test(r[cols.iFrom]));
      if (fr.length) {
        const allDom = fr.every(r => DOM_AIRPORTS.has(r[cols.iFrom]) && DOM_AIRPORTS.has(r[cols.iTo]));
        type = allDom ? '국내선' : '국제선'; title = renameF(pairing) || `${fr[0][cols.iFrom]}-${fr[fr.length - 1][cols.iTo]}`;
      } else { type = 'UNKNOWN'; title = renameF(pairing) || activity || '-'; }
    }
    const ciR = allRowsG.find(r => r[cols.iCI] && !/^\|$/.test(r[cols.iCI]));
    const stdR = allRowsG.find(r => cols.iSTD >= 0 && r[cols.iSTD] && !/^\|$/.test(r[cols.iSTD]));
    const coR = [...allRowsG].reverse().find(r => r[cols.iCO] && !/^\|$/.test(r[cols.iCO]));
    const staR = [...allRowsG].reverse().find(r => r[cols.iSTA] && !/^\|$/.test(r[cols.iSTA]));
    const acR = allRowsG.find(r => r[cols.iAC] && !/^\|$/.test(r[cols.iAC]));
    let aircraft = null;
    if (acR) { const a = acR[cols.iAC]; if (/7M8|MAX/i.test(a)) aircraft = 'MAX'; else if (/73[78]/i.test(a)) aircraft = 'NG'; }
    let blockMin = 0;
    if (cols.iBLH >= 0) allRowsG.forEach(r => { const b = (r[cols.iBLH] || '').trim(); if (b && !/^\|$/.test(b)) blockMin += blhToMin(b); });
    const ccText = (p[cols.iCC] || '').trim(); const posText = (p[cols.iPos] || '').trim();
    const namesRaw = ccText.split(/\n+/).map(s => s.trim()); const positions = posText.split(/\n+/).map(s => s.trim());
    const userIdx = userName ? namesRaw.findIndex(n => n && n.includes(userName)) : -1;
    const userPos = userIdx >= 0 ? (positions[userIdx] || '').trim() : '';
    const others = [];
    for (let i = 0; i < namesRaw.length; i++) {
      if (i === userIdx) continue; const nm = namesRaw[i]; if (!nm || /^\s*\|+\s*$/.test(nm)) continue;
      const ps = (positions[i] || '').replace(/^\s*\|+\s*$/, '').replace(/\s*\([^)]*\)/g, '').trim();
      others.push(`${nm}${ps ? `(${ps})` : ''}`);
    }
    const fr = allRowsG.filter(r => r[cols.iFrom] && r[cols.iTo] && !/^\|$/.test(r[cols.iFrom]));
    const overnightLeg = fr.find(r => /\+1/.test(r[cols.iSTA] || ''));
    let overnightInfo = null;
    if (overnightLeg) {
      const legActNum = (overnightLeg[cols.iAct] || '').trim();
      overnightInfo = { flightTitle: formatFlight(legActNum) || renameF(pairing) || '야간 복귀', from: overnightLeg[cols.iFrom], to: overnightLeg[cols.iTo], arrivalTime: fmtTime(overnightLeg[cols.iSTA] || '') };
    }
    const e = { day, type, title, patternId: null };
    if (type === '국내선' || type === '국제선') {
      if (fr.length) {
        e.dep = fr[0][cols.iFrom]; e.arr = fr[fr.length - 1][cols.iTo];
        if (fr.length > 1) { e.routeSummary = [fr[0][cols.iFrom], ...fr.map(r => r[cols.iTo])].join('→'); e.legs = fr.length; }
        if (type === '국제선' && fr.some(r => EDTO_AIRPORTS.has(r[cols.iTo]) || EDTO_AIRPORTS.has(r[cols.iFrom]))) e.requiresEdto = true;
      }
    } else if (type === 'LAYOV') { const m = /LAYOV\s*\(?([A-Z]{3})/i.exec(activity + ' ' + pairing); if (m) e.layoverAirport = m[1]; }
    else if (type === 'GND') {
      e.ground = ground;
      const frG = allRowsG.filter(r => r[cols.iFrom] && !/^\|$/.test(r[cols.iFrom]));
      if (frG.length) e.station = frG[0][cols.iFrom];
      e.lockReason = (ground === 'SIM' ? 'SIM 훈련' : '지상근무') + ' — 비행 아님, SWAP 불가';
      e.crewComposition = '비행 아님 · 회사 지정 근무';
    }
    if (ciR) e.reportTime = fmtTime(ciR[cols.iCI]);
    if (stdR) e.departureTime = fmtTime(stdR[cols.iSTD]);
    if (staR) e.arrivalTime = fmtTime(staR[cols.iSTA]);
    if (coR) e.releaseTime = fmtTime(coR[cols.iCO]);
    if (aircraft) e.aircraft = aircraft;
    if (others.length) e.crewComposition = others.join(', ');
    if (blockMin > 0) e.blockMinutes = blockMin;
    if (userPos) {
      e.dutyCode = userPos;
      if (CAPT_CODES.test(userPos) || /Capt|PIC/i.test(userPos)) e.captainGrade = 'B';
      if (FO_CODES.test(userPos) || /^FO\b/i.test(userPos)) e.foGrade = 'B';
      if (/^3/i.test(userPos)) e.crewSet = 3; else if (/^2|^[PN]C$/i.test(userPos)) e.crewSet = 2;
    }
    if (pairing) e._pairing = pairing;
    if (overnightInfo) e._overnightArrival = overnightInfo;
    entries.push(e);
  });
  const seen = new Set(); const dedup = [];
  entries.forEach(e => {
    const key = `${e.day}|${e.title}|${e.reportTime || ''}|${e.dep || ''}|${e.arr || ''}|${e.type}`;
    if (!seen.has(key)) { seen.add(key); dedup.push(e); }
  });
  dedup.sort((a, b) => a.day - b.day);
  for (let i = 0; i < dedup.length; i++) {
    const e = dedup[i]; if (e.type === 'UNKNOWN') {
      const prev = dedup.find(x => x.day === e.day - 1);
      const next = dedup.find(x => x.day === e.day + 1);
      if (prev) {
        if (prev._overnightArrival) { const info = prev._overnightArrival; e.type = 'ARRIVAL'; e.title = `← ${info.flightTitle} 도착`; e.arrivalAirport = info.to; e.arrivalTime = info.arrivalTime; e.crewComposition = `${info.flightTitle} ${info.from}→${info.to} 도착일`; }
        else if (prev.arr && next?.dep && prev.arr === next.dep) { e.type = 'LAYOV'; e.title = `LAYOV ${prev.arr}`; e.layoverAirport = prev.arr; e.crewComposition = `${prev.arr} 체류 (자동)`; }
        else if (prev.type === 'LAYOV' && prev.layoverAirport) { e.type = 'LAYOV'; e.title = `LAYOV ${prev.layoverAirport}`; e.layoverAirport = prev.layoverAirport; e.crewComposition = `${prev.layoverAirport} 체류 (자동)`; }
        else if (prev.type === '국제선' && prev.arr && !DOM_AIRPORTS.has(prev.arr)) { e.type = 'LAYOV'; e.title = `LAYOV ${prev.arr}`; e.layoverAirport = prev.arr; e.crewComposition = `${prev.arr} 체류 (자동)`; }
      }
    }
  }
  let pid = 1;
  for (let i = 0; i < dedup.length; i++) {
    const e = dedup[i]; const prev = i > 0 ? dedup[i - 1] : null;
    const adjacent = !!(prev && prev.day === e.day - 1 && prev.month === e.month);
    let joined = false;
    if (adjacent) {
      if (e._pairing && prev._pairing && e._pairing === prev._pairing && !/^OFF/i.test(e._pairing)) joined = true;
      else if (e.type === 'LAYOV' && prev.type === 'LAYOV' && e.layoverAirport && e.layoverAirport === prev.layoverAirport) joined = true;
      else if (e.type === 'LAYOV' && prev.type === '국제선' && e.layoverAirport && e.layoverAirport === prev.arr) joined = true;
      else if (e.type === '국제선' && prev.type === 'LAYOV' && e.dep && e.dep === prev.layoverAirport) joined = true;
      else if (e.type === 'ARRIVAL' && (prev.type === 'LAYOV' || prev.type === '국제선' || prev.type === '국내선')) joined = true;
      else if (e.type === '국제선' && prev.type === '국제선' && e.dep && e.dep === prev.arr && !DOM_AIRPORTS.has(e.dep)) joined = true;
      else if (e.title && e.title === prev.title && e.type === prev.type && e.type !== '국내선' && e.type !== '국제선') joined = true;
      else if ((e.type === '국내선' || e.type === '국제선') && (prev.type === '국내선' || prev.type === '국제선') && prev.arr && e.dep && prev.arr === e.dep && !HOME_BASES.has(prev.arr)) joined = true;
    }
    e.patternId = joined ? prev.patternId : `P${pid++}`;
    delete e._pairing; delete e._inheritFrom; delete e._overnightArrival;
  }
  for (let i = 1; i < dedup.length; i++) {
    const cur = dedup[i], prev = dedup[i - 1];
    if (cur.month !== prev.month) continue;
    if (prev.day !== cur.day - 1) continue;
    const isStandby = (t) => t === 'RSV' || t === 'STBY';
    if (isStandby(cur.type) && isStandby(prev.type)) cur.patternId = prev.patternId;
  }
  const totalBlh = dedup.reduce((s, e) => s + (e.blockMinutes || 0), 0);
  return { schedules: dedup, meta: { userName, count: dedup.length, totalBLH: `${Math.floor(totalBlh / 60)}:${String(totalBlh % 60).padStart(2, '0')}`, stbyCount: dedup.filter(e => e.type === 'STBY').length, arrivalCount: dedup.filter(e => e.type === 'ARRIVAL').length, monthDetected: detectMonth(html) } };
}

function extractAllHiddenInputs(html) {
  const inputs = {}; const inputRe = /<input([^>]*)>/gi; let m;
  while ((m = inputRe.exec(html)) !== null) {
    const attrs = m[1]; if (!/\btype=["']hidden["']/i.test(attrs)) continue;
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i); const valueMatch = attrs.match(/\bvalue=["']([^"']*)["']/i);
    if (nameMatch) inputs[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
  }
  return inputs;
}
function getFormAction(html, defaultUrl) {
  const m = html.match(/<form[^>]+action=["']([^"']*)["']/i);
  if (!m || !m[1]) return defaultUrl;
  try { return new URL(m[1], defaultUrl).href; } catch { return defaultUrl; }
}
function findPeriodDropdown(html) {
  const monthCodeRe = /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}/i;
  const selectRe = /<select([^>]*)>([\s\S]*?)<\/select>/gi; let m; const candidates = [];
  while ((m = selectRe.exec(html)) !== null) {
    const attrs = m[1]; const inner = m[2]; const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch) continue; const name = nameMatch[1]; const options = []; let selectedValue = null;
    const optRe = /<option([^>]*?)>([^<]*)<\/option>/gi; let oM;
    while ((oM = optRe.exec(inner)) !== null) {
      const oAttrs = oM[1]; const label = oM[2].trim(); const valM = oAttrs.match(/value=["']([^"']+)["']/i);
      if (!valM) continue; const isSelected = /\bselected\b/i.test(oAttrs);
      options.push({ value: valM[1], label }); if (isSelected) selectedValue = valM[1];
    }
    const hasMonthCode = options.some(o => monthCodeRe.test(o.value) || monthCodeRe.test(o.label));
    if (hasMonthCode && options.length > 0) candidates.push({ name, options, selectedValue, optionCount: options.length });
  }
  candidates.sort((a, b) => b.optionCount - a.optionCount); return candidates[0] || null;
}
const MONTH_NAME_TO_NUM = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
function parsePeriodCode(code) {
  if (!code) return null;
  let m = /^([A-Z]{3})(\d{2})$/.exec(code);
  if (m) { const mn = MONTH_NAME_TO_NUM[m[1].toUpperCase()]; if (mn) return { year: 2000 + parseInt(m[2]), month: mn }; }
  m = /^(\d{4})-(\d{1,2})/.exec(code);
  if (m) { const mn = parseInt(m[2]); if (mn >= 1 && mn <= 12) return { year: parseInt(m[1]), month: mn }; }
  return null;
}
function extractFromAjaxResponse(text) {
  if (!text || text.length < 10) return text;
  if (!/^\d+\|[a-zA-Z]+\|/.test(text)) return text;
  const out = []; let i = 0;
  while (i < text.length) {
    const pipe1 = text.indexOf('|', i); if (pipe1 < 0) break;
    const len = parseInt(text.slice(i, pipe1), 10); if (isNaN(len)) break;
    const pipe2 = text.indexOf('|', pipe1 + 1); if (pipe2 < 0) break;
    const type = text.slice(pipe1 + 1, pipe2);
    const pipe3 = text.indexOf('|', pipe2 + 1); if (pipe3 < 0) break;
    const content = text.slice(pipe3 + 1, pipe3 + 1 + len);
    if (type === 'updatePanel' || type === 'pageRedirect') out.push(content);
    i = pipe3 + 1 + len + 1;
  }
  return out.length > 0 ? out.join('\n') : text;
}

async function tryFetchRoster(url, jar, referer, userNameHint) {
  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'ko-KR,ko', 'Cookie': jarStr(jar), 'Referer': referer }, redirect: 'follow' });
    updateJar(jar, getSetCookies(r));
    if (!r.ok || r.url.includes('login')) return null;
    const raw = await r.text();
    const html = /^\d+\|[a-zA-Z]+\|/.test(raw) ? extractFromAjaxResponse(raw) : raw;
    const result = parseRosterToSchedules(html, userNameHint);
    if (result.meta && result.meta.monthDetected) {
      const m = result.meta.monthDetected; const monthStr = `${m.year}-${String(m.month).padStart(2,'0')}`;
      result.schedules.forEach(s => { s.month = monthStr; });
    }
    return { ...result, finalUrl: r.url, rawHtml: html, rawResponse: raw };
  } catch (_) { return null; }
}

async function fetchPeriod(postUrl, jar, referer, allHidden, ddlName, periodValue, userName) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const body = new URLSearchParams();
  Object.entries(allHidden).forEach(([k, v]) => body.set(k, v));
  body.set('__EVENTTARGET', ddlName); body.set('__EVENTARGUMENT', ''); body.set('__LASTFOCUS', ''); body.set(ddlName, periodValue);
  const r = await fetch(postUrl, { method: 'POST', headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8', 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': jarStr(jar), 'Referer': referer, 'Origin': BASE }, body: body.toString(), redirect: 'follow' });
  updateJar(jar, getSetCookies(r));
  if (!r.ok) return { error: `HTTP ${r.status}`, status: r.status };
  let html = extractFromAjaxResponse(await r.text());
  let result = parseRosterToSchedules(html, userName);
  if (result.schedules.length === 0) {
    try {
      const urlWithParam = postUrl + (postUrl.includes('?') ? '&' : '?') + `period=${periodValue}`;
      const r2 = await fetch(urlWithParam, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Cookie': jarStr(jar), 'Referer': referer }, redirect: 'follow' });
      updateJar(jar, getSetCookies(r2));
      if (r2.ok) { const html2 = await r2.text(); const result2 = parseRosterToSchedules(html2, userName); if (result2.schedules.length > 0) { html = html2; result = result2; } }
    } catch (_) {}
  }
  if (result.schedules.length === 0) return { error: 'no_schedules_parsed' };
  const parsed = parsePeriodCode(periodValue);
  if (parsed) { const monthStr = `${parsed.year}-${String(parsed.month).padStart(2,'0')}`; result.schedules.forEach(s => { s.month = monthStr; }); }
  return { ...result, html };
}

async function handleCrewConnex(request) {
  const ok = body => json(body);
  const fail = (code, msg) => json({ error: msg }, code);

  let username, password, userName;
  try { ({ username, password, userName } = await request.json()); } catch { return fail(400, '잘못된 요청'); }
  if (!username || !password) return fail(400, '아이디/비밀번호를 입력해 주세요');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const jar = {};
  const H = (extra = {}) => ({ 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8', 'Cookie': jarStr(jar), ...extra });

  try {
    const r0 = await fetch(`${BASE}/`, { headers: H(), redirect: 'follow' });
    updateJar(jar, getSetCookies(r0));
    const loginHtml = await r0.text();
    const actionM = loginHtml.match(/<form[^>]+action=["']([^"']*)["']/i);
    const postUrl = (actionM && actionM[1]) ? new URL(actionM[1], r0.url).href : `${BASE}/default.aspx`;
    const inputs = {}; const iRe = /<input([^>]*)>/gi; let iM;
    while ((iM = iRe.exec(loginHtml)) !== null) {
      const attrs = iM[1]; const nm = (attrs.match(/\bname=["']([^"']+)["']/i) || [])[1];
      const tp = (attrs.match(/\btype=["']([^"']+)["']/i) || ['', 'text'])[1].toLowerCase();
      const val = (attrs.match(/\bvalue=["']([^"']*)["']/i) || ['', ''])[1];
      if (nm) inputs[nm] = { type: tp, value: val };
    }
    const userField = Object.keys(inputs).find(k => { const t = inputs[k].type, kl = k.toLowerCase(); return (t === 'text' || t === 'email') && (kl.includes('user') || kl.includes('id') || kl.includes('emp') || kl.includes('login') || kl.includes('name') || kl.includes('nm') || kl.includes('acc')); }) || Object.keys(inputs).find(k => { const t = inputs[k].type; return (t === 'text' || t === 'email') && !inputs[k].value; }) || 'username';
    const pwField = Object.keys(inputs).find(k => inputs[k].type === 'password') || 'password';
    const postBody = new URLSearchParams();
    postBody.set(userField, username); postBody.set(pwField, password);
    for (const [k, v] of Object.entries(inputs)) { if (v.type === 'hidden') postBody.set(k, v.value); }
    const submitRe = /<input([^>]+)>/gi; let sbM;
    while ((sbM = submitRe.exec(loginHtml)) !== null) {
      const attrs = sbM[1]; const tp = (attrs.match(/\btype=["']([^"']+)["']/i) || ['', ''])[1].toLowerCase();
      const nm = (attrs.match(/\bname=["']([^"']+)["']/i) || [])[1]; const val = (attrs.match(/\bvalue=["']([^"']*)["']/i) || ['', 'Login'])[1];
      if ((tp === 'submit' || tp === 'image') && nm) { postBody.set(nm, val || 'Login'); break; }
    }
    const r1 = await fetch(postUrl, { method: 'POST', headers: H({ 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': r0.url, 'Origin': BASE }), body: postBody.toString(), redirect: 'manual' });
    updateJar(jar, getSetCookies(r1));
    if (r1.status === 401 || r1.status === 403) return fail(401, '로그인 실패 — 아이디/비밀번호를 확인해 주세요');
    let mainUrl; const loc1 = r1.headers.get('location') || '';
    if (r1.status >= 300 && r1.status < 400) { mainUrl = new URL(loc1, r0.url).href; }
    else {
      const r1Body = await r1.text();
      if (/invalid|incorrect|실패|오류|틀린|없는|만료|wrong|fail/i.test(r1Body)) return fail(401, '로그인 실패 — 아이디/비밀번호를 확인해 주세요');
      const direct = parseRosterToSchedules(r1Body, userName); if (direct.schedules.length > 0) return ok(direct);
      const jsM = r1Body.match(/(?:location\.href|location\.replace|window\.location)\s*=\s*["']([^"']+)["']/);
      if (jsM) mainUrl = new URL(jsM[1], r0.url).href;
      if (!mainUrl) { const metaM = r1Body.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]*;\s*url=([^\s"']+)/i); if (metaM) mainUrl = new URL(metaM[1], r0.url).href; }
      if (!mainUrl) mainUrl = BASE;
    }
    const r2 = await fetch(mainUrl, { headers: H({ 'Referer': r0.url }), redirect: 'follow' });
    updateJar(jar, getSetCookies(r2)); const mainHtml = await r2.text();
    const mainTitle = (mainHtml.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    if (r2.url.includes('login') || /login|로그인/i.test(mainTitle)) return fail(401, '로그인 실패 — 아이디/비밀번호를 확인해 주세요');
    const directPaths = ['/roster.aspx', '/roster.do', '/crew/roster', '/main/roster'];
    let firstFetch = null; let rosterUrl = null;
    for (const path of directPaths) { const url = BASE + path; const fetched = await tryFetchRoster(url, jar, r2.url, userName); if (fetched) { firstFetch = fetched; rosterUrl = url; break; } }
    if (!firstFetch) {
      const findUrl = (html) => { let m = html.match(/href=["']([^"'#][^"']*(?:roster|checkin|check-in|pairing|schedule)[^"']*)["']/i); return m ? m[1] : null; };
      const rel = findUrl(mainHtml);
      if (rel) { const url = rel.startsWith('http') ? rel : BASE + (rel.startsWith('/') ? rel : '/' + rel); const fetched = await tryFetchRoster(url, jar, r2.url, userName); if (fetched) { firstFetch = fetched; rosterUrl = url; } }
    }
    if (!firstFetch) {
      const mainParsed = parseRosterToSchedules(mainHtml, userName);
      if (mainParsed.schedules.length > 0) { if (mainParsed.meta.monthDetected) { const mm = mainParsed.meta.monthDetected; const ms = `${mm.year}-${String(mm.month).padStart(2,'0')}`; mainParsed.schedules.forEach(s => { s.month = ms; }); } return ok({ schedules: mainParsed.schedules, meta: [mainParsed.meta] }); }
      return fail(404, `로그인은 성공했지만 Roster 페이지를 찾지 못했습니다.\n현재 페이지: ${r2.url}\n제목: ${mainTitle}`);
    }
    const allSchedules = [...firstFetch.schedules]; const allMeta = [firstFetch.meta]; const debugLog = [];
    debugLog.push(`초기 fetch: ${firstFetch.schedules.length}건, URL=${firstFetch.finalUrl}`);
    let allHidden = extractAllHiddenInputs(firstFetch.rawHtml);
    const formAction = getFormAction(firstFetch.rawHtml, firstFetch.finalUrl);
    const ddl = findPeriodDropdown(firstFetch.rawHtml);
    if (ddl && allHidden.__VIEWSTATE) {
      const curParsed = parsePeriodCode(ddl.selectedValue); const curYM = curParsed ? curParsed.year * 12 + curParsed.month : null;
      const otherOptions = ddl.options.filter(o => o.value !== ddl.selectedValue).map(o => ({ ...o, parsed: parsePeriodCode(o.value) })).filter(o => { if (!curYM || !o.parsed) return true; return (o.parsed.year * 12 + o.parsed.month) >= curYM; }).slice(0, 2);
      for (const opt of otherOptions) {
        try {
          const result = await fetchPeriod(formAction, jar, firstFetch.finalUrl, allHidden, ddl.name, opt.value, userName);
          if (!result.error && result.schedules && result.schedules.length > 0) { allSchedules.push(...result.schedules); allMeta.push(result.meta); allHidden = extractAllHiddenInputs(result.html); }
        } catch (_) {}
      }
    }
    const seen2 = new Set(); const finalSchedules = [];
    allSchedules.forEach(s => { const k = `${s.month}|${s.day}|${s.type}|${s.title}`; if (!seen2.has(k)) { seen2.add(k); finalSchedules.push(s); } });
    const months = [...new Set(finalSchedules.map(s => s.month).filter(Boolean))].sort();
    return ok({ schedules: finalSchedules, meta: allMeta, months, debug: debugLog });
  } catch (e) { return fail(500, `서버 오류: ${e.message}`); }
}

/* ── 메인 라우터 ─────────────────────────────────────────────── */

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }
    const path = new URL(request.url).pathname;
    let auth = null;
    if (!PUBLIC_PATHS.has(path)) {
      auth = await authenticateRequest(request, env);
      if (!auth) return withCors(json({ error: '로그인이 만료되었거나 유효하지 않습니다', code: 'AUTH_REQUIRED' }, 401), request);
    }
    const allowSandboxPro = requestAllowsSandboxPro(request);

    let response;
    try {
      if (path === '/api/send-verify') response = await handleSendVerify(request, env);
      else if (path === '/api/check-verify') response = await handleCheckVerify(request, env);
      else if (path === '/api/user-signup') response = await handleUserSignup(request, env);
      else if (path === '/api/user-login') response = await handleUserLogin(request, env);
      else if (path === '/api/user-update') response = await handleUserUpdate(request, env, auth.email);
      else if (path === '/api/credits-status') response = await handleCreditsStatus(env, auth.email);
      else if (path === '/api/user-reset-password') response = await handleUserResetPassword(request, env);
      else if (path === '/api/user-delete') response = await handleUserDelete(request, env, auth.email);
      else if (path === '/api/posts-get') response = await handlePostsGet(env);
      else if (path === '/api/posts-get-mine') response = await handlePostsGetMine(request, env, auth.email);
      else if (path === '/api/posts-create') response = await handlePostsCreate(request, env, ctx, auth.email, allowSandboxPro);
      else if (path === '/api/posts-delete') response = await handlePostsDelete(request, env, auth.email);
      else if (path === '/api/posts-update') response = await handlePostsUpdate(request, env, auth.email);
      else if (path === '/api/requests-create') response = await handleRequestsCreate(request, env, auth.email, allowSandboxPro);
      else if (path === '/api/requests-get') response = await handleRequestsGet(request, env, auth.email);
      else if (path === '/api/requests-accept') response = await handleRequestsAccept(request, env, auth.email);
      else if (path === '/api/requests-poster-select') response = await handleRequestsPosterSelect(request, env, auth.email);
      else if (path === '/api/requests-requester-accept') response = await handleRequestsRequesterAccept(request, env, auth.email);
      else if (path === '/api/requests-requester-decline') response = await handleRequestsRequesterDecline(request, env, auth.email);
      else if (path === '/api/requests-ask-accept') response = await handleRequestsAskAccept(request, env, auth.email);
      else if (path === '/api/requests-decline') response = await handleRequestsDecline(request, env, auth.email);
      else if (path === '/api/requests-submit-nudge') response = await handleRequestsSubmitNudge(request, env, auth.email);
      else if (path === '/api/requests-submit-done') response = await handleRequestsSubmitDone(request, env, auth.email);
      else if (path === '/api/requests-delete') response = await handleRequestsDelete(request, env, auth.email);
      else if (path === '/api/premium-alert-config') response = await handlePremiumAlertConfig(env);
      else if (path === '/api/premium-status') response = await handlePremiumStatus(env, auth.email, allowSandboxPro);
      else if (path === '/api/premium-trial-activate') response = await handlePremiumTrialActivate(env, auth.email);
      else if (path === '/api/pro-purchase-config') response = await handleProPurchaseConfig(env);
      else if (path === '/api/pro-purchase-verify') response = await handleProPurchaseVerify(request, env, auth.email);
      else if (path === '/api/premium-alert-sync') response = await handlePremiumAlertSync(request, env, auth.email, allowSandboxPro);
      else if (path === '/api/premium-alert-test') response = await handlePremiumAlertTest(env, auth.email, allowSandboxPro);
      else if (path === '/api/crewconnex') response = await handleCrewConnex(request, env);
      else response = new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('CrewSwap API error', error);
      response = json({ error: '서버 설정 또는 처리 중 오류가 발생했습니다' }, 500);
    }
    return withCors(response, request);
  },
};
