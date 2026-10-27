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
    version: "1.2.5",
    date: "2026.09.23",
    title: "출시 기념 · 2027년 9월 30일까지 모든 기능 무료",
    summary: "정식 출시를 기념해 2027년 9월 30일까지 PRO 기능과 급구 쿠폰을 무료로 드립니다.",
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
    id: "whatsnew-1.2.5",
    version: "1.2.5",
    items: Object.freeze([
      Object.freeze({ version: "1.2.5", icon: "🛠", title: "퀵턴·레이오버 구분 오류 수정",
        body: "연속된 일정에서 퀵턴과 레이오버를 정확히 구분하도록 고쳐 안정성을 높였습니다." }),
      Object.freeze({ version: "1.2.4", icon: "🛠", title: "버그 수정",
        body: "확인된 오류를 수정해 안정성을 높였습니다." }),
      Object.freeze({ version: "1.2.3", icon: "📱", title: "iPhone Duo 지원",
        body: "펼친 화면에서 달력과 고른 근무·회사 룰 체크를 나란히 봅니다. 아이패드 가로 화면도 같습니다." }),
      Object.freeze({ version: "1.2.2", icon: "🛠", title: "회사 룰 체크 정확도 개선",
        body: "다른 달의 비행이 섞이지 않도록, 고른 날짜에 걸치는 구간만 확인합니다. 월이 바뀌는 날의 앞뒤 근무도 함께 봅니다." }),
      Object.freeze({ version: "1.2.0", icon: "✈️", title: "듀티스왑으로 새 이름",
        body: "앱 이름을 「듀티스왑 DutySwap」으로 바꾸고, 회사 규정 확인을 최신 규정과 대조해 바로잡았습니다." }),
      Object.freeze({ version: "출시 기념", icon: "🎉", title: "2027년 9월 30일까지 모든 기능 무료",
        body: "PRO 기능 전원 무료 — 조건 알림, 무제한 크레딧. 급구 쿠폰은 매달 1장 자동 지급됩니다." }),
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
    whatsNew,
    shouldShow,
    markSeen,
    announcement,
    isReleaseAnnouncement,
    keepLatestAnnouncement,
  };
});
