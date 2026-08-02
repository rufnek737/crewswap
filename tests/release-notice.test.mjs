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
  assert.match(item.title, /v1\.1\.1/);
  assert.match(item.body, /블루그레이 배경/);
  assert.equal(item.releaseVersion, "1.1.1");
});
