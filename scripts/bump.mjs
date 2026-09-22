#!/usr/bin/env node
/* 릴리스 번호를 한 번에 올린다.
 *
 * 손으로 올릴 곳이 다섯 군데다 — iOS 두 개, Android 두 개, 서비스 워커 캐시, 그리고
 * index.html·sw.js 의 자산 버전(`?v=`). 하나 빠뜨리면 조용히 어긋난다. 실제로 문구를
 * 고치고 캐시를 안 올려 예전 화면이 그대로 뜬 일이 두 번 있었다(2026-09-11, 09-21).
 *
 * 자산 버전은 파일마다 따로 세던 것을 캐시 번호 하나로 합친다. 파일별로 세면 "이 파일을
 * 고쳤으니 이 번호도 올려야지"를 사람이 기억해야 하는데, 그 기억이 실패한 것이 위 두 번이다.
 *
 * 쓰는 법
 *   node scripts/bump.mjs            빌드 번호·캐시만 올린다 (표시 버전 그대로)
 *   node scripts/bump.mjs 1.2.0      표시 버전까지 바꾼다
 *   node scripts/bump.mjs --dry      바꾸지 않고 무엇이 바뀔지만 보여준다
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const newVersion = args.find(a => /^\d+\.\d+\.\d+$/.test(a)) || null;

const PBXPROJ = 'ios/App/App.xcodeproj/project.pbxproj';
const GRADLE = 'android/app/build.gradle';

const read = p => readFileSync(join(ROOT, p), 'utf8');
const edits = [];
const stage = (path, text) => edits.push({ path, text });

/* ── 현재 번호 읽기 ───────────────────────────────── */
const pbx = read(PBXPROJ);
const iosBuild = Number(/CURRENT_PROJECT_VERSION = (\d+);/.exec(pbx)[1]);
const marketing = /MARKETING_VERSION = ([\d.]+);/.exec(pbx)[1];

const gradle = read(GRADLE);
const androidCode = Number(/versionCode (\d+)/.exec(gradle)[1]);

const sw = read('sw.js');
const cache = Number(/crewswap-v(\d+)/.exec(sw)[1]);

const version = newVersion || marketing;
const nextIos = iosBuild + 1;
const nextAndroid = androidCode + 1;
const nextCache = cache + 1;

/* ── 고치기 ───────────────────────────────────────── */
stage(PBXPROJ, pbx
  .replaceAll(`CURRENT_PROJECT_VERSION = ${iosBuild};`, `CURRENT_PROJECT_VERSION = ${nextIos};`)
  .replaceAll(`MARKETING_VERSION = ${marketing};`, `MARKETING_VERSION = ${version};`));

stage(GRADLE, gradle
  .replace(`versionCode ${androidCode}`, `versionCode ${nextAndroid}`)
  .replace(/versionName "[\d.]+"/, `versionName "${version}"`));

/* 자산 버전을 캐시 번호로 통일한다 — 파일마다 따로 세지 않는다. */
const retag = text => text
  .replaceAll(`crewswap-v${cache}`, `crewswap-v${nextCache}`)
  .replace(/\?v=[\d.]+/g, `?v=${nextCache}`);

stage('sw.js', retag(sw));
stage('index.html', retag(read('index.html')));

/* ── 보고 ─────────────────────────────────────────── */
console.log(`표시 버전   ${marketing}${version !== marketing ? ` → ${version}` : '  (그대로)'}`);
console.log(`iOS 빌드    ${iosBuild} → ${nextIos}`);
console.log(`Android     versionCode ${androidCode} → ${nextAndroid}`);
console.log(`웹 캐시     v${cache} → v${nextCache}  (자산 ?v= 도 ${nextCache} 로 통일)`);

if (dry) {
  console.log('\n--dry — 아무것도 바꾸지 않았다.');
} else {
  for (const { path, text } of edits) writeFileSync(join(ROOT, path), text);
  console.log('\n반영 완료. 다음: npm run build:web && npx cap sync');
}
