# CrewSwap — Claude 작업 규칙

## 「오늘 마무리 하자」

Kay가 「오늘 마무리 하자」(또는 비슷한 말: 마무리하자, 오늘 끝내자)라고 하면 아래를 한 번에 처리한다. 따로 묻지 않는다.

### 1. 바뀐 내용 정리
이번 세션에서 한 일을 `git log`·`git diff`로 확인하고(아직 커밋 안 한 변경 포함) 두 가지로 나눈다.
- **기록(문서)**: `README.md`, `OPEN_ITEMS.md`, `CLAUDE.md`
- **앱 코드**: 그 밖의 모든 파일(`app.js`, `worker/`, `index.html`, `styles.css`, `www/`, `ios/`, `android/`, `tests/` 등)

### 2. README Work Log 작성
- `README.md` 의 `## Work Log` 바로 아래에 `### YYYY-MM-DD — 한 줄 요약` + `- ` 항목들. 기존 항목과 같은 말투·길이로.
- 같은 날짜 항목이 이미 있으면 새로 만들지 말고 그 항목에 이어 적는다.
- 앱 코드 변경이 있으면 Work Log 에 **「PR #번호 — main 에 아직 안 합쳐짐」**을 적는다.
- 해결된 것은 `OPEN_ITEMS.md` 에서 지우고, 새로 남은 것은 적는다.

### 3. 기록은 main 에 바로 푸시 (Kay 허락: 2026-11-22)
- `git fetch origin main` 후 main 위에 **기록 파일만** 커밋해서 `git push origin HEAD:main`.
  (예: `git worktree add ../main-docs origin/main` → 기록 파일만 반영 → 커밋 → `git push origin HEAD:main`)
- 앱 코드 파일은 절대 main 에 직접 올리지 않는다.
- 푸시가 거절되면(main 이 앞서 감) 다시 fetch 해서 그 위에 올린다. 강제 푸시 금지.

### 4. 앱 코드 변경은 PR 로
- 앱 코드는 이 세션의 작업 브랜치에 커밋·푸시하고, main 대상 PR 을 만든다(합치지는 않는다 — Kay가 직접 확인 후 병합).
- PR 만들기 전에 작업 브랜치에 `origin/main` 을 merge 해서 3번의 기록 커밋과 충돌이 안 나게 한다.
- PR 본문: 무엇을 왜 바꿨는지, 테스트 결과, Mac 에서 할 일(Worker 배포·iOS 빌드·스토어 제출 등).
- 앱 코드 변경이 없으면 PR 은 만들지 않는다.

### 5. 보고
main 에 올린 커밋 해시, PR 링크(있으면), Work Log 에 적은 내용을 짧게 알려준다.

### 주의
- `DONATION_FROM_DESCENT.md` 처럼 커밋하지 않기로 한 파일, 비밀값(.env, 키)은 커밋하지 않는다.
- 클라우드 세션에서는 Worker 배포·iOS 빌드·기기 설치를 할 수 없다. 필요하면 Work Log·OPEN_ITEMS·PR 본문에 「Mac 에서 할 일」로 적는다.
- 바뀐 게 없으면 커밋하지 않고 그렇다고 말한다.
