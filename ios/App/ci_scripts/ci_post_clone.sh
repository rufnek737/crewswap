#!/bin/sh
# Xcode Cloud 전용 — 저장소를 받은 직후에 돌아간다.
#
# ⚠️ 이 파일은 반드시 Xcode 프로젝트와 같은 디렉터리(ios/App/ci_scripts/)에 있어야 한다.
#    저장소 루트에 두면 Xcode Cloud가 찾지 못하고 조용히 건너뛴다(빌드 59에서 그랬다).
#
# node_modules/ 와 www/ 는 gitignore 대상이라 클론에는 없다. 그래서 Capacitor 플러그인
# (Swift Package)을 못 찾고 "package ... doesn't exist in file system" 으로 실패한다.

set -e
REPO="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$REPO"
echo "▶ repo: $REPO"

if ! command -v node >/dev/null 2>&1; then
  echo "▶ node 설치"
  brew install node
fi
node --version
npm --version

npm ci
sh scripts/build-web.sh
npx cap sync ios

echo "✅ ci_post_clone 완료 — node_modules $(ls node_modules | wc -l | tr -d ' ')개"
