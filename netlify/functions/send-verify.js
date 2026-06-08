'use strict';
/**
 * POST { email }
 * → 제주항공 이메일(@jejuair.net) 유효성 검사
 * → 6자리 코드 생성 + HMAC 서명 토큰 반환 (stateless)
 *
 * [테스트 모드] RESEND_API_KEY 미설정 시 이메일 발송 없이 코드를 응답에 포함
 * [운영 모드]   RESEND_API_KEY 설정 시 실제 이메일 발송
 *
 * 환경변수 (Netlify > Project configuration > Environment variables):
 *   VERIFY_SECRET   — HMAC 서명용 비밀 문자열 (필수)
 *   RESEND_API_KEY  — 실제 이메일 발송 시 필요 (없으면 테스트 모드)
 *   RESEND_FROM     — 발신 주소, 예: "JJ Swap <noreply@yourdomain.com>"
 */

const crypto = require('crypto');

const EXPIRY_MS = 10 * 60 * 1000; // 10분

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

  let email;
  try { ({ email } = JSON.parse(event.body || '{}')); }
  catch { return err(400, '잘못된 요청'); }

  email = (email || '').trim().toLowerCase();
  if (!email) return err(400, '이메일을 입력해주세요');
  if (!email.endsWith('@jejuair.net')) {
    return err(400, '제주항공 이메일(@jejuair.net)만 가입할 수 있습니다');
  }

  // 6자리 코드 생성
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const ts   = Date.now().toString();

  // HMAC 서명 토큰 (DB 없이 서버리스로 검증 가능)
  const secret = process.env.VERIFY_SECRET || 'jjswap-verify-secret-change-me';
  const hmac   = crypto.createHmac('sha256', secret)
                   .update(`${email}:${code}:${ts}`)
                   .digest('hex');
  const token  = Buffer.from(JSON.stringify({ t: ts, h: hmac })).toString('base64url');

  // RESEND_API_KEY + RESEND_FROM 둘 다 설정된 경우에만 실제 발송
  // 둘 중 하나라도 없으면 테스트 모드 — 코드를 응답에 직접 포함
  const apiKey  = process.env.RESEND_API_KEY;
  const fromAddr = process.env.RESEND_FROM;
  if (!apiKey || !fromAddr) {
    return ok({ token, code, expiresAt: Date.now() + EXPIRY_MS, testMode: true });
  }

  // 실제 이메일 발송 (RESEND_API_KEY + RESEND_FROM 둘 다 설정된 경우)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: email,
        subject: '[CrewSwap] 이메일 인증 코드',
        html: `
          <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px;">
            <div style="background:#2B9FD9;color:#fff;padding:14px 20px;border-radius:10px 10px 0 0;">
              <strong style="font-size:18px;">CrewSwap</strong>
              <span style="opacity:.8;font-size:12px;margin-left:8px;">승무원 스케줄 스왑 매칭</span>
            </div>
            <div style="border:1px solid #dce3ec;border-top:0;padding:28px;border-radius:0 0 10px 10px;background:#fff;">
              <p style="color:#637083;font-size:14px;margin:0 0 20px;">아래 인증 코드를 10분 이내에 입력해 주세요.</p>
              <div style="letter-spacing:8px;font-size:34px;font-weight:800;color:#17202e;
                          padding:18px;background:#f5f7fa;border-radius:8px;text-align:center;">
                ${code}
              </div>
              <p style="color:#9ba6b7;font-size:12px;margin:18px 0 0;line-height:1.6;">
                본인이 요청하지 않았다면 이 메일을 무시해도 됩니다.<br/>코드는 10분 후 만료됩니다.
              </p>
            </div>
          </div>
        `,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return err(502, `이메일 발송 실패 (${res.status}): ${body.message || '알 수 없는 오류'}`);
    }
  } catch (e) {
    return err(502, `이메일 발송 중 오류: ${e.message}`);
  }

  return ok({ token, expiresAt: Date.now() + EXPIRY_MS });
};
