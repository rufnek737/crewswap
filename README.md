# CrewSwap — 제주항공 승무원 스케줄 스왑 앱

제주항공 승무원 전용 스케줄 스왑 매칭 앱 (베타)  
Netlify 서버리스 + Netlify Blobs 기반 풀스택 웹앱

---

## 현재 구현 범위

### 핵심 기능
- CrewConnex 자동 로그인 → 스케줄 파싱 (Netlify Function)
- 월간 달력 기반 스케줄 표시 + 패턴 선택
- 회사 룰 사전 체크 (편조 기준·기종·EDTO·CAT III·마감·승무시간·연속근무)
- WARN 항목 확인 팝업 후 등록 진행
- 양방향 스왑 등록 (내놓는 패턴 + 원하는 조건)
- **공유 스왑 글** — Netlify Blobs에 저장, 테스터 간 실시간 공유
- 동일 등급·직책·기종 자동 필터 + 매칭 점수 정렬
- 스왑 요청 / 양도 의향 묻기
- 요청함 3단계 (발송 → 상호 수락 → 회사 상신)
- 알림 개별 삭제 / 모두 삭제 (새로고침 후에도 유지)

### 인증
- 제주항공 이메일(@jejuair.net) 인증 (HMAC 서명 토큰, stateless)
- RESEND_API_KEY 없을 때 **테스트 모드** — 코드 화면 직접 표시
- 회원 탈퇴 → 서버 포스트 삭제 + localStorage 초기화

### 기술 스택
| 구분 | 내용 |
|---|---|
| 프론트엔드 | Vanilla HTML/CSS/JS (SPA) |
| 배포 | Netlify (정적 호스팅 + Functions) |
| 서버리스 함수 | Node.js (Netlify Functions v1) |
| 공유 데이터 저장소 | Netlify Blobs (`posts` store) |
| 이메일 발송 | Resend API (선택, 없으면 테스트 모드) |
| 로컬 데이터 | localStorage (`jjswap_v1` v3 스키마) |

---

## 개발 환경 셋업 (신규 머신)

### 공통 (첫 클론 시)
```bash
git clone https://github.com/rufnek737/crewswap.git
cd crewswap
npm install

# www/ 폴더 생성 (gitignore라 클론 시 없음)
mkdir www
cp index.html styles.css app.js sw.js manifest.json \
   icon-192.png icon-512.png splash.mp4 splash-poster.jpg www/
```

### Android (Windows / macOS)
```bash
# 필수: Android Studio 설치
npx cap sync android
npx cap open android
# → Android Studio에서 ▶ Run
```

### iOS (macOS 전용)
```bash
# 필수: Xcode 설치
npm install @capacitor/ios
npx cap add ios
npx cap sync ios
npx cap open ios
# → Xcode에서 Signing & Capabilities > Team 설정 후 ▶ Run

# 아이콘 교체 (최초 1회)
sips -z 1024 1024 icon-512.png \
  --out ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

### 코드 수정 후 매번
```bash
cp index.html styles.css app.js www/   # 수정한 파일만

# Android
npx cap sync android   # Android Studio ▶ Run

