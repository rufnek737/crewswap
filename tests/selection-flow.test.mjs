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
