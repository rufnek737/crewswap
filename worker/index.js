// CrewSwap API — Cloudflare Workers
// 라우팅: /api/send-verify, /api/check-verify, /api/posts-get,
//          /api/posts-create, /api/posts-delete, /api/crewconnex

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
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

/* ── send-verify ────────────────────────────────────────────── */

async function handleSendVerify(request, env) {
  let email;
  try { ({ email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  email = (email || '').trim().toLowerCase();
  if (!email) return json({ error: '이메일을 입력해주세요' }, 400);
  if (!email.endsWith('@jejuair.net'))
    return json({ error: '제주항공 이메일(@jejuair.net)만 가입할 수 있습니다' }, 400);

  const EXPIRY = 10 * 60 * 1000;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const ts = Date.now().toString();
  const secret = env.VERIFY_SECRET || 'jjswap-verify-secret-change-me';
  const hmac = await hmacHex(secret, `${email}:${code}:${ts}`);
  const token = toBase64url(JSON.stringify({ t: ts, h: hmac }));

  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    return json({ token, code, expiresAt: Date.now() + EXPIRY, testMode: true });
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
  email = (email || '').trim().toLowerCase();
  code = (code || '').trim().replace(/\s/g, '');
  if (!email || !code || !token) return json({ error: '이메일, 코드, 토큰을 모두 전달해주세요' }, 400);

  let parsed;
  try { parsed = JSON.parse(fromBase64url(token)); } catch { return json({ error: '토큰 형식 오류' }, 400); }
  const { t: ts, h: storedHmac } = parsed;
  if (!ts || !storedHmac) return json({ error: '토큰 형식 오류' }, 400);
  if (Date.now() - parseInt(ts, 10) > 10 * 60 * 1000)
    return json({ error: '인증 코드가 만료되었습니다. 코드를 다시 발송해 주세요.' }, 400);

  const secret = env.VERIFY_SECRET || 'jjswap-verify-secret-change-me';
  const expectedHmac = await hmacHex(secret, `${email}:${code}:${ts}`);
  if (!timingSafeEqual(expectedHmac, storedHmac))
    return json({ error: '인증 코드가 올바르지 않습니다' }, 400);

  return json({ verified: true, email });
}

/* ── posts-get ──────────────────────────────────────────────── */

async function handlePostsGet(env) {
  try {
    const { keys } = await env.POSTS.list({ prefix: 'post:' });
    const posts = await Promise.all(keys.map(async ({ name }) => {
      const data = await env.POSTS.get(name, { type: 'json' });
      if (!data || data.status !== 'active') return null;
      const { deleteToken, ownerEmail, ...pub } = data;
      // 이메일 자체는 비공개, 연락 가능 여부만 노출 (구버전 글 식별용)
      pub.contactable = !!ownerEmail;
      return pub;
    }));
    return json({ posts: posts.filter(Boolean) });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-get-mine (같은 계정이면 어느 기기에서든 내가 등록한 글 동기화) ── */

async function handlePostsGetMine(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return json({ error: 'email 필요' }, 400);
  try {
    const { keys } = await env.POSTS.list({ prefix: 'post:' });
    const posts = await Promise.all(keys.map(({ name }) => env.POSTS.get(name, { type: 'json' })));
    const mine = posts.filter(p => p && p.ownerEmail === email && p.status === 'active');
    return json({ posts: mine });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-create ───────────────────────────────────────────── */

const POST_FIELDS = [
  'id', 'deleteToken', 'registeredAt',
  'airline', 'crewType', 'ownerRole', 'ownerNick', 'ownerRating', 'ownerBase', 'ownerEmail',
  'offered', 'wanted',
  'deadlineDay', 'watchers', 'status', 'creditSpent',
];

async function handlePostsCreate(request, env) {
  let post;
  try { post = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!post.id || !post.deleteToken || !post.offered || !post.wanted)
    return json({ error: '필수 필드 누락' }, 400);

  const clean = {};
  POST_FIELDS.forEach(k => { if (post[k] !== undefined) clean[k] = post[k]; });
  clean.status = 'active';
  clean.registeredAt = clean.registeredAt || new Date().toISOString();

  try {
    await env.POSTS.put(`post:${clean.id}`, JSON.stringify(clean));
    return json({ id: clean.id });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-update (희망 조건만 수정, 오퍼/크레딧 변경 없음) ──── */

async function handlePostsUpdate(request, env) {
  let id, deleteToken, wanted;
  try { ({ id, deleteToken, wanted } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!id || !deleteToken || !wanted) return json({ error: '필수 필드 누락' }, 400);

  try {
    const post = await env.POSTS.get(`post:${id}`, { type: 'json' });
    if (!post) return json({ error: '글을 찾을 수 없음' }, 404);
    if (post.deleteToken !== deleteToken) return json({ error: '권한 없음' }, 403);
    post.wanted = wanted;
    await env.POSTS.put(`post:${id}`, JSON.stringify(post));
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-create (요청하기 / 양도 의향 묻기 — 서버 경유 전달) ── */

function randId() {
  return Math.random().toString(36).slice(2, 10);
}

async function handleRequestsCreate(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: '잘못된 요청' }, 400); }
  const { postId, fromEmail, fromNick, fromBase, fromRole, type, message, offered } = body || {};
  if (!postId || !fromEmail || !fromNick || !type)
    return json({ error: '필수 필드 누락' }, 400);
  // 정식 요청은 "내가 줄 근무(offered)"가 반드시 있어야 함 (의향묻기는 선택)
  if (type === 'request' && (!offered || !offered.patternName))
    return json({ error: '바꿔줄 내 근무를 선택해야 합니다' }, 400);

  try {
    const post = await env.POSTS.get(`post:${postId}`, { type: 'json' });
    if (!post) return json({ error: '글을 찾을 수 없음' }, 404);
    if (!post.ownerEmail) return json({ error: '상대방 연락 정보가 없는 글입니다 (구버전 글)' }, 400);

    const id = 'REQ-' + Date.now() + '-' + randId();
    const rec = {
      id, postId, type,
      postTitle: post.offered?.patternName || '',
      postOwnerRole: post.ownerRole || null,
      aircraft: post.offered?.aircraft || '-',
      quals: [post.offered?.edto ? 'EDTO' : null, post.offered?.cat3 ? 'CAT III' : null].filter(Boolean).join(' / ') || '일반',
      base: post.ownerBase || null,
      message: message || '',
      fromEmail, fromNick, fromBase: fromBase || null, fromRole: fromRole || null,
      offered: offered || null, // 요청자가 줄 근무(X)
      toEmail: post.ownerEmail, toNick: post.ownerNick || null,
      status: type === 'ask' ? '의향 문의' : '요청 대기',
      stage: 1,
      createdAt: new Date().toISOString(),
    };
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    return json({ id });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-accept (받은 요청 상호 수락) ───────────────────── */

async function handleRequestsAccept(request, env) {
  let id, email;
  try { ({ id, email } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!id || !email) return json({ error: '필수 필드 누락' }, 400);
  try {
    const rec = await env.POSTS.get(`req:${id}`, { type: 'json' });
    if (!rec) return json({ error: '요청을 찾을 수 없음' }, 404);
    if (rec.toEmail !== email) return json({ error: '수락 권한이 없습니다' }, 403); // 받은 사람만 수락 가능
    rec.stage = 3;               // 상호 수락 → 회사 상신 단계
    rec.status = '상호 수락 — 회사 상신 필요';
    rec.acceptedAt = new Date().toISOString();
    await env.POSTS.put(`req:${id}`, JSON.stringify(rec));
    return json({ ok: true });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── requests-get (보낸/받은 요청 조회) ───────────────────────── */

async function handleRequestsGet(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return json({ error: 'email 필요' }, 400);

  try {
    const { keys } = await env.POSTS.list({ prefix: 'req:' });
    const all = await Promise.all(keys.map(({ name }) => env.POSTS.get(name, { type: 'json' })));
    const valid = all.filter(Boolean);
    const sent = valid.filter(r => r.fromEmail === email);
    const received = valid.filter(r => r.toEmail === email);
    return json({ sent, received });
  } catch (e) { return json({ error: e.message }, 500); }
}

/* ── posts-delete ───────────────────────────────────────────── */

async function handlePostsDelete(request, env) {
  let id, deleteToken;
  try { ({ id, deleteToken } = await request.json()); } catch { return json({ error: '잘못된 요청' }, 400); }
  if (!id || !deleteToken) return json({ error: '필수 필드 누락' }, 400);

  try {
    const post = await env.POSTS.get(`post:${id}`, { type: 'json' });
    if (!post) return json({ ok: true, alreadyGone: true });
    if (post.deleteToken !== deleteToken) return json({ error: '권한 없음' }, 403);
    await env.POSTS.delete(`post:${id}`);
    return json({ ok: true });
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
  const clean = t.replace('+1', '').trim();
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}`;
  if (/^\d{1,2}:\d{2}/.test(clean)) return clean.slice(0, 5);
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
  return {
    iDate: find('Date'), iPair: find('Pairing'), iAct: find('Activity'),
    iFrom: find('From'), iTo: find('To'), iCI: find('CIL'), iCO: find('COL'),
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
    let type, title;
    if (STBY_CODES.test(activity) || STBY_CODES.test(pairing) || /STBY/i.test(activity + ' ' + pairing)) {
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
    if (ciR) e.reportTime = fmtTime(ciR[cols.iCI]);
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
    const e = dedup[i]; if (e.type === 'UNKNOWN' && !e.dep) {
      const prev = dedup.find(x => x.day === e.day - 1);
      if (prev) {
        if (prev._overnightArrival) { const info = prev._overnightArrival; e.type = 'ARRIVAL'; e.title = `← ${info.flightTitle} 도착`; e.arrivalAirport = info.to; e.arrivalTime = info.arrivalTime; e.crewComposition = `${info.flightTitle} ${info.from}→${info.to} 도착일`; }
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
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname;
    if (path === '/api/send-verify')  return handleSendVerify(request, env);
    if (path === '/api/check-verify') return handleCheckVerify(request, env);
    if (path === '/api/posts-get')    return handlePostsGet(env);
    if (path === '/api/posts-get-mine') return handlePostsGetMine(request, env);
    if (path === '/api/posts-create') return handlePostsCreate(request, env);
    if (path === '/api/posts-delete') return handlePostsDelete(request, env);
    if (path === '/api/posts-update') return handlePostsUpdate(request, env);
    if (path === '/api/requests-create') return handleRequestsCreate(request, env);
    if (path === '/api/requests-get')    return handleRequestsGet(request, env);
    if (path === '/api/requests-accept') return handleRequestsAccept(request, env);
    if (path === '/api/crewconnex')   return handleCrewConnex(request, env);
    return new Response('Not Found', { status: 404 });
  },
};
