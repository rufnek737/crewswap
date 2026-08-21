import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import selectionFlow from "../selection-flow.js";

function stateWithSelection() {
  return {
    selectedDays: new Set(["2026-08-17", "2026-08-18"]),
    selectionPurpose: "post",
    pendingRequestPostId: "POST-OLD",
    pendingRequestType: "ask",
  };
}

test("reset removes every transient schedule selection", () => {
  const state = stateWithSelection();
  selectionFlow.reset(state);
  assert.equal(state.selectedDays.size, 0);
  assert.equal(state.selectionPurpose, null);
  assert.equal(state.pendingRequestPostId, null);
  assert.equal(state.pendingRequestType, null);
});

test("starting a new request cannot reuse a previous post selection", () => {
  const state = stateWithSelection();
  selectionFlow.begin(state, "request", "POST-NEW");
  assert.equal(state.selectedDays.size, 0);
  assert.equal(state.selectionPurpose, "request");
  assert.equal(state.pendingRequestPostId, "POST-NEW");
  assert.equal(state.pendingRequestType, "request");
});

test("detaching a pending action preserves only its deliberate calendar choices", () => {
  const state = stateWithSelection();
  state.selectionPurpose = "ask";
  state.pendingRequestPostId = "POST-ASK";
  state.pendingRequestType = "ask";
  const pending = selectionFlow.detachPending(state);
  assert.deepEqual(pending, { postId: "POST-ASK", type: "ask" });
  assert.equal(state.selectedDays.size, 2);
  assert.equal(state.selectionPurpose, "ask");
  assert.equal(state.pendingRequestPostId, null);
});

test("the PRO alert page is separate from the normal swap result list", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const premium = html.match(/<section id="premiumAlerts"[\s\S]*?<\/section>/)?.[0] || "";
  const find = html.match(/<section id="find"[\s\S]*?<section id="post"/)?.[0] || "";

  assert.match(premium, /id="savedList"/);
  assert.doesNotMatch(premium, /swap-subtabs|id="matchList"/);
  assert.match(find, /id="matchList"/);
  assert.doesNotMatch(find, /id="savedList"|id="savedAddForm"/);
});

test("my swap management is separate from the post form", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const manager = html.match(/<section id="myPostsManager"[\s\S]*?<\/section>/)?.[0] || "";
  const post = html.match(/<section id="post"[\s\S]*?<section id="myPostsManager"/)?.[0] || "";

  assert.match(manager, /id="myPostList"/);
  assert.doesNotMatch(manager, /swap-subtabs|id="offeredSlot"|id="postMemo"/);
  assert.match(post, /id="offeredSlot"|id="postMemo"/);
  assert.doesNotMatch(post, /id="myPostList"/);
});

test("guided search exposes a direct all-schedules action", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="findGuideShowAll"[^>]*>[\s\S]*?모든 스케줄 보기/);
});

test("policy and contact links use the native-aware service link handler", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  assert.equal((html.match(/data-service-link="privacy"/g) || []).length, 2);
  assert.equal((html.match(/data-service-link="terms"/g) || []).length, 2);
  assert.match(html, /href="mailto:rufnek737@gmail\.com[^"]*" data-service-link="contact"/);
  assert.match(app, /Capacitor\.Plugins\.Browser\.open/);
  assert.match(app, /Capacitor\.Plugins\.AppLauncher\.openUrl/);
});

test("expired swap alerts open the independent my-posts manager", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /kind: "urgent",\s*goTo: "myPostsManager",\s*postId: p\.id/);
  assert.match(app, /a\.goTo === "myPostsManager" \|\| \(a\.kind === "urgent" && a\.title\?\.includes\("스왑 마감"\)\)/);
  assert.match(app, /openMyPostsManager\(\);\s*setAlertPanel\(false\);/);
});

test("the usage guide describes the current guided swap flow", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /1\. 내 근무 확인/);
  assert.match(app, /3\. 내 스왑 올리기/);
  assert.match(app, /4\. 요청과 의향 묻기/);
  assert.match(app, /8\. PRO 알림/);
  assert.match(app, /실명·사번·연락처는 상호 수락 후에만 공개/);
});

test("the final Q&A matches the current privacy, credit, and PRO policies", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /같은 날짜끼리 바로 교환할 수 있는 1:1 스왑은 제안한 근무만 보입니다/);
  assert.match(app, /상호 수락한 뒤에만 공개됩니다/);
  assert.match(app, /매월 첫 실행 시 기본 3크레딧으로 재설정/);
  assert.match(app, /매칭 없이 마감되면 사용한 크레딧의 50%가 자동 환급/);
  assert.match(app, /30일 동안 PRO 알림과 무제한 크레딧/);
  assert.match(app, /기간 종료 후 자동 결제되지 않으며/);
  assert.match(app, /월 2회·연 12회 한도/);
  assert.match(app, /PRO 정보와 크레딧은 서버 계정에 연결/);
});

test("client credit balance follows successful server wallet responses", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  assert.match(app, /api\/credits-status/);
  assert.match(app, /if \(data\.wallet\) applyCreditWallet\(data\.wallet\)/);
  assert.doesNotMatch(app, /CREDIT_POLICY\.spend\(state, 1, unlimitedCredits\)/);
  assert.match(html, /id="watchAdButton"[^>]*hidden/);
  assert.match(html, /id="watchAdButtonProfile"[^>]*hidden/);
});

test("swap restrictions are checked by rules without a calendar lock icon", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const selectPattern = app.match(/function selectPattern\(day\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.doesNotMatch(html, /🔒 스왑 불가/);
  assert.doesNotMatch(styles, /calendar-day\.is-locked|pill-locked/);
  assert.doesNotMatch(selectPattern, /if \(s\.lockReason\)/);
  assert.match(app, /const hasLocked = ss\.some\(s => s\.lockReason\)/);
  assert.match(app, /자격 갱신 지정 비행 포함 — SWAP 불가/);
});
