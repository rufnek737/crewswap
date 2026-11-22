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
    version: "1.3.0",
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
    id: "whatsnew-1.3.0",
    version: "1.3.0",
    date: "2026.11.21",
    items: Object.freeze([
      Object.freeze({ version: "1.3.0", icon: "👥", title: "친구 탭",
        body: "사번이나 실명으로 친구를 추가하고, 수락하면 서로 전체 스케줄을 볼 수 있습니다." }),
      Object.freeze({ version: "1.3.0", icon: "🔄", title: "친구 스케줄에서 바로 스왑",
        body: "친구 스케줄을 보고 바로 스왑을 요청할 수 있습니다." }),
      Object.freeze({ version: "1.3.0", icon: "🛠", title: "오류 수정",
        body: "확인된 오류를 수정했습니다." }),
      Object.freeze({ version: "1.2.9", icon: "🎓", title: "지상 근무 표시 개선",
        body: "SIM 훈련과 지상 훈련을 구분해 보여 드려요. 훈련·지상근무는 회사 지정 근무라 스왑이 불가합니다." }),
      Object.freeze({ version: "1.2.9", icon: "🛠", title: "버그 수정",
        body: "확인된 오류를 수정해 안정성을 높였습니다." }),
      Object.freeze({ version: "1.2.8", icon: "🔍", title: "가입 전에도 올라온 근무 확인",
        body: "가입하지 않아도 앱 첫 화면에서 올라온 근무의 날짜·편명·체크인/아웃을 볼 수 있어요. 올린 사람·노선·희망 조건은 지금처럼 가입한 분만 볼 수 있어요. 아직 가입 안 한 동료에게 알려 주세요." }),
      Object.freeze({ version: "1.2.8", icon: "🎯", title: "날짜가 다른 교환도 쉽게",
        body: "상대와 날짜가 맞지 않아 상대 달력에서 바꿀 날을 고를 때, 내 일정이 비어 있고 휴식·모기지 기준을 통과하는 근무에 「추천」을 표시해 드려요. 요청이 오면 바로 알림이 가고, 2일 동안 답이 없으면 한 번 더 알려 드려요." }),
      Object.freeze({ version: "1.2.7", icon: "📢", title: "공지 탭에서 새 기능 안내",
        body: "이 안내를 놓쳐도 공지 탭에서 언제든 다시 볼 수 있어요." }),
      Object.freeze({ version: "1.2.6", icon: "🔔", title: "새 기능 「나만의 편조 알림」",
        body: "알림 받을 분을 최대 2명까지 등록해 두면, 그분과 같은 편조가 되는 스왑을 최종 확정 전에 알려드려요. 진행 여부는 직접 선택하실 수 있어요. 누구나 무료로 쓸 수 있어요." }),
      Object.freeze({ version: "1.2.5", icon: "🛠", title: "퀵턴·레이오버 구분 오류 수정",
        body: "연속된 일정에서 퀵턴과 레이오버를 정확히 구분하도록 고쳐 안정성을 높였습니다." }),
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
