(function attachCrewSwapSelectionFlow(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CrewSwapSelectionFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSelectionFlowApi() {
  const PURPOSES = new Set(["post", "request", "ask"]);

  function reset(state) {
    state?.selectedDays?.clear?.();
    if (state) {
      state.selectionPurpose = null;
      state.pendingRequestPostId = null;
      state.pendingRequestType = null;
    }
    return state;
  }

  function begin(state, purpose, postId = null) {
    reset(state);
    if (!state || !PURPOSES.has(purpose)) return state;
    state.selectionPurpose = purpose;
    if (purpose === "request" || purpose === "ask") {
      state.pendingRequestPostId = postId;
      state.pendingRequestType = purpose;
    }
    return state;
  }

  function detachPending(state) {
    if (!state) return { postId: null, type: null };
    const pending = {
      postId: state.pendingRequestPostId || null,
      type: state.pendingRequestType || null,
    };
    state.pendingRequestPostId = null;
    state.pendingRequestType = null;
    return pending;
  }

  return { reset, begin, detachPending };
});