# iOS
npx cap sync ios       # Xcode ▶ Run
```

### Cloudflare Workers (백엔드 수정 시)
```bash
cd worker
npx wrangler deploy   # https://crewswap-api.tae26001.workers.dev
```

---

## 로컬 개발 (웹 버전)

```bash
npm install
netlify dev          # http://localhost:8889
```

---

## Netlify Functions

| 함수 | 역할 |
|---|---|
| `send-verify` | @jejuair.net 이메일 인증 코드 발송 |
| `check-verify` | 인증 코드 검증 (HMAC) |
| `crewconnex` | CrewConnex 자동 로그인 + 스케줄 파싱 |
| `posts-get` | 공유 스왑 글 목록 조회 |
| `posts-create` | 스왑 글 등록 (Netlify Blobs 저장) |
| `posts-delete` | 스왑 글 삭제 (deleteToken 검증) |

---

## Work Log

### 2026-06-21 — 안드로이드 버그 수정 + 스왑 찾기 카드 렌더링 버그 수정

#### 월 경계 스케줄 선택 버그
- `selectedDays`를 `Set<number>`에서 `Set<"YYYY-MM-DD">` 형식으로 변경 → 월 정보 포함
- `connectedPatternDaysAllMonths()` 신설 — 6월말→7월초 연결 패턴을 단일 클릭으로 전체 선택
- 월 전환 시 `selectedDays.clear()` 제거 → 월 경계 패턴 선택 유지
- `selectPattern()`, `selectedSchedules()`, `doSubmitPost()` 등 관련 함수 전면 업데이트

#### 안드로이드 하단 시스템 내비바 가림 문제
- `@media (max-width: 720px)` 내 `.bottom-tabs`에서 `bottom: 8px` → `bottom: max(8px, env(safe-area-inset-bottom))`
- `.app` padding-bottom을 `max(110px, calc(80px + env(safe-area-inset-bottom)))` 으로 변경 → 내비바 높이만큼 자동 확장

#### 스왑 찾기 매칭 카드 미표시 버그 (근본 원인 수정)
- **증상**: `#matchSummary`는 "4건의 매칭 가능 글" 표시, `#matchList`는 empty-state 문구 표시 (모순)
- **원인**: `matchScore()` 객실 경로가 `{ score, breakdown }` 반환 (PILOT 경로는 `{ total, breakdown, dDay }`)
  - 카드 템플릿이 `score.dDay` 접근 시 `undefined` → `dd.days` 에서 TypeError 발생
  - `#matchSummary`는 throw 전에 이미 업데이트됨 → 두 요소가 모순된 상태로 표시
- **수정**: 객실 경로를 PILOT 경로와 동일한 반환 형식으로 통일 (`total`, `dDay` 추가, 마감 임박 가중치·신뢰도 보너스·방향 변환 점수 적용)

#### 스왑 찾기 필터 접기/펼치기 기능 추가
- 필터 패널 상단에 "필터 접기 ▲ / 필터 펼치기 ▼" 토글 버튼 추가
- 필터 접으면 매칭 카드 목록이 화면 상단에 바로 노출됨 (모바일 UX 개선)

#### 가입 시 직군 (조종사/객실 승무원) 저장 안 되는 버그
- 가입 폼 submit 핸들러가 `#crewTypeInput` 프로필 폼 동기화 누락
- 가입 완료 후 `crewTypeInput.value = state.user.crewType` + `updateRoleSelectForCrewType(...)` 호출 추가

---

### 2026-06-18 — iOS 셋업 및 UI 버그 수정

#### macOS iOS 개발 환경 셋업
- `/Users/kaymac/crewswap` 경로에 클론 (작업 기준 경로)
- `@capacitor/ios` 설치 + `npx cap add ios` → Xcode 워크스페이스 생성
- Signing & Capabilities: Bundle ID `com.rufnek.crewswap.app`, Personal Team 설정
- 앱 아이콘: `icon-512.png` → 1024×1024 업스케일 후 `AppIcon.appiconset` 교체
- iOS 빌드 및 iPhone 실기기 설치 완료

#### iOS 동기화 워크플로 확정
```bash
# 코드 수정 후 매번
cp index.html styles.css app.js www/
npx cap sync ios
# Xcode ▶ Run
```

#### 스플래시 버튼 겹침 수정
- 원인: `splash.mp4` 영상 자체에 로그인/회원가입 버튼이 포함되어 HTML 버튼과 이중 렌더링
- `splash-screen::after` 그라디언트 오버레이(하단 40%)로 영상 속 버튼 가림
- `gap: 3%` → `gap: 12px` 고정값으로 변경 (% gap이 column 방향에서 의도치 않게 동작)
- `poster` 속성 제거 (이전 포스터 이미지에도 버튼 포함)
- 근본 해결: 버튼 없는 새 `splash.mp4`로 교체 (Windows에서 제작 후 git push)

#### 화면 레이아웃 모바일 최적화
- `viewport-fit=cover` 추가 → iPhone 노치/Dynamic Island 안전 영역 처리
- `.app`: `padding-top/left/right`에 `env(safe-area-inset-*)` 적용
- `.bottom-tabs`: `bottom`에 `max(18px, env(safe-area-inset-bottom))` 적용
- `@media (max-width: 720px)`: `body/app overflow-x: hidden`, 달력 `min-width: 0` 해제

#### 회원가입 모달 iOS 전체 수정
- `<dialog>` → `<div>` 기반 커스텀 모달로 교체
  - iOS WKWebView top layer에서 `<dialog>`는 CSS/JS width 제어 불가 확인
  - `#signupOverlay` (dim 배경) + `#signupPanel` (모달 본체) 분리
