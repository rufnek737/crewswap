(function attachReleaseNotice(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CrewSwapReleaseNotice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReleaseNoticeApi() {
  const SEEN_RELEASE_KEY = "crewswap_seen_release";

  const current = Object.freeze({
    id: "1.1.4-20260821",
    version: "1.1.4",
    date: "2026.08.21",
    title: "CrewSwap v1.1.4 업데이트",
    summary: "실제 회사 이메일 인증을 적용했습니다.",
    changes: Object.freeze([
      "회사 이메일 인증 적용",
      "인증 코드 노출 제거",
      "가입·비밀번호 재설정 개선",
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

  function isReleaseAnnouncement(item) {
    if (!item || item.kind !== "announce") return false;
    return Boolean(
      item.releaseVersion ||
      /^release-/.test(String(item.id || "")) ||
      /업데이트/.test(String(item.title || ""))
    );
  }

  // 새 버전 공지를 등록할 때 이전 버전 공지만 제거한다.
  // 사용 안내·Q&A와 요청/매칭/마감 알림은 그대로 보존한다.
  function keepLatestAnnouncement(alerts, release = current) {
    const latest = announcement(release);
    const preserved = (Array.isArray(alerts) ? alerts : []).filter(item => !isReleaseAnnouncement(item));
    return latest ? [latest, ...preserved] : preserved;
  }

  return {
    SEEN_RELEASE_KEY,
    current,
    shouldShow,
    markSeen,
    announcement,
    isReleaseAnnouncement,
    keepLatestAnnouncement,
  };
});
