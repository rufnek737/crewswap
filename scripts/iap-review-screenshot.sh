#!/bin/bash
# 인앱 구입 '심사용 스크린샷'을 App Store Connect가 받는 규격으로 맞춘다.
#
# 앱 목록에 쓰는 스크린샷(1290x2796 등)과 규격이 다르다. 심사용은 640x920이
# 확실히 통과한다. 폰에서 잘라 찍은 캡처는 세로가 어중간해 그대로는 거부된다.
#
# 비율은 유지하고 남는 부분을 흰색으로 채운다 — 늘려 맞추면 글자가 뭉개진다.
# 투명도가 있으면 거부되므로 JPEG로 내보낸다.
#
#   ./scripts/iap-review-screenshot.sh <입력이미지> [출력경로]

set -euo pipefail

SRC="${1:?사용법: $0 <입력이미지> [출력경로]}"
OUT="${2:-${SRC%.*}-iap-review.jpg}"
W=640
H=920

[ -f "$SRC" ] || { echo "파일이 없습니다: $SRC" >&2; exit 1; }

TMP="$(mktemp -t iap-review).png"
trap 'rm -f "$TMP"' EXIT

# 두 변이 모두 들어가도록 축소한다. 긴 변만 맞추면(resampleHeightWidthMax)
# 세로가 긴 캡처에서 폭이 넘쳐 좌우가 잘린다.
SRC_W=$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/{print $2}')
SRC_H=$(sips -g pixelHeight "$SRC" | awk '/pixelHeight/{print $2}')
if [ $((SRC_W * H)) -gt $((SRC_H * W)) ]; then
  sips --resampleWidth "$W" "$SRC" --out "$TMP" >/dev/null   # 가로가 더 넉넉함 → 폭에 맞춤
else
  sips --resampleHeight "$H" "$SRC" --out "$TMP" >/dev/null  # 세로가 더 넉넉함 → 높이에 맞춤
fi
sips --padToHeightWidth "$H" "$W" --padColor FFFFFF "$TMP" --out "$TMP" >/dev/null
sips -s format jpeg -s formatOptions 90 "$TMP" --out "$OUT" >/dev/null

echo "✅ $OUT"
sips -g pixelWidth -g pixelHeight -g format "$OUT" | tail -3
echo "   $(du -h "$OUT" | cut -f1)"
