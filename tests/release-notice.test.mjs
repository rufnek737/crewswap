import test from "node:test";
import assert from "node:assert/strict";
import releaseNotice from "../release-notice.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("shows a release once and shows again when the release id changes", () => {
  const storage = new MemoryStorage();
  assert.equal(releaseNotice.shouldShow(storage), true);
  assert.equal(releaseNotice.markSeen(storage), true);
  assert.equal(releaseNotice.shouldShow(storage), false);

  const nextRelease = { ...releaseNotice.current, id: "1.1.2-20260801" };
  assert.equal(releaseNotice.shouldShow(storage, nextRelease), true);
});

test("keeps the current release notes in the announcement list", () => {
  const item = releaseNotice.announcement();
  assert.equal(item.kind, "announce");
  assert.match(item.title, /2027년 9월 30일까지 모든 기능 무료/);
  assert.match(item.body, /급구 쿠폰 매달 1장/);
  // 버전을 여기 박아두면 올릴 때마다 깨진다. 모듈이 말하는 값과 같은지만 본다.
  assert.equal(item.releaseVersion, releaseNotice.current.version);
});

test("replaces old update notices while preserving all other alerts", () => {
  const alerts = [
    { id: "release-1.0.0", kind: "announce", title: "🆕 CrewSwap v1.0.0 업데이트", releaseVersion: "1.0.0" },
    { id: "legacy-update", kind: "announce", title: "CrewSwap 기능 업데이트" },
    { id: "guide", kind: "announce", title: "📢 CrewSwap 사용 안내" },
    { id: "qna", kind: "announce", title: "❓ 자주 묻는 질문 (Q&A)" },
    { id: "match-1", kind: "match", title: "매칭 알림" },
    { id: "urgent-1", kind: "urgent", title: "마감 알림" },
  ];

  const result = releaseNotice.keepLatestAnnouncement(alerts);
  const updates = result.filter(releaseNotice.isReleaseAnnouncement);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, `release-${releaseNotice.current.id}`);
  assert.deepEqual(
    result.filter(item => !releaseNotice.isReleaseAnnouncement(item)).map(item => item.id),
    ["guide", "qna", "match-1", "urgent-1"],
  );
});

// 「What's New」 팝업 — 버전별 항목 목록. 새 버전마다 맨 위에 항목을 더하고 id 를 바꾼다.
test("What's New lists the current version first and carries a fresh id", () => {
  const wn = releaseNotice.whatsNew;
  assert.ok(wn.items.length >= 2);
  assert.equal(wn.items[0].version, wn.version);
  assert.match(wn.id, new RegExp(wn.version.replace(/\./g, "\\.")));
  for (const item of wn.items) {
    assert.ok(item.icon && item.title && item.body);
  }
});

test("What's New is hidden only after '다시 보지 않기' and returns for the next version", () => {
  const storage = new MemoryStorage();
  const wn = releaseNotice.whatsNew;
  assert.equal(releaseNotice.shouldShow(storage, wn), true);
  releaseNotice.markSeen(storage, wn);
  assert.equal(releaseNotice.shouldShow(storage, wn), false);
  assert.equal(releaseNotice.shouldShow(storage, { ...wn, id: "whatsnew-9.9.9" }), true);
});
