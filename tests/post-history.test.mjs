import test from "node:test";
import assert from "node:assert/strict";
import postHistory from "../post-history.js";

test("only refunded or expired posts can be removed as history", () => {
  assert.equal(postHistory.isRefundedHistory({ status:"expired" }), true);
  assert.equal(postHistory.isRefundedHistory({ refunded:true }), true);
  assert.equal(postHistory.isRefundedHistory({ status:"active", refunded:false }), false);
});

test("history removal deletes only the selected record", () => {
  const posts = [{ id:"a" }, { id:"b" }];
  assert.deepEqual(postHistory.remove(posts, "a"), [{ id:"b" }]);
  assert.deepEqual(posts, [{ id:"a" }, { id:"b" }]);
});