- `.signup-dialog`: `position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%)` + `width: calc(100vw - 32px); max-width: 480px; background: #fff`
- `openSignupModal()` / `closeSignupModal()` 헬퍼 함수로 열기/닫기 통일
- iOS 배경 스크롤 잠금: `body.no-scroll { position: fixed; width: 100%; }` + 모달 열릴 때 클래스 추가/제거

---

### 2026-06-17 (3차)

#### 스플래시 자동 종료 버그 근본 수정
- 화면 녹화로 확인: 비디오 재생 완료 시 `video.ended` → `hideSplash()` 자동 호출되어 스플래시 사라지고 메인 앱 진입
- `<video loop>` 속성 추가 + `ended` 이벤트 핸들러 완전 제거 → 비디오 루프 재생, 로그인/회원가입 버튼 클릭 시에만 진입

### 2026-06-17 (2차)

#### 안드로이드 앱 버그 수정
- **앱 아이콘** — Python PIL로 전 mipmap 밀도(mdpi~xxxhdpi) 아이콘 생성 및 교체
- **하단 탭 텍스트 줄바꿈** — 이모지가 10px 폰트에서도 16~20px로 렌더링되어 텍스트 밀어냄 → 이모지 제거, `white-space: nowrap` 추가
- **스왑 등록 버튼 레이아웃** — `post-footer-btns`에 `flex-wrap: wrap` 적용, 광고 버튼 `flex: 0 0 100%`로 단독 행 배치
- **서비스 워커 캐시 문제** — `sw.js`의 cache-first 전략이 APK 업데이트 후에도 구버전 `app.js` 서빙 → Capacitor 네이티브 환경에서 SW 등록 비활성화 및 기존 SW `getRegistrations().unregister()` 강제 해제, 캐시 버전 `v1→v2`

#### Cloudflare Workers 백엔드 이전
- Netlify 크레딧 초과(06-08 이후 배포 불가, 18일 리셋 예정) → 백엔드 전체를 Cloudflare Workers로 이전
- `worker/index.js` 신규 작성 — 6개 엔드포인트(`send-verify/check-verify/posts-get/posts-create/posts-delete/crewconnex`) Node.js 없이 Web Crypto API + KV 기반으로 구현
- `worker/wrangler.toml` 설정, KV 네임스페이스 `POSTS` 생성 (id: `7da2a6e5ee7143fcab6834bf9ba92a17`)
- `npx wrangler deploy` → `https://crewswap-api.tae26001.workers.dev` 배포 완료
- `app.js` `API_BASE` 단일 Workers URL로 통일 (네이티브/웹 분기 제거)
- 이메일 미설정 시 테스트 모드: 서버 응답 코드를 입력란에 자동 입력

#### Capacitor 기반 Android 네이티브 앱 전환
- `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` 설치, `cap init` (appId: `com.crewswap.app`)
- 웹 자산 전용 `www/` 폴더 분리 (`webDir: '.'`은 `android/`·`node_modules/` 등을 끌고 들어가 불가 → `www`로 변경), `.gitignore`에 추가
- `npx cap add android` + `npx cap sync android` → Android Studio에서 `android/` 프로젝트 오픈 확인
- `app.js`: `API_BASE` 상수 추가 — 네이티브 앱(`Capacitor.isNativePlatform()`)에서는 Netlify Functions 호출을 `https://crewswap.netlify.app`로 절대경로 처리 (웹 배포본은 기존 상대경로 유지), `posts-get/posts-create/posts-delete/send-verify/check-verify/crewconnex` 7개 fetch 호출 수정

### 2026-06-16

#### 아이콘 / 스플래시 / 로그인-회원가입 활성화
- 신규 브랜드 아이콘 적용 (`icon-192.png`/`icon-512.png`, 텍스트 없는 심볼 버전으로 최종 교체)
- 8초 영상 스플래시 화면 추가 (`splash.mp4` + 포스터 프레임), `#splashScreen` 오버레이 + `initSplash()`
- 스플래시 내 로그인/회원가입 버튼을 기존 가입 모달(`signupPanel`)에 연결 — 신규/기존 사용자 분기 처리

### 2026-06-15

