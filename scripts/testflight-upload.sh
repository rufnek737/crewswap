#!/bin/bash
# TestFlight 업로드 — Archive → IPA 내보내기 → App Store Connect 업로드까지.
#
# 이 스크립트는 업로드까지만 한다. 업로드된 빌드는 어느 테스트 그룹에도 들어가지 않으므로
# 테스터에게 메일·푸시가 나가지 않는다. 배포(= 그룹에 '빌드 추가')는 App Store Connect에서
# 사람이 직접 하기로 한 약속이다 — 그 순간 외부 테스터 전원에게 메일이 발송되기 때문.
#
# 사용법:  ./scripts/testflight-upload.sh [빌드번호]
#          빌드번호를 주면 그 값으로 올리고, 생략하면 현재 프로젝트 설정값을 그대로 쓴다.

set -euo pipefail

cd "$(dirname "$0")/.."

KEY_ID="PD2TJSVAU4"
ISSUER_ID="b355e8a8-97a7-4aa3-8823-ead588bc796a"
KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"

if [ ! -f "$KEY_FILE" ]; then
  echo "❌ App Store Connect API 키가 없습니다: $KEY_FILE"
  exit 1
fi

# 빌드 번호 지정 시 프로젝트에 반영 (App Store Connect는 같은 번호를 재사용할 수 없다)
if [ $# -ge 1 ]; then
  NEW_BUILD="$1"
  sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = ${NEW_BUILD};/g" \
    ios/App/App.xcodeproj/project.pbxproj
fi

BUILD_NO=$(grep -m1 -E "CURRENT_PROJECT_VERSION = [0-9]+;" ios/App/App.xcodeproj/project.pbxproj \
  | sed -E 's/.*= ([0-9]+);/\1/')
VERSION=$(grep -m1 -E "MARKETING_VERSION = " ios/App/App.xcodeproj/project.pbxproj \
  | sed -E 's/.*= ([0-9.]+);/\1/')

echo "▶ CrewSwap ${VERSION} (${BUILD_NO}) 업로드 준비"

# 웹 자산을 네이티브 번들로 동기화 (www는 gitignore 대상이라 매번 복사해야 한다)
cp app.js styles.css sw.js index.html www/
npx cap sync ios > /dev/null

ARCHIVE="build/CrewSwap-${VERSION}-${BUILD_NO}.xcarchive"
EXPORT_DIR="build/export-${VERSION}-${BUILD_NO}"
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p build

echo "▶ Archive 생성 중..."
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates archive > /dev/null

cat > build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>V6TT3SA8H9</string>
  <key>uploadSymbols</key><true/>
  <key>signingStyle</key><string>automatic</string>
</dict>
</plist>
PLIST

# 서명은 Xcode에 로그인된 Apple 계정으로 한다.
# API 키(App Manager)로 클라우드 서명을 시도하면 인증서 생성 권한이 없어
# "No signing certificate iOS Distribution found"로 실패한다. API 키는 업로드에만 쓴다.
echo "▶ IPA 내보내는 중..."
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist build/ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates > /dev/null

IPA=$(find "$EXPORT_DIR" -name "*.ipa" | head -1)
[ -z "$IPA" ] && { echo "❌ IPA를 찾을 수 없습니다"; exit 1; }

echo "▶ App Store Connect 업로드 중..."
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"

echo ""
echo "✅ 업로드 완료 — CrewSwap ${VERSION} (${BUILD_NO})"
echo "   Apple 처리에 10~30분 걸립니다."
echo "   ⚠️ 아직 어떤 그룹에도 배포되지 않았습니다(테스터 메일 안 나감)."
echo "   테스터에게 보내려면 App Store Connect에서 직접 '빌드 추가'를 하세요."
