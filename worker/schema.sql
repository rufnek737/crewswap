-- CrewSwap D1 스키마
-- KV 무료 플랜의 일일 쓰기 한도(1,000회)를 넘겨 인증·등록이 실패하던 문제로 D1로 이전한다.
-- D1 무료 한도는 하루 10만 행 쓰기라 같은 사용량에서 여유가 크다.
--
-- 설계: 기존 KV에 저장하던 JSON 문서를 그대로 data 컬럼에 보관하고,
-- 조회에 필요한 값만 별도 컬럼으로 꺼내 인덱싱한다. 레코드 모양이 그대로라
-- 앱·Worker의 기존 로직을 고쳐쓰지 않아도 되고, 목록 조회는 idx:* 캐시 키 대신
-- SQL로 처리해 "글 1건 변경마다 전체 목록을 다시 쓰던" 쓰기 증폭을 없앤다.

CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
  email TEXT PRIMARY KEY,
  data  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  owner_email TEXT,
  status      TEXT,
  data        TEXT NOT NULL,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_owner  ON posts(owner_email);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);

CREATE TABLE IF NOT EXISTS requests (
  id         TEXT PRIMARY KEY,
  post_id    TEXT,
  from_email TEXT,
  to_email   TEXT,
  data       TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_from ON requests(from_email);
CREATE INDEX IF NOT EXISTS idx_requests_to   ON requests(to_email);
CREATE INDEX IF NOT EXISTS idx_requests_post ON requests(post_id);

-- 교환 성립 검증용 비공개 로스터. 요청 완료·거절·삭제·탈퇴 시 함께 지운다.
CREATE TABLE IF NOT EXISTS request_validations (
  id   TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

-- PRO 저장검색 조건·푸시 구독 (기존 idx:premium-alert-subscribers 배열을 행으로 분리)
CREATE TABLE IF NOT EXISTS premium_alerts (
  email TEXT PRIMARY KEY,
  data  TEXT NOT NULL
);

-- 중복 제출 방지용 멱등 키. created_at으로 오래된 항목을 정리할 수 있다.
CREATE TABLE IF NOT EXISTS idempotency (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TEXT
);

-- Apple 구매 영수증 ↔ 계정 연결 (원본 트랜잭션당 1계정)
CREATE TABLE IF NOT EXISTS purchase_bindings (
  key   TEXT PRIMARY KEY,
  data  TEXT NOT NULL
);

-- CrewConnex로 불러온 내 근무 스케줄. 기존에는 기기 로컬(localStorage)에만 저장돼
-- 다른 기기·브라우저에서 같은 계정으로 로그인해도 보이지 않았다. 계정당 최신 상태
-- 하나만 보관(마지막에 저장한 기기 기준 last-write-wins)한다.
CREATE TABLE IF NOT EXISTS schedules (
  email      TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT
);
