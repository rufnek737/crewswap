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
  assert.match(item.title, /v1\.1\.8/);
  assert.match(item.body, /기기 간 크레딧 동기화/);
  assert.equal(item.releaseVersion, "1.1.8");
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
