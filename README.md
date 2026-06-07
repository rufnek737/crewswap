# JJ Swap — 제주항공 승무원 스케줄 스왑 앱

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
| 로컬 데이터 | localStorage (`jjswap_v1` v2 스키마) |

---

## 로컬 개발

```bash
npm install          # @netlify/blobs 설치 (최초 1회)
netlify dev          # http://localhost:8889
```

환경변수 설정 (Netlify 대시보드 → Site configuration → Environment variables):
| 변수 | 설명 |
|---|---|
| `VERIFY_SECRET` | HMAC 서명용 비밀 문자열 (필수) |
| `RESEND_API_KEY` | 실제 이메일 발송 키 (없으면 테스트 모드) |
| `RESEND_FROM` | 발신 주소 (RESEND 사용 시) |

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
- 로컬 테스트 완료 후 Netlify 배포
- 테스터 모집 후 실사용 피드백 수집
- 실제 이메일 발송을 위한 도메인 인증 (Resend)
