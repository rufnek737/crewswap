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
    id: "launch-free-20270930-r4",
    version: "1.3.1",
    date: "2026.09.23",
    title: "듀티스왑 모든 기능 무료",
    summary: "PRO 기능과 급구 쿠폰을 포함한 모든 기능을 무료로 쓰실 수 있습니다.",
    changes: Object.freeze([
      "PRO 기능 전원 무료 — 조건 알림, 무제한 크레딧",
      "급구 쿠폰 매달 1장 자동 지급",
      "급구에 응한 승무원은 회사 상신 완료 시 쿠폰 0.5장 보상",
    ]),
  });

  // 앱을 열 때 뜨는 「What's New」. 버전별 항목을 최신순으로 쌓는다(아이콘 + 제목 + 한두 줄).
  // 새 버전을 낼 때 맨 위에 항목을 더하고 id 를 그 버전으로 바꾼다 — id 가 그대로면
  // 「다시 보지 않기」를 누른 사람에게는 새 항목이 안 뜬다.
  // 위의 current 는 공지함(알림 목록)에 남는 출시 기념 안내로, 이 팝업과는 따로 간다.
  const whatsNew = Object.freeze({
    id: "whatsnew-1.3.1",
    version: "1.3.1",
    date: "2026.11.22",
    // 주요 기능만 남긴다(2026-11-22 Kay) — 버그 수정·작은 개선은 싣지 않는다.
    items: Object.freeze([
      Object.freeze({ version: "1.3.1", icon: "🎉", title: "모든 기능 무료",
        body: "PRO 기능(조건 알림·무제한 크레딧)과 급구 쿠폰까지 모든 기능을 무료로 쓰실 수 있어요." }),
      Object.freeze({ version: "1.3.1", icon: "✨", title: "사용 편의성 향상",
        body: "스왑하기와 알림받기 화면을 더 간단하게 바꿨어요. 키워드로 찾거나 모든 스케줄을 바로 볼 수 있어요." }),
      Object.freeze({ version: "1.3.0", icon: "👥", title: "친구 탭",
        body: "사번이나 실명으로 친구를 추가하고, 수락하면 서로 전체 스케줄을 볼 수 있습니다." }),
      Object.freeze({ version: "1.2.8", icon: "🔍", title: "가입 전에도 스왑 글 확인",
        body: "가입하지 않아도 올라온 스왑 글의 날짜·편명·체크인/아웃을 볼 수 있어요." }),
      Object.freeze({ version: "1.2.6", icon: "🔔", title: "나만의 편조 알림",
        body: "최대 2명을 등록해 두면, 그분과 같은 편조가 되는 스왑을 확정 전에 알려드려요." }),
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

  // 같은 문구를 두 번 보이지 않는다(2026-11-03 Kay): 일반 「버그 수정」은 최신 버전 것 하나만 둔다.
  // 「What's New」 팝업을 놓쳐도 공지 탭에서 다시 볼 수 있게 같은 내용을 공지로도 둔다.
  // 제목에 '업데이트'를 넣지 않는다 — isReleaseAnnouncement 가 그 낱말로 업데이트 공지를 골라 지운다.
  function whatsNewAnnouncement(notes = whatsNew) {
    if (!notes?.id) return null;
    return {
      id: "whatsnew",
      kind: "announce",
      title: `🆕 새 기능 안내 (${notes.version})`,
      date: notes.date,
      // 출시 기념 무료 안내는 공지 탭에 따로 있으므로 여기서는 뺀다.
      body: notes.items.filter(entry => entry.version !== "출시 기념").map(entry => `${entry.icon} [${entry.version}] ${entry.title}\n${entry.body}`).join("\n\n"),
      time: "공지",
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
    whatsNew,
    shouldShow,
    markSeen,
    announcement,
    whatsNewAnnouncement,
    isReleaseAnnouncement,
    keepLatestAnnouncement,
  };
});
