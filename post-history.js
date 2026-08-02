(function attachCrewSwapPostHistory(root) {
  function isRefundedHistory(post) {
    return !!post && (post.status === "expired" || post.refunded === true);
  }

  function remove(posts, postId) {
    return (posts || []).filter(post => post.id !== postId);
  }

  const api = { isRefundedHistory, remove };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapPostHistory = api;
})(typeof window !== "undefined" ? window : globalThis);
