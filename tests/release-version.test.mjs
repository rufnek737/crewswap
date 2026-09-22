// 릴리스 번호가 어긋나지 않는지 본다.
//
// 문구를 고치고 캐시를 안 올려 예전 화면이 그대로 뜬 일이 두 번 있었다(2026-09-11, 09-21).
// 사람의 기억 대신 테스트가 잡는다. 올릴 때는 `npm run bump`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const sw = read('sw.js');
const html = read('index.html');
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const gradle = read('android/app/build.gradle');

const cache = /crewswap-v(\d+)/.exec(sw)[1];

test('자산 버전이 모두 캐시 번호와 같다', () => {
  // 파일마다 따로 세면 "이 파일을 고쳤으니 이 번호도" 를 사람이 기억해야 한다.
  // 그 기억이 실패해서 캐시가 안 갱신됐다. 번호를 하나로 합쳐 둔다.
  for (const [label, text] of [['sw.js', sw], ['index.html', html]]) {
    const tags = [...new Set(text.match(/\?v=[\d.]+/g) || [])];
    assert.deepEqual(tags, [`?v=${cache}`], `${label} 의 자산 버전이 캐시 v${cache} 와 다르다`);
  }
});

test('sw.js 가 캐시하는 파일이 index.html 이 부르는 파일을 빠짐없이 담는다', () => {
  // 새 모듈을 index.html 에만 넣고 SHELL 에 안 넣으면 오프라인에서만 깨진다.
  const loaded = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
  for (const src of loaded) {
    assert.ok(sw.includes(`./${src}?v=`), `sw.js SHELL 에 ${src} 가 없다`);
  }
});

test('표시 버전이 iOS·Android 에서 같다', () => {
  // 빌드 번호는 스토어별 카운터라 달라도 되지만, 제품 버전은 하나여야 한다.
  const ios = /MARKETING_VERSION = ([\d.]+);/.exec(pbx)[1];
  const android = /versionName "([\d.]+)"/.exec(gradle)[1];
  assert.equal(ios, android);
});

test('빌드 번호는 스토어별로 따로 센다', () => {
  // 두 스토어의 카운터를 억지로 맞추려 들면 한쪽이 거절된다 — 되돌릴 수 없는 숫자다.
  assert.match(pbx, /CURRENT_PROJECT_VERSION = \d+;/);
  assert.match(gradle, /versionCode \d+/);
});
