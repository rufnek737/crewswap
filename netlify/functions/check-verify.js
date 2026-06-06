'use strict';
/**
 * POST { email, code, token }
 * → send-verify.js 가 발급한 토큰 + 사용자가 입력한 코드를 검증
 * → DB 없이 HMAC 재계산으로 검증 (stateless)
 */

const crypto = require('crypto');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};
const ok  = body => ({ statusCode: 200, headers: cors, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') return err(405, 'Method Not Allowed');

  let email, code, token;
  try { ({ email, code, token } = JSON.parse(event.body || '{}')); }
  catch { return err(400, '잘못된 요청'); }

  email = (email || '').trim().toLowerCase();
  code  = (code  || '').trim().replace(/\s/g, '');
  if (!email || !code || !token) return err(400, '이메일, 코드, 토큰을 모두 전달해주세요');

  // 토큰 디코딩
  let parsed;
  try { parsed = JSON.parse(Buffer.from(token, 'base64url').toString()); }
  catch { return err(400, '토큰 형식 오류'); }

  const { t: ts, h: storedHmac } = parsed;
  if (!ts || !storedHmac) return err(400, '토큰 형식 오류');

  // 만료 검사 (10분)
  if (Date.now() - parseInt(ts, 10) > 10 * 60 * 1000) {
    return err(400, '인증 코드가 만료되었습니다. 코드를 다시 발송해 주세요.');
  }

  // HMAC 재계산 → 비교
  const secret       = process.env.VERIFY_SECRET || 'jjswap-verify-secret-change-me';
  const expectedHmac = crypto.createHmac('sha256', secret)
                         .update(`${email}:${code}:${ts}`)
                         .digest('hex');

  // timing-safe 비교
  if (expectedHmac.length !== storedHmac.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(storedHmac))) {
    return err(400, '인증 코드가 올바르지 않습니다');
  }

  return ok({ verified: true, email });
};