#### 회사 룰 원본 규정 텍스트 (▼ 규정 보기)
- `checkRulesCabin()` 전 항목에 `ref` 필드 추가 (Swap Guide p.47-49 및 객실 백과사전 기준)
- `checkRulesForSelection()` (조종사) 전 항목에 `ref` 필드 추가 (항공법·편조기준·EDTO)
- `renderRuleCheck()` 에서 ref 있는 항목 클릭 시 원문 펼치기/접기 (▼ 규정 보기 토글)

#### 연속근무 / 달력 버그 수정
- `calcCumulative()`: OFF만 제외하던 로직 → `NON_DUTY_TYPES = new Set(["OFF","VAC","VAC_A","VAC_P"])` 도입, VAC도 연속근무 초기화
- `renderCalendar()` routeText: `dep === arr` 시 "GMP-GMP" 미표시 (OFF/VAC 잔존 오류 수정)

#### 스왑 찾기 필터 개선
- **유형 복수선택**: `state.filters.type(string)` → `state.filters.types(array)` 변경
  - "전체" 클릭 시 초기화, 개별 유형 클릭 시 토글, 복수 선택 가능
- **퇴근 시간대 필터** 추가 (`arrTimeFilter` select):
  - 새벽 도착 제외 (~06시) / 정오 전 복귀 / 18시 전 복귀
- **출근 시간대 필터** 구현 (`timeFilter`): 오전(~10시) / 오후 / 야간

#### UI / 등록 폼
- 스왑 등록 폼 광고 버튼 하단(post-footer-btns)으로 이동
- 내 정보 크레딧 섹션에 광고 버튼 추가 (`watchAdButtonProfile`) 및 이벤트 연결
- "CrewConnex 불러오기" → "CrewConnex 자동로그인"
- "방향 변환" → "스왑 방향 (내가 내놓는 것 → 원하는 것)" 설명 추가
- "포함 공항" → "선호 공항"
- "이번 달 내" 날짜 옵션 제거, 기본값 "날짜 무관"

### 2026-06-09

#### 제주항공 객실 승무원 지원 (JEJU_CABIN)
- `RULES.JEJU_CABIN` 활성화 — Swap Guide PDF 기반 규정 전체 반영
  - D-3 영업일 마감, 연속 7일 제한, RSV 다음날 OFF 불가, UV_ML 불가
  - 월 2회 / 연 12회 스왑 한도
- 객실 직급 체계 추가: CC / AP / PS / SP / CP (AABB 형식, 연차 분리)
- `checkRulesCabin()` 신설 — 조종사 룰과 분리된 객실 전용 사전 체크
  - 방송등급 미보유 시 RSV·STBY 변경 FAIL (규정 5.아)
  - 월/연 스왑 횟수 한도 FAIL/WARN
  - STBY/RSV 직급 조건 WARN (동일 or 상위)
  - 6일 연속 근무 랜딩 20:00 / Base별 휴식시간 / 노선 언어·성별 자격 항상 WARN
- 스왑 횟수 카운팅 로직 수정: 게시글 등록 시 → **상호 수락(매칭 성사) 시**로 변경
  - `recordSwapMatch()` 함수 추가 (수락 버튼 구현 시 연결)

#### 객실 승무원 회원 가입 / 프로필
- 직군 선택 시 역할 선택지 조종사 ↔ 객실 동적 전환 (`updateRoleSelectForCrewType`)
  - `new Option()` 생성자 방식으로 브라우저 호환성 문제 해결
- 객실 전용 자격 필드 추가 (가입 + 내 정보)
  - 성별 (여성/남성) — MNL 노선 남성 필수 안내에 활용
  - 언어 자격: 일본어 전공 / 중국어 전공 / 일본어 방송(Ann_JA) / 중국어 방송(Ann_CA)
  - 방송등급 보유 여부 (체크 시 RSV·STBY 제한 해제)
- `syncFormsFromState()` — 복원 시 성별·방송등급·언어 자격 폼 자동 복원

#### 상단 네비게이션 / 매칭 UI
- 객실 승무원 로그인 시 NG/MAX · EDTO/CAT III 뱃지 숨김
- 스왑 찾기: 객실은 직책 무관하게 동일 항공사 객실 게시글 전체 노출
- 객실 목 게시글 5건 추가 (C-001~C-005 / CC·AP·PS 혼합)
- 카드 "상대 유형" — 객실 직책 레이블 정상 표시 (`CABIN_ROLE_LABELS` fallback)
- `exposureCount()` / `candidateCountForOffered()` 객실 기준 집계

