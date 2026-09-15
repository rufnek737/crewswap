#!/bin/sh
# Xcode Cloud 전용 — 저장소를 받은 직후에 돌아간다.
#
# node_modules/ 와 www/ 는 gitignore 대상이라 클론에는 없다. 그래서 Xcode Cloud가
# Capacitor 플러그인(Swift Package)을 못 찾고 "package ... doesn't exist in file system"
# 으로 실패한다. 여기서 둘 다 만들어 준다.

set -e
cd "$CI_PRIMARY_REPOSITORY_PATH"

brew install node@22 >/dev/null 2>&1 || true
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

npm ci
sh scripts/build-web.sh
npx cap sync ios

echo "✅ ci_post_clone 완료"
