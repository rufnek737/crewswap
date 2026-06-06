'use strict';

/**
 * JJ Swap — CrewConnex 자동 로그인 + 파싱 Netlify Function
 *
 * POST body: { username, password, userName? (편조 제외용 본인 한글 이름) }
 * Response : { schedules: [...], meta: { count, totalBLH, ... } }
 *
 * 기반: pilot-logbook의 crewconnex.js + JJ Swap v8 로직 통합
 */

const BASE = 'https://crewconnex.jejuair.net';

/* ───────── 공통 유틸 ───────── */

function stripHtml(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function fmtTime(s) {
  const t = (s || '').trim();
  if (!t) return null;
  // "+1" 제거 후 변환
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

function renameF(s) {
  return s ? s.replace(/^F(\d)/, '7C$1') : s;
}

function formatFlight(num) {
  return /^\d{2,4}$/.test(num) ? `7C${num.padStart(4, '0')}` : num;
}

function updateJar(jar, arr) {
  for (const c of arr || []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
}

function jarStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function getSetCookies(r) {
  if (typeof r.headers.getSetCookie === 'function') return r.headers.getSetCookie();
  const h = r.headers.get('set-cookie');
  return h ? [h] : [];
}

/* ───────── HTML 테이블 파싱 ───────── */

function extractTableRows(tableHtml) {
  const rows = [];
  const rRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rM;
  while ((rM = rRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cM;
    while ((cM = cRe.exec(rM[1])) !== null) cells.push(stripHtml(cM[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function findRosterTable(html) {
  const tRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tM;
  while ((tM = tRe.exec(html)) !== null) {
    const t = tM[0];
    if (/Date/.test(t) && /Pairing/.test(t) && /Activity/.test(t) && /BLH/.test(t)) {
      return t;
    }
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
    iDate: find('Date'),
    iPair: find('Pairing'),
    iAct: find('Activity'),
    iFrom: find('From'),
    iTo: find('To'),
    iCI: find('CIL'),
    iCO: find('COL'),
    iSTA: find('STAL'),
    iAC: find('ACHotel'),
    iBLH: find('BLH'),
    iCC: find('CC'),
    iPos: find('Pos'),
  };
}

/* ───────── 메타데이터 추출: 월 ─────────── */

function detectMonth(html) {
  // <select>에서 선택된 옵션 또는 헤더 텍스트에서 MAY26, JUN26 등 검출
  const monthRe = /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})\b/i;
  const m = monthRe.exec(html);
  if (!m) return null;
  const monthMap = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
  return { year: 2000 + parseInt(m[2]), month: monthMap[m[1].toUpperCase()] };
}

/* ───────── 본인 이름 자동 감지 ───────── */

function detectUserName(html) {
  const m = /([가-힣]{2,4})\s+(?:Mr|Ms)\.?\s+[A-Z]/i.exec(html);
  return m ? m[1] : null;
}

/* ───────── 핵심: JJ Swap 스키마로 변환 ───────── */

const DOM_AIRPORTS = new Set(['ICN','GMP','PUS','CJU','TAE','CJJ','RSU','MWX','KPO','USN','WJU','HIN','KUV','KWJ','YEC','KAG']);
// 제주항공 EDTO 적용 공항: 괌(GUM) + 사이판(SPN)만
const EDTO_AIRPORTS = new Set(['GUM','SPN']);
// 허브/베이스 공항 (1박 domestic overnight 연결 기준 — 이 공항 경유는 trip 분리)
const HOME_BASES = new Set(['GMP','ICN','PUS','CJU']);
const CAPT_CODES = /^(C|H|L|K|2C|2NC|C1|C2|PC|NC|3PC|3NC)$/i;
const FO_CODES = /^(F|2F|2NF|F1|F2|3F)$/i;
const STBY_CODES = /^S[AB]\d*$/i;

function parseRosterToSchedules(html, userNameHint) {
  const tableHtml = findRosterTable(html);
  if (!tableHtml) return { schedules: [], meta: { error: 'roster_table_not_found' } };

  const allRows = extractTableRows(tableHtml);
  if (allRows.length < 2) return { schedules: [], meta: { error: 'no_data_rows' } };

  // 헤더 행 찾기
  const headerIdx = allRows.findIndex(r =>
    r.some(c => /Date/i.test(c)) && r.some(c => /Pairing/i.test(c)) && r.some(c => /Activity/i.test(c))
  );
  if (headerIdx < 0) return { schedules: [], meta: { error: 'header_row_not_found' } };

  const cols = mapColumns(allRows[headerIdx]);
  const dataRows = allRows.slice(headerIdx + 1);

  const userName = userNameHint || detectUserName(html);

  // Phase 1: 일자 그룹화
  const groups = [];
  let cur = null;
  dataRows.forEach(row => {
    if (row.length < 5) return;
    const dateText = row[cols.iDate] || '';
    if (/\d{1,2}/.test(dateText)) {
      cur = { primary: row, legs: [], dateText };
      groups.push(cur);
    } else if (cur) {
      cur.legs.push(row);
    }
  });

  // Phase 2: 그룹 → 엔트리 변환
  const entries = [];
  groups.forEach(g => {
    const p = g.primary;
    const allRows = [p, ...g.legs];
    const dayM = /(\d{1,2})/.exec(p[cols.iDate]);
    if (!dayM) return;
    const day = parseInt(dayM[1], 10);
    if (day < 1 || day > 31) return;

    const activity = (p[cols.iAct] || '').trim();
    const pairing = (p[cols.iPair] || '').trim();
    let type, title;

    if (STBY_CODES.test(activity) || STBY_CODES.test(pairing) || /STBY/i.test(activity + ' ' + pairing)) {
      type = 'STBY';
      const sc = STBY_CODES.test(activity) ? activity : STBY_CODES.test(pairing) ? pairing : 'STBY';
      title = `STBY ${sc}`;
    } else if (/^OFF/i.test(activity) || /^OFF/i.test(pairing)) {
      type = 'OFF';
      title = 'OFF';
    } else if (/RSV/i.test(activity + ' ' + pairing)) {
      type = 'RSV';
      title = 'RSV';
    } else if (/LAYOV/i.test(activity + ' ' + pairing)) {
      type = 'LAYOV';
      const m = /LAYOV\s*\(?([A-Z]{3})/i.exec(activity + ' ' + pairing);
      title = m ? `LAYOV ${m[1]}` : 'LAYOV';
    } else {
      const fr = allRows.filter(r => r[cols.iFrom] && r[cols.iTo] && !/^\|$/.test(r[cols.iFrom]));
      if (fr.length) {
        const allDom = fr.every(r => DOM_AIRPORTS.has(r[cols.iFrom]) && DOM_AIRPORTS.has(r[cols.iTo]));
        type = allDom ? '국내선' : '국제선';
        title = renameF(pairing) || `${fr[0][cols.iFrom]}-${fr[fr.length - 1][cols.iTo]}`;
      } else {
        type = 'UNKNOWN';
        title = renameF(pairing) || activity || '-';
      }
    }

    // 시간/기종/BLH/공항 추출
    const ciR = allRows.find(r => r[cols.iCI] && !/^\|$/.test(r[cols.iCI]));
    const coR = [...allRows].reverse().find(r => r[cols.iCO] && !/^\|$/.test(r[cols.iCO]));
    const staR = [...allRows].reverse().find(r => r[cols.iSTA] && !/^\|$/.test(r[cols.iSTA]));
    const acR = allRows.find(r => r[cols.iAC] && !/^\|$/.test(r[cols.iAC]));

    let aircraft = null;
    if (acR) {
      const a = acR[cols.iAC];
      if (/7M8|MAX/i.test(a)) aircraft = 'MAX';
      else if (/73[78]/i.test(a)) aircraft = 'NG';
    }

    // BLH 합산
    let blockMin = 0;
    if (cols.iBLH >= 0) {
      allRows.forEach(r => {
        const b = (r[cols.iBLH] || '').trim();
        if (b && !/^\|$/.test(b)) blockMin += blhToMin(b);
      });
    }

    // 편조 (본인 제외)
    const ccText = (p[cols.iCC] || '').trim();
    const posText = (p[cols.iPos] || '').trim();
    const namesRaw = ccText.split(/\n+/).map(s => s.trim());
    const positions = posText.split(/\n+/).map(s => s.trim());
    const userIdx = userName ? namesRaw.findIndex(n => n && n.includes(userName)) : -1;
    const userPos = userIdx >= 0 ? (positions[userIdx] || '').trim() : '';
    const others = [];
    for (let i = 0; i < namesRaw.length; i++) {
      if (i === userIdx) continue;
      const nm = namesRaw[i];
      if (!nm || /^\s*\|+\s*$/.test(nm)) continue;
      const ps = (positions[i] || '').replace(/^\s*\|+\s*$/, '').replace(/\s*\([^)]*\)/g, '').trim();
      others.push(`${nm}${ps ? `(${ps})` : ''}`);
    }
    const crewStr = others.join(', ');

    // 야간 복귀 감지
    const fr = allRows.filter(r => r[cols.iFrom] && r[cols.iTo] && !/^\|$/.test(r[cols.iFrom]));
    const overnightLeg = fr.find(r => /\+1/.test(r[cols.iSTA] || ''));
    let overnightInfo = null;
    if (overnightLeg) {
      const legActNum = (overnightLeg[cols.iAct] || '').trim();
      overnightInfo = {
        flightTitle: formatFlight(legActNum) || renameF(pairing) || '야간 복귀',
        from: overnightLeg[cols.iFrom],
        to: overnightLeg[cols.iTo],
        arrivalTime: fmtTime(overnightLeg[cols.iSTA] || ''),
      };
    }

    const e = { day, type, title, patternId: null };
    if (type === '국내선' || type === '국제선') {
      if (fr.length) {
        e.dep = fr[0][cols.iFrom];
        e.arr = fr[fr.length - 1][cols.iTo];
        if (fr.length > 1) {
          e.routeSummary = [fr[0][cols.iFrom], ...fr.map(r => r[cols.iTo])].join('→');
          e.legs = fr.length;
        }
        if (type === '국제선' && fr.some(r => EDTO_AIRPORTS.has(r[cols.iTo]) || EDTO_AIRPORTS.has(r[cols.iFrom]))) {
          e.requiresEdto = true;
        }
      }
    } else if (type === 'LAYOV') {
      const m = /LAYOV\s*\(?([A-Z]{3})/i.exec(activity + ' ' + pairing);
      if (m) e.layoverAirport = m[1];
    }
    if (ciR) e.reportTime = fmtTime(ciR[cols.iCI]);
    if (staR) e.arrivalTime = fmtTime(staR[cols.iSTA]);
    if (coR) e.releaseTime = fmtTime(coR[cols.iCO]);
    if (aircraft) e.aircraft = aircraft;
    if (crewStr) e.crewComposition = crewStr;
    if (blockMin > 0) e.blockMinutes = blockMin;
    if (userPos) {
      e.dutyCode = userPos;
      if (CAPT_CODES.test(userPos) || /Capt|PIC/i.test(userPos)) e.captainGrade = 'B';
      if (FO_CODES.test(userPos) || /^FO\b/i.test(userPos)) e.foGrade = 'B';
      if (/^3/i.test(userPos)) e.crewSet = 3;
      else if (/^2|^[PN]C$/i.test(userPos)) e.crewSet = 2;
    }
    if (pairing) e._pairing = pairing;
    if (overnightInfo) e._overnightArrival = overnightInfo;
    entries.push(e);
  });

  // Phase 3: 중복 제거
  const seen = new Set();
  const dedup = [];
  entries.forEach(e => {
    const key = `${e.day}|${e.title}|${e.reportTime || ''}|${e.dep || ''}|${e.arr || ''}|${e.type}`;
    if (!seen.has(key)) { seen.add(key); dedup.push(e); }
  });
  dedup.sort((a, b) => a.day - b.day);

  // Phase 4: Shadow → ARRIVAL/LAYOV 추론 (type 변환만, patternId는 인접 룰이 처리)
  for (let i = 0; i < dedup.length; i++) {
    const e = dedup[i];
    if (e.type === 'UNKNOWN' && !e.dep) {
      const prev = dedup.find(x => x.day === e.day - 1);
      if (prev) {
        if (prev._overnightArrival) {
          const info = prev._overnightArrival;
          e.type = 'ARRIVAL';
          e.title = `← ${info.flightTitle} 도착`;
          e.arrivalAirport = info.to;
          e.arrivalTime = info.arrivalTime;
          e.crewComposition = `${info.flightTitle} ${info.from}→${info.to} 도착일`;
        } else if (prev.type === 'LAYOV' && prev.layoverAirport) {
          e.type = 'LAYOV';
          e.title = `LAYOV ${prev.layoverAirport}`;
          e.layoverAirport = prev.layoverAirport;
          e.crewComposition = `${prev.layoverAirport} 체류 (자동)`;
        } else if (prev.type === '국제선' && prev.arr && !DOM_AIRPORTS.has(prev.arr)) {
          e.type = 'LAYOV';
          e.title = `LAYOV ${prev.arr}`;
          e.layoverAirport = prev.arr;
          e.crewComposition = `${prev.arr} 체류 (자동)`;
        }
      }
    }
  }

  // Phase 5: patternId 할당 — 연속 일자 + 호환 타입만 같은 패턴
  // (떨어진 일자의 동일 pairing/title은 별도 패턴으로 분리)
  let pid = 1;
  for (let i = 0; i < dedup.length; i++) {
    const e = dedup[i];
    const prev = i > 0 ? dedup[i - 1] : null;
    const adjacent = !!(prev && prev.day === e.day - 1 && prev.month === e.month);
    let joined = false;

    if (adjacent) {
      // 1. 같은 pairing 코드가 연속 일자에 존재 (CrewConnex가 명시적으로 묶은 trip)
      if (e._pairing && prev._pairing && e._pairing === prev._pairing
          && !/^OFF/i.test(e._pairing)) {
        joined = true;
      }
      // 2. LAYOV ↔ LAYOV (같은 체류 공항)
      else if (e.type === 'LAYOV' && prev.type === 'LAYOV'
               && e.layoverAirport && e.layoverAirport === prev.layoverAirport) {
        joined = true;
      }
      // 3. 국제선 outbound → LAYOV (도착공항 = 체류공항)
      else if (e.type === 'LAYOV' && prev.type === '국제선'
               && e.layoverAirport && e.layoverAirport === prev.arr) {
        joined = true;
      }
      // 4. LAYOV → 국제선 inbound (체류공항 = 출발공항)
      else if (e.type === '국제선' && prev.type === 'LAYOV'
               && e.dep && e.dep === prev.layoverAirport) {
        joined = true;
      }
      // 5. ARRIVAL → 직전 LAYOV/국제선/국내선 (overnight 복귀 — SIM·국내 포함)
      //    Phase4 에서 ARRIVAL 타입이 된 항목은 반드시 _overnightArrival 경유이므로 안전
      else if (e.type === 'ARRIVAL' && (prev.type === 'LAYOV' || prev.type === '국제선' || prev.type === '국내선')) {
        joined = true;
      }
      // 6. 국제선 → 국제선 (외국공항 connection — 같은 trip 내 다음 leg)
      else if (e.type === '국제선' && prev.type === '국제선'
               && e.dep && e.dep === prev.arr && !DOM_AIRPORTS.has(e.dep)) {
        joined = true;
      }
      // 7. 같은 title 연속 — 단, 국내선/국제선은 제외 (별도 trip일 가능성↑)
      //    SIM / 훈련 / RSV / STBY / OFF 등 반복 일자에만 적용
      else if (e.title && e.title === prev.title && e.type === prev.type
               && e.type !== '국내선' && e.type !== '국제선') {
        joined = true;
      }
      // 8. 국내선/국제선 → 국내선/국제선: 비허브 공항 overnight stay (TAE, CJU 등)
      //    예) 29일 GMP→TAE 착 → 30일 TAE→GMP 출 → 1박 2일 국내 overnight trip
      else if ((e.type === '국내선' || e.type === '국제선')
               && (prev.type === '국내선' || prev.type === '국제선')
               && prev.arr && e.dep && prev.arr === e.dep
               && !HOME_BASES.has(prev.arr)) {
        joined = true;
      }
    }

    e.patternId = joined ? prev.patternId : `P${pid++}`;
    delete e._pairing;
    delete e._inheritFrom;
    delete e._overnightArrival;
  }

  // Phase 6: 인접 RSV/STBY 묶음 — 같은 month 안에서만, OFF가 끼면 끊김
  for (let i = 1; i < dedup.length; i++) {
    const cur = dedup[i], prev = dedup[i - 1];
    if (cur.month !== prev.month) continue;
    if (prev.day !== cur.day - 1) continue;
    const isStandby = (t) => t === 'RSV' || t === 'STBY';
    if (isStandby(cur.type) && isStandby(prev.type)) {
      cur.patternId = prev.patternId;
    }
  }

  const totalBlh = dedup.reduce((s, e) => s + (e.blockMinutes || 0), 0);
  const meta = {
    userName,
    count: dedup.length,
    totalBLH: `${Math.floor(totalBlh / 60)}:${String(totalBlh % 60).padStart(2, '0')}`,
    stbyCount: dedup.filter(e => e.type === 'STBY').length,
    arrivalCount: dedup.filter(e => e.type === 'ARRIVAL').length,
    monthDetected: detectMonth(html),
  };

  return { schedules: dedup, meta };
}

/* ───────── 인증 & Roster 페이지 fetch ───────── */

async function tryFetchRoster(url, jar, referer, userNameHint) {
  try {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'ko-KR,ko', 'Cookie': jarStr(jar), 'Referer': referer },
      redirect: 'follow',
    });
    updateJar(jar, getSetCookies(r));
    if (!r.ok || r.url.includes('login')) return null;
    const raw = await r.text();
    // ASP.NET AJAX 부분 응답이면 HTML 추출
    const html = /^\d+\|[a-zA-Z]+\|/.test(raw) ? extractFromAjaxResponse(raw) : raw;
    const result = parseRosterToSchedules(html, userNameHint);
    if (result.meta && result.meta.monthDetected) {
      const m = result.meta.monthDetected;
      const monthStr = `${m.year}-${String(m.month).padStart(2,'0')}`;
      result.schedules.forEach(s => { s.month = monthStr; });
    }
    return { ...result, finalUrl: r.url, rawHtml: html, rawResponse: raw };
  } catch (_) { return null; }
}

/* ───────── ASP.NET ViewState / Period 드롭다운 처리 ───────── */

// ASP.NET 폼의 모든 hidden input 추출 (ViewState + EventValidation + 기타)
function extractAllHiddenInputs(html) {
  const inputs = {};
  const inputRe = /<input([^>]*)>/gi;
  let m;
  while ((m = inputRe.exec(html)) !== null) {
    const attrs = m[1];
    if (!/\btype=["']hidden["']/i.test(attrs)) continue;
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    const valueMatch = attrs.match(/\bvalue=["']([^"']*)["']/i);
    if (nameMatch) inputs[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
  }
  return inputs;
}

function getFormAction(html, defaultUrl) {
  const m = html.match(/<form[^>]+action=["']([^"']*)["']/i);
  if (!m || !m[1]) return defaultUrl;
  try {
    return new URL(m[1], defaultUrl).href;
  } catch { return defaultUrl; }
}

function findPeriodDropdown(html) {
  // <select> 중 옵션 value가 월코드(MAY26 등) 또는 날짜범위인 것 찾기
  const monthCodeRe = /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}/i;
  const selectRe = /<select([^>]*)>([\s\S]*?)<\/select>/gi;
  let m;
  const candidates = [];
  while ((m = selectRe.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const options = [];
    let selectedValue = null;
    const optRe = /<option([^>]*?)>([^<]*)<\/option>/gi;
    let oM;
    while ((oM = optRe.exec(inner)) !== null) {
      const oAttrs = oM[1];
      const label = oM[2].trim();
      const valM = oAttrs.match(/value=["']([^"']+)["']/i);
      if (!valM) continue;
      const isSelected = /\bselected\b/i.test(oAttrs);
      options.push({ value: valM[1], label });
      if (isSelected) selectedValue = valM[1];
    }

    // 옵션 중 월코드 형식이 하나라도 있으면 후보
    const hasMonthCode = options.some(o => monthCodeRe.test(o.value) || monthCodeRe.test(o.label));
    if (hasMonthCode && options.length > 0) {
      candidates.push({ name, options, selectedValue, optionCount: options.length });
    }
  }

  // 옵션 많은 것 우선 (가장 풀세트인 드롭다운이 period일 가능성 ↑)
  candidates.sort((a, b) => b.optionCount - a.optionCount);
  return candidates[0] || null;
}

const MONTH_NAME_TO_NUM = {
  JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12
};

function parsePeriodCode(code) {
  if (!code) return null;
  // 형식 1: MAY26, JUN26
  let m = /^([A-Z]{3})(\d{2})$/.exec(code);
  if (m) {
    const mn = MONTH_NAME_TO_NUM[m[1].toUpperCase()];
    if (mn) return { year: 2000 + parseInt(m[2]), month: mn };
  }
  // 형식 2: 2026-06-01|2026-06-30 또는 2026-06 등 (CrewConnex 최신 형식)
  m = /^(\d{4})-(\d{1,2})/.exec(code);
  if (m) {
    const mn = parseInt(m[2]);
    if (mn >= 1 && mn <= 12) return { year: parseInt(m[1]), month: mn };
  }
  return null;
}

// MicrosoftAjax 부분 응답에서 HTML 추출 (UpdatePanel 응답)
function extractFromAjaxResponse(text) {
  // 형식: "길이|타입|이름|content|길이|타입|이름|content|..."
  if (!text || text.length < 10) return text;
  if (!/^\d+\|[a-zA-Z]+\|/.test(text)) return text; // 일반 HTML이면 그대로
  const out = [];
  let i = 0;
  while (i < text.length) {
    const pipe1 = text.indexOf('|', i);
    if (pipe1 < 0) break;
    const len = parseInt(text.slice(i, pipe1), 10);
    if (isNaN(len)) break;
    const pipe2 = text.indexOf('|', pipe1 + 1);
    if (pipe2 < 0) break;
    const type = text.slice(pipe1 + 1, pipe2);
    const pipe3 = text.indexOf('|', pipe2 + 1);
    if (pipe3 < 0) break;
    const content = text.slice(pipe3 + 1, pipe3 + 1 + len);
    if (type === 'updatePanel' || type === 'pageRedirect') out.push(content);
    i = pipe3 + 1 + len + 1;
  }
  return out.length > 0 ? out.join('\n') : text;
}

async function fetchPeriod(postUrl, jar, referer, allHidden, ddlName, periodValue, userName) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // 전략 1: 표준 ASP.NET postback (X-Requested-With 없이 = 전체 HTML 응답 받기)
  const trySimplePost = async () => {
    const body = new URLSearchParams();
    Object.entries(allHidden).forEach(([k, v]) => body.set(k, v));
    body.set('__EVENTTARGET', ddlName);
    body.set('__EVENTARGUMENT', '');
    body.set('__LASTFOCUS', '');
    body.set(ddlName, periodValue);

    const r = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': jarStr(jar),
        'Referer': referer,
        'Origin': BASE,
      },
      body: body.toString(),
      redirect: 'follow',
    });
    updateJar(jar, getSetCookies(r));
    return { r, raw: await r.text() };
  };

  let attempt = await trySimplePost();
  if (!attempt.r.ok) return { error: `HTTP ${attempt.r.status}`, status: attempt.r.status };

  // MicrosoftAjax 형식이면 HTML 추출, 아니면 그대로
  let html = extractFromAjaxResponse(attempt.raw);
  let result = parseRosterToSchedules(html, userName);

  // 만약 0건이고 응답이 짧으면 GET (URL parameter) 한 번 더 시도
  if (result.schedules.length === 0 && attempt.raw.length < 50000) {
    try {
      const urlWithParam = postUrl + (postUrl.includes('?') ? '&' : '?') + `period=${periodValue}`;
      const r2 = await fetch(urlWithParam, {
        method: 'GET',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Cookie': jarStr(jar), 'Referer': referer },
        redirect: 'follow',
      });
      updateJar(jar, getSetCookies(r2));
      if (r2.ok) {
        const html2 = await r2.text();
        const result2 = parseRosterToSchedules(html2, userName);
        if (result2.schedules.length > 0) { html = html2; result = result2; }
      }
    } catch (_) {}
  }

  if (result.schedules.length === 0) {
    const tableCount = (html.match(/<table/gi) || []).length;
    const isAjax = /^\d+\|[a-zA-Z]+\|/.test(attempt.raw);
    return {
      error: 'no_schedules_parsed',
      htmlLength: attempt.raw.length,
      extractedLength: html.length,
      tableCount,
      ajaxFormat: isAjax,
      finalUrl: attempt.r.url,
      snippet: attempt.raw.slice(0, 300),
    };
  }
  const parsed = parsePeriodCode(periodValue);
  if (parsed) {
    const monthStr = `${parsed.year}-${String(parsed.month).padStart(2,'0')}`;
    result.schedules.forEach(s => { s.month = monthStr; });
  }
  return { ...result, html };
}

/* ───────── Netlify Handler ───────── */

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  const ok = body => ({ statusCode: 200, headers: cors, body: JSON.stringify(body) });
  const fail = (code, msg) => ({ statusCode: code, headers: cors, body: JSON.stringify({ error: msg }) });

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') return fail(405, 'Method Not Allowed');

  let username, password, userName;
  try { ({ username, password, userName } = JSON.parse(event.body || '{}')); }
  catch { return fail(400, '잘못된 요청'); }
  if (!username || !password) return fail(400, '아이디/비밀번호를 입력해 주세요');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const jar = {};
  const H = (extra = {}) => ({
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
    'Cookie': jarStr(jar),
    ...extra,
  });

  try {
    // 1) 로그인 페이지 fetch
    const r0 = await fetch(`${BASE}/`, { headers: H(), redirect: 'follow' });
    updateJar(jar, getSetCookies(r0));
    const loginHtml = await r0.text();

    // 2) 폼 정보 추출
    const actionM = loginHtml.match(/<form[^>]+action=["']([^"']*)["']/i);
    const postUrl = (actionM && actionM[1])
      ? new URL(actionM[1], r0.url).href
      : `${BASE}/default.aspx`;

    const inputs = {};
    const iRe = /<input([^>]*)>/gi;
    let iM;
    while ((iM = iRe.exec(loginHtml)) !== null) {
      const attrs = iM[1];
      const nm = (attrs.match(/\bname=["']([^"']+)["']/i) || [])[1];
      const tp = (attrs.match(/\btype=["']([^"']+)["']/i) || ['', 'text'])[1].toLowerCase();
      const val = (attrs.match(/\bvalue=["']([^"']*)["']/i) || ['', ''])[1];
      if (nm) inputs[nm] = { type: tp, value: val };
    }

    const userField = Object.keys(inputs).find(k => {
      const t = inputs[k].type, kl = k.toLowerCase();
      return (t === 'text' || t === 'email') &&
        (kl.includes('user') || kl.includes('id') || kl.includes('emp') ||
          kl.includes('login') || kl.includes('name') || kl.includes('nm') || kl.includes('acc'));
    }) || Object.keys(inputs).find(k => {
      const t = inputs[k].type;
      return (t === 'text' || t === 'email') && !inputs[k].value;
    }) || 'username';
    const pwField = Object.keys(inputs).find(k => inputs[k].type === 'password') || 'password';

    const postBody = new URLSearchParams();
    postBody.set(userField, username);
    postBody.set(pwField, password);
    for (const [k, v] of Object.entries(inputs)) {
      if (v.type === 'hidden') postBody.set(k, v.value);
    }

    // submit 버튼 자동 추가
    const submitRe = /<input([^>]+)>/gi;
    let sbM;
    while ((sbM = submitRe.exec(loginHtml)) !== null) {
      const attrs = sbM[1];
      const tp = (attrs.match(/\btype=["']([^"']+)["']/i) || ['', ''])[1].toLowerCase();
      const nm = (attrs.match(/\bname=["']([^"']+)["']/i) || [])[1];
      const val = (attrs.match(/\bvalue=["']([^"']*)["']/i) || ['', 'Login'])[1];
      if ((tp === 'submit' || tp === 'image') && nm) { postBody.set(nm, val || 'Login'); break; }
    }

    // 3) 로그인 POST
    const r1 = await fetch(postUrl, {
      method: 'POST',
      headers: H({ 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': r0.url, 'Origin': BASE }),
      body: postBody.toString(),
      redirect: 'manual',
    });
    updateJar(jar, getSetCookies(r1));

    if (r1.status === 401 || r1.status === 403) {
      return fail(401, '로그인 실패 — 아이디/비밀번호를 확인해 주세요');
    }

    // 4) 메인 페이지로 이동
    let mainUrl;
    const loc1 = r1.headers.get('location') || '';
    if (r1.status >= 300 && r1.status < 400) {
      mainUrl = new URL(loc1, r0.url).href;
    } else {
      const r1Body = await r1.text();
      if (/invalid|incorrect|실패|오류|틀린|없는|만료|wrong|fail/i.test(r1Body)) {
        return fail(401, '로그인 실패 — 아이디/비밀번호를 확인해 주세요');
      }
      // 본문에 바로 roster가 있을 수도
      const direct = parseRosterToSchedules(r1Body, userName);
      if (direct.schedules.length > 0) return ok(direct);
      const jsM = r1Body.match(/(?:location\.href|location\.replace|window\.location)\s*=\s*["']([^"']+)["']/);
      if (jsM) mainUrl = new URL(jsM[1], r0.url).href;
      if (!mainUrl) {
        const metaM = r1Body.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]*;\s*url=([^\s"']+)/i);
        if (metaM) mainUrl = new URL(metaM[1], r0.url).href;
      }
      if (!mainUrl) mainUrl = BASE;
    }

    const r2 = await fetch(mainUrl, { headers: H({ 'Referer': r0.url }), redirect: 'follow' });
    updateJar(jar, getSetCookies(r2));
    const mainHtml = await r2.text();

    const mainTitle = (mainHtml.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    if (r2.url.includes('login') || /login|로그인/i.test(mainTitle)) {
      return fail(401, '로그인 실패 — 아이디/비밀번호를 확인해 주세요');
    }

    // 5) Roster 페이지 fetch + 여러 달 수집
    const directPaths = ['/roster.aspx', '/roster.do', '/crew/roster', '/main/roster'];
    let firstFetch = null;
    let rosterUrl = null;

    for (const path of directPaths) {
      const url = BASE + path;
      const fetched = await tryFetchRoster(url, jar, r2.url, userName);
      if (fetched) { firstFetch = fetched; rosterUrl = url; break; }
    }

    // 직접 경로 실패 시 메인페이지 링크 검색
    if (!firstFetch) {
      const findUrl = (html) => {
        let m = html.match(/href=["']([^"'#][^"']*(?:roster|checkin|check-in|pairing|schedule)[^"']*)["']/i);
        if (m) return m[1];
        return null;
      };
      const rel = findUrl(mainHtml);
      if (rel) {
        const url = rel.startsWith('http') ? rel : BASE + (rel.startsWith('/') ? rel : '/' + rel);
        const fetched = await tryFetchRoster(url, jar, r2.url, userName);
        if (fetched) { firstFetch = fetched; rosterUrl = url; }
      }
    }

    // 그래도 없으면 메인 페이지에서 직접 파싱
    if (!firstFetch) {
      const mainParsed = parseRosterToSchedules(mainHtml, userName);
      if (mainParsed.schedules.length > 0) {
        if (mainParsed.meta.monthDetected) {
          const mm = mainParsed.meta.monthDetected;
          const ms = `${mm.year}-${String(mm.month).padStart(2,'0')}`;
          mainParsed.schedules.forEach(s => { s.month = ms; });
        }
        return ok({ schedules: mainParsed.schedules, meta: [mainParsed.meta] });
      }
      return fail(404, `로그인은 성공했지만 Roster 페이지를 찾지 못했습니다.\n현재 페이지: ${r2.url}\n제목: ${mainTitle}`);
    }

    // 첫 fetch 성공 → 가능한 모든 달 수집
    const allSchedules = [...firstFetch.schedules];
    const allMeta = [firstFetch.meta];
    const debugLog = [];
    debugLog.push(`초기 fetch: ${firstFetch.schedules.length}건, URL=${firstFetch.finalUrl}`);

    let allHidden = extractAllHiddenInputs(firstFetch.rawHtml);
    const formAction = getFormAction(firstFetch.rawHtml, firstFetch.finalUrl);
    const ddl = findPeriodDropdown(firstFetch.rawHtml);

    if (!ddl) {
      debugLog.push(`Period 드롭다운 못 찾음 — hidden 입력: ${Object.keys(allHidden).join(",")}`);
    } else {
      debugLog.push(`Period 드롭다운: name=${ddl.name}, 옵션=${ddl.options.length}개 [${ddl.options.map(o=>o.value).join(",")}], 선택=${ddl.selectedValue}`);
    }
    debugLog.push(`Form action URL: ${formAction}`);
    debugLog.push(`__VIEWSTATE 길이: ${(allHidden.__VIEWSTATE||"").length}`);

    if (ddl && allHidden.__VIEWSTATE) {
      // 현재 선택된 옵션의 월·연도 파싱 → 미래 달만 fetch (과거는 스킵)
      const curParsed = parsePeriodCode(ddl.selectedValue);
      const curYM = curParsed ? curParsed.year * 12 + curParsed.month : null;
      const otherOptions = ddl.options
        .filter(o => o.value !== ddl.selectedValue)
        .map(o => ({ ...o, parsed: parsePeriodCode(o.value) }))
        .filter(o => {
          if (!curYM || !o.parsed) return true; // 못 파싱하면 일단 시도
          const optYM = o.parsed.year * 12 + o.parsed.month;
          return optYM >= curYM; // 현재월 이후만 (과거 제외)
        })
        .slice(0, 2); // 안전: 최대 2개 추가 → 3달 총합 (현재 + 다음 + 다다음)
      debugLog.push(`다른 달 시도: ${otherOptions.map(o=>o.value).join(", ") || "(없음 — 모두 과거)"}`);
      for (const opt of otherOptions) {
        try {
          const result = await fetchPeriod(formAction, jar, firstFetch.finalUrl, allHidden, ddl.name, opt.value, userName);
          if (result.error) {
            debugLog.push(`[${opt.value}] 실패: ${result.error} (rawLen=${result.htmlLength||0}, extLen=${result.extractedLength||0}, tables=${result.tableCount||0}, ajax=${result.ajaxFormat?'O':'X'}, finalURL=${result.finalUrl||''})`);
            if (result.snippet) debugLog.push(`  └ 응답 일부: ${result.snippet.replace(/\n/g,' ').slice(0,200)}`);
          } else if (result.schedules && result.schedules.length > 0) {
            allSchedules.push(...result.schedules);
            allMeta.push(result.meta);
            debugLog.push(`[${opt.value}] ✓ ${result.schedules.length}건 수집`);
            // 다음 POST를 위해 hidden 입력 갱신
            allHidden = extractAllHiddenInputs(result.html);
          } else {
            debugLog.push(`[${opt.value}] 응답은 받았으나 스케줄 0건`);
          }
        } catch (e) {
          debugLog.push(`[${opt.value}] 예외: ${e.message}`);
        }
      }
    }

    // 중복 제거
    const seen = new Set();
    const finalSchedules = [];
    allSchedules.forEach(s => {
      const k = `${s.month}|${s.day}|${s.type}|${s.title}`;
      if (!seen.has(k)) { seen.add(k); finalSchedules.push(s); }
    });

    const months = [...new Set(finalSchedules.map(s => s.month).filter(Boolean))].sort();

    return ok({
      schedules: finalSchedules,
      meta: allMeta,
      months,
      debug: debugLog, // 클라이언트 콘솔에서 확인 가능
    });

  } catch (e) {
    return fail(500, `서버 오류: ${e.message}`);
  }
};