#### 내 정보 메트릭
- 연속 근무 바: 객실은 7일 기준으로 표시
- 스왑 횟수 바: 객실은 `월 X/2회 · 연 X/12` 형태로 표시

#### 기타 버그 수정
- CrewConnex 로그인 팝업 Enter 키 → 팝업 닫힘 현상 수정
- RSV/STBY 부분 선택 FAIL 오탐 수정 (인접 미선택 패턴만 체크)
- 동일 스케줄 중복 등록 방지 (등록 버튼 클릭 시 기존 글 날짜 중복 체크)
- localStorage v3 업그레이드 — v1/v2 스왑 카운트 오염 데이터 자동 무효화
- 기본 스왑 카운트 초기값 0으로 수정 (기존 mock 1/3 제거)

### 2026-06-08
- 앱 리브랜딩: JJ Swap → **CrewSwap**
  - 앱 이름·타이틀·헤더·가입 팝업 전체 교체
  - 가입 팝업 설명 "제주항공 승무원 스케줄 매칭" → "승무원 스케줄 스왑 매칭" (범용)
  - 주색상 `#e44832`(빨강) → `#2B9FD9`(하늘색), `--primary-dark` #1A7BAC
  - PWA manifest `theme_color` + 아이콘(192/512) 하늘색으로 재생성
  - SW 캐시명 `jjswap-v1` → `crewswap-v1`
  - localStorage 키(`jjswap_v1`) 유지 — 기존 사용자 데이터 보존
- 이메일 인증 Netlify 배포 환경 에러 수정
  - 원인: `RESEND_API_KEY` 설정 시 미인증 도메인(`jjswap.app`)으로 발송 시도 → 403
  - 수정: `RESEND_API_KEY` + `RESEND_FROM` **둘 다** 설정된 경우에만 실제 발송
  - `RESEND_FROM` 없으면 테스트 모드 자동 폴백 (화면에 코드 표시)
  - 이메일 템플릿 JJ Swap → CrewSwap, 색상 하늘색 적용

### 2026-06-07
- Netlify Blobs 기반 공유 포스트 저장/조회/삭제 구현
  - `posts-get / posts-create / posts-delete` Functions 추가
  - `fetchPosts()` — 스왑 찾기 탭 진입 시 자동 로드
  - 등록 시 `airline / ownerRole / deleteToken / region` 포함
  - 취소 시 서버 포스트도 함께 삭제
- 알림 삭제 기능 추가
  - 각 알림 개별 × 버튼
  - 패널 헤더 "모두 삭제" 버튼
  - 삭제 상태 localStorage 영속화
- "데이터 삭제" → "회원 탈퇴" 로 개편
  - 헤더에서 제거 → 내 정보 탭 하단 이동
  - 탈퇴 시 서버 포스트 삭제 + 상태 초기화 + 가입 팝업 재표시
- `package.json` + `netlify.toml` external_node_modules 설정

### 이전 작업
- CrewConnex 자동 로그인 파서 (Netlify Function)
- 제주항공 이메일 인증 (HMAC stateless, 테스트 모드 지원)
- 회사 룰 사전 체크 엔진 (편조·기종·EDTO·마감·승무시간 등)
- WARN 항목 확인 팝업
- 알림 배지 / 등록 중인 내 글 관리
- GitHub 연동 (https://github.com/rufnek737/crewswap)

---

## 남은 작업 (다음 세션)

### 배포
- Netlify 크레딧 17일 리셋 후 재배포 (netlify.toml 수정 이미 완료 — blobs fix)
- 배포 후 Netlify Blobs 실환경 동작 확인

### 객실 승무원 기능
- CrewConnex 파서 객실 대응: AABB 직급 형식 + Qualification 필드(Japanese/Chinese/Ann_JA/Ann_CA) 파싱
- 상호 수락 버튼 구현 → `recordSwapMatch()` 연결
- SCHLD 스케줄 타입 스왑 차단 처리
- VAC_A / VAC_P 스왑 가능 여부 확인 (VAC와 동일 취급 여부)

### 공통
- 실제 이메일 발송 도메인 인증 (Resend — `RESEND_API_KEY` + `RESEND_FROM`)
- 테스터 모집 후 실사용 피드백 수집
- 타 항공사(대한항공·아시아나·티웨이 등) 이메일 인증 추가 (추후)
