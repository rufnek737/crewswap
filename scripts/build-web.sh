#!/bin/bash
# 루트의 웹 자산을 www/ 로 모은다. Capacitor가 www/ 를 네이티브 번들로 복사하므로
# 앱에 들어가는 것은 언제나 이 폴더다.
#
# 손으로 복사하던 것을 스크립트로 옮겼다. 파일명을 하나씩 적으면 새 모듈을 더할 때마다
# 빠뜨리고, 그러면 네이티브 빌드에서만 그 스크립트가 404가 나 "폰에서만 안 된다"로
# 나타난다. package.json 같은 빌드용 파일만 빼고 통째로 가져온다.

set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf www
mkdir -p www

for f in *.html *.css *.js *.png *.jpg *.mp4 *.json; do
  [ -e "$f" ] || continue
  case "$f" in
    package.json|package-lock.json|capacitor.config.json) continue ;;
  esac
  cp "$f" www/
done

# 앱이 부팅할 때 반드시 있어야 하는 것들 — 하나라도 없으면 흰 화면이 된다.
for required in index.html app.js styles.css sw.js manifest.json; do
  [ -f "www/$required" ] || { echo "❌ www/$required 가 없습니다"; exit 1; }
done

echo "✅ www/ 준비 완료 ($(ls www | wc -l | tr -d ' ')개 파일)"
