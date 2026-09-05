(function attachReleaseNotice(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CrewSwapReleaseNotice = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createReleaseNoticeApi() {
  const SEEN_RELEASE_KEY = "crewswap_seen_release";

  // 출시 기념 무료 기간 안내. 유료화를 시작할 때(BETA_ALL_PREMIUM="false") 이 항목을
  // 다음 릴리스 노트로 교체한다 — 무료가 끝났는데 무료라고 알리고 있으면 안 된다.
  //
  // 내용을 고치면 id도 반드시 바꿀 것. 표시 여부는 id로만 판단해서(shouldShow),
  // id가 같으면 이미 본 사람에게는 고친 내용이 영영 안 뜬다.
  //
  // -r2: 예전에는 '확인'만 눌러도 봤음으로 기록해서, 그때 기록이 남은 사람에게는
  // '다시 보지 않기' 체크박스를 붙인 뒤에도 공지가 뜨지 않았다. 한 번 초기화한다.
  const current = Object.freeze({
    id: "launch-free-20270930-r2",
    version: "1.1.9",
    date: "2026.09.05",
    title: "출시 기념 · 2027년 9월 30일까지 모든 기능 무료",
    summary: "정식 출시를 기념해 2027년 9월 30일까지 PRO 기능과 급구 쿠폰을 무료로 드립니다.",
    changes: Object.freeze([
      "PRO 기능 전원 무료 — 조건 알림, 무제한 크레딧, 편조구성원 미리보기",
      "급구 쿠폰 매달 1장 자동 지급",
      "급구에 응해 근무를 내주면 쿠폰 1장 추가 지급",
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
      body: `${release.summary}\n\n${details}`,
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
