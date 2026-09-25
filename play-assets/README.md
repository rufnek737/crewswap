# Play Console 업로드 자료

Play Console 에 올리는 이미지다. **저장소에 둔다** — 예전에 `/tmp/shots` 에만 두었다가
macOS 가 `/tmp` 를 비우면서 통째로 잃었다.

| 파일 | 용도 | 규격 |
|---|---|---|
| `icon-512.png` | 앱 아이콘 | 512×512 |
| `play-feature-graphic.png` | 그래픽 이미지(상단 배너) | 1024×500 |
| `screenshot-1~5.png` | 휴대전화 스크린샷 | 1080×1920 (9:16) |

스크린샷은 App Store Connect 에 올려둔 iPhone 컷(1320×2868)을 내려받아 Play 규격으로
맞춘 것이다. 원본은 세로가 너무 길어(1:2.17) Play 가 받지 않을 수 있으므로, 폭을 1080 에
맞춰 줄이고 위아래를 화면 배경색으로 채웠다.

다시 만들려면 ASC 의 `appScreenshots` → `imageAsset.templateUrl` 로 내려받아
`{w}`·`{h}`·`{f}` 를 채우면 된다.
