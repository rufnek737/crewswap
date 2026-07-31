(function attachReleaseNotice(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CrewSwapReleaseNotice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReleaseNoticeApi() {
  const SEEN_RELEASE_KEY = "crewswap_seen_release";

  const current = Object.freeze({
    id: "1.1.0-20260731",
    version: "1.1.0",
    date: "2026.07.31",
    title: "CrewSwap v1.1.0 업데이트",
    summary: "스왑 규정 검증과 등록 글 관리 기능을 개선했습니다.",
    changes: Object.freeze([
      "객실승무원 휴식시간을 실제 출발·도착 기준으로 양쪽 일정에 검사합니다.",
      "스왑 첫 화면에서 내가 올린 글을 바로 확인하고 수정·취소할 수 있습니다.",
      "공개 달력과 비공개 검증 일정을 분리해 일정 개인정보 보호를 강화했습니다.",
    ]),
  });

  function shouldShow(storage, release = current) {
    if (!storage || !release?.id) return false;
    try {
      return storage.getItem(SEEN_RELEASE_KEY) !== release.id;
    } catch {
      return false;
    }
  }

  function markSeen(storage, release = current) {
    if (!storage || !release?.id) return false;
    try {
      storage.setItem(SEEN_RELEASE_KEY, release.id);
      return true;
    } catch {
      return false;
    }
  }

  function announcement(release = current) {
    if (!release?.id) return null;
    const details = (release.changes || []).map(change => `• ${change}`).join("\n");
    return {
      id: `release-${release.id}`,
      kind: "announce",
      title: `🆕 ${release.title}`,
      date: release.date,
      body: `${release.summary}\n\n${details}\n\n이 안내는 새 버전 최초 실행 시 한 번 표시되며, 이후에도 공지에서 다시 확인할 수 있습니다.`,
      time: "공지",
      releaseVersion: release.version,
    };
  }

  return {
    SEEN_RELEASE_KEY,
    current,
    shouldShow,
    markSeen,
    announcement,
  };
});
