import { compareAndSwap } from './atomic-store.mjs';
const TTL = 10 * 60 * 1000;
const fail = (error, status = 400) => ({ ok: false, error, status });
async function digest(secret, value) {
  if (!secret) throw new Error('VERIFY_SECRET 서버 설정이 필요합니다');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function createEmailChallenge(env, email, now = Date.now()) {
  const key = `verify:${email}`;
  for (let retry = 0; retry < 12; retry++) {
    const raw = await env.POSTS.get(key);
    const prev = raw ? JSON.parse(raw) : null;
    const sameWindow = prev && now - prev.windowStart < TTL;
    if (sameWindow && (prev.sends >= 5 || prev.attempts >= 5))
      return fail('인증 시도가 너무 많습니다. 10분 후 다시 시도해주세요.', 429);
    const token = crypto.randomUUID();
    let random;
    do { random = crypto.getRandomValues(new Uint32Array(1))[0]; } while (random >= 4294800000);
    const code = String(100000 + random % 900000);
    const challenge = { token, codeHash: await digest(env.VERIFY_SECRET, `${email}:${token}:${code}`),
      expiresAt: now + TTL, consumed: false, windowStart: sameWindow ? prev.windowStart : now,
      sends: sameWindow ? prev.sends + 1 : 1, attempts: sameWindow ? prev.attempts : 0 };
    if (await compareAndSwap(env.POSTS, key, raw, JSON.stringify(challenge)))
      return { ok: true, token, code, expiresAt: challenge.expiresAt };
  }
  return fail('인증 요청이 겹쳤습니다. 잠시 후 다시 시도해주세요.');
}
export async function verifyEmailChallenge(env, email, code, token, consume = false, now = Date.now()) {
  email = String(email || '').trim().toLowerCase();
  code = String(code || '').trim().replace(/\s/g, '');
  if (!email || !code || !token) return fail('이메일, 코드, 토큰을 모두 전달해주세요');
  const key = `verify:${email}`;
  for (let retry = 0; retry < 12; retry++) {
    const raw = await env.POSTS.get(key);
    const challenge = raw ? JSON.parse(raw) : null;
    if (!challenge || challenge.token !== token || challenge.consumed || challenge.expiresAt <= now)
      return fail('인증 코드가 만료되었거나 사용되었습니다. 다시 발송해주세요.');
    if (challenge.attempts >= 5) return fail('인증 시도가 너무 많습니다. 10분 후 다시 시도해주세요.', 429);
    const valid = /^\d{6}$/.test(code) && await digest(env.VERIFY_SECRET, `${email}:${token}:${code}`) === challenge.codeHash;
    const next = { ...challenge, attempts: challenge.attempts + (valid ? 0 : 1), consumed: valid && consume };
    if (await compareAndSwap(env.POSTS, key, raw, JSON.stringify(next)))
      return valid ? { ok: true, email } : fail('인증 코드가 올바르지 않습니다');
  }
  return fail('인증 요청이 겹쳤습니다. 잠시 후 다시 시도해주세요.');
}
