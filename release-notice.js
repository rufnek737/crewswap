(function attachReleaseNotice(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CrewSwapReleaseNotice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReleaseNoticeApi() {
  const SEEN_RELEASE_KEY = "crewswap_seen_release";

  const current = Object.freeze({
    id: "1.1.1-20260731",
    version: "1.1.1",
    date: "2026.07.31",
    title: "CrewSwap v1.1.1 업데이트",
    summary: "화면을 더 또렷하고 세련된 분위기로 다듬었습니다.",
    changes: Object.freeze([
      "블루그레이 배경의 대비를 높이고 제주항공 오렌지 포인트를 상단에 적용했습니다.",
      "일반 카드는 옅은 청회색으로, 달력과 입력 영역은 흰색으로 유지해 정보를 또렷하게 구분했습니다.",
      "하단 메뉴에 가벼운 반투명 효과와 입체적인 선택 표시를 적용했습니다.",
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
