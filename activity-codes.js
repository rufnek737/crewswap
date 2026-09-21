/* 근무 유형을 근무표가 들고 온 코드표로 판정한다.
 *
 * CrewConnex 근무표 맨 아래에는 `Activity Code Descriptions` 표가 있고, 그 달에 실제로
 * 쓰인 코드와 뜻이 함께 실려 온다. 예전에는 코드 문자열을 앱에 박아두고 맞히려 했는데,
 * 회사가 코드를 추가할 때마다 조용히 틀렸다 — RSV_F·SIM1·S_L+U 를 차례로 놓쳤다.
 * 뜻은 근무표가 알려주므로 추측할 필요가 없다.
 *
 * 다만 표를 맹신하지는 않는다. 26년 6월 객실 근무표에는 2일에 SAC16 이 찍혀 있는데
 * 그 달 코드표에는 SAC16 이 없었다. 그래서 표에 없는 코드는 접두사로 넘겨짚되,
 * 그때는 확신도를 낮춰 돌려준다.
 */
(function attachActivityCodes(root) {
  /* 코드표 블록을 뜯어 코드 → 설명 사전을 만든다.
     헤더 다음부터 `CODE  설명` 꼴의 줄을 모은다. 설명에는 한글·괄호·날짜가 섞여 있다. */
  function parseDescriptions(text) {
    const out = new Map();
    const body = /Activity\s+Code\s+Descriptions([\s\S]*)$/i.exec(String(text || ""));
    if (!body) return out;
    for (const line of body[1].split(/\r?\n/)) {
      const m = /^\s*([A-Z][A-Z0-9_+]{1,9})\s{2,}(.+?)\s*$/.exec(line);
      if (!m) continue;
      if (/^code$/i.test(m[1])) continue;           // 헤더 줄
      out.set(m[1].toUpperCase(), m[2].trim());
    }
    return out;
  }

  /* 설명 문구로 근무 유형을 가린다. 영문·한글 표기가 섞여 있어 둘 다 본다.
     순서가 중요하다 — "Home Standby" 는 "Standby" 보다 먼저 걸러야 한다. */
  const BY_DESCRIPTION = [
    [/day\s*off/i,                          { type: "OFF",  title: "OFF", crewComposition: "편조 없음" }],
    [/vacation|휴가/i,                       { type: "VAC",  title: "휴가", crewComposition: "비행 아님 · 근태" }],
    [/layover/i,                            { type: "LAYOV" }],
    [/schedule\s*hold|비행불가/i,             { type: "VAC",  title: "미확정", crewComposition: "비행 아님 · 임시 근무코드",
                                              lockReason: "회사가 잡아둔 임시 코드 — 최종 스케줄로 바뀝니다. SWAP 불가" }],
    [/home\s*standby|자택\s*대기/i,           { type: "STBY", title: "자택대기", standby: "자택",
                                              crewComposition: "대기 · 편조 미정" }],
    [/reserve/i,                            { type: "RSV",  title: "RSV", crewComposition: "대기 · 편조 미정" }],
    [/standby|공항\s*대기|대기근무/i,          { type: "STBY", title: "공항대기", standby: "공항",
                                              crewComposition: "대기 · 편조 미정" }],
    [/simulator|LOFT|UPRT|\bOPC\b|\bLPC\b/i, { type: "GND",  ground: "SIM", title: "SIM 훈련",
                                              crewComposition: "비행 아님 · 회사 지정 근무",
                                              lockReason: "SIM 훈련 — 비행 아님, SWAP 불가" }],
    [/training|훈련|\bCRM\b/i,               { type: "GND",  ground: "훈련", title: "훈련",
                                              crewComposition: "비행 아님 · 회사 지정 근무",
                                              lockReason: "훈련 — 비행 아님, SWAP 불가" }],
    [/office\s*duty|사무/i,                  { type: "GND",  ground: "지상", title: "지상근무",
                                              crewComposition: "비행 아님 · 회사 지정 근무",
                                              lockReason: "지상근무 — 비행 아님, SWAP 불가" }],
    [/DH\s*by|deadhead/i,                   { type: "GND",  ground: "DH", title: "DH 이동",
                                              crewComposition: "비행 아님 · 이동",
                                              lockReason: "DH 이동 — 비행 아님, SWAP 불가" }],
  ];

  /* 코드표에 없는 코드를 접두사로 넘겨짚는다. 근무표가 알려주지 않을 때만 쓴다.
     객실은 SAC/SBC/SDC(공항대기)·HSC(자택대기)·TR_(훈련) 계열을 쓴다. */
  const BY_CODE = [
    [/^OFF$/i,               "DAY OFF"],
    [/^VAC/i,                "Regular Vacation"],
    [/^LAYOV/i,              "Layover"],
    [/^HSC\d*$/i,            "Home Standby"],
    [/^(SAC|SBC|SDC|SA|SB|SD)\d+$/i, "Airport Standby"],
    [/^STBY$/i,              "Standby"],
    [/^RSV(_[A-Z]+)?$/i,     "Reserve"],
    [/^(TR_|GRD|TRN)/i,      "Ground Training"],
    [/^(S_|SIM|OPC|LPC)/i,   "Simulator"],
    [/^JCRM$/i,              "Joint CRM"],
    [/^OFC$/i,               "Office Duty"],
    [/^(TAXI|AIR)$/i,        "DH by"],
    [/^(SCHLD|SICKHD)$/i,    "Schedule Hold"],
  ];

  function fromDescription(desc) {
    for (const [re, shape] of BY_DESCRIPTION) if (re.test(desc)) return shape;
    return null;
  }

  /* code 하나를 유형으로 옮긴다.
     - 근무표 코드표에 있으면 그 설명을 근거로 판정한다(source: "roster").
     - 없으면 접두사로 넘겨짚는다(source: "guess") — 호출한 쪽이 신중히 쓰도록 표시한다.
     - 둘 다 안 되면 null. 기존 판정 로직으로 넘어간다. */
  function classify(code, descriptions) {
    const key = String(code || "").toUpperCase().trim();
    if (!key) return null;

    const desc = descriptions instanceof Map ? descriptions.get(key) : (descriptions || {})[key];
    if (desc) {
      const shape = fromDescription(desc);
      if (shape) return { ...shape, activityCode: key, description: desc, source: "roster" };
    }
    for (const [re, fallbackDesc] of BY_CODE) {
      if (!re.test(key)) continue;
      const shape = fromDescription(fallbackDesc);
      if (shape) return { ...shape, activityCode: key, description: desc || null, source: "guess" };
    }
    return null;
  }

  /* 하루치 토큰 중 첫 번째로 알아보는 코드를 판정한다. 편명(숫자만)은 건너뛴다. */
  function classifyTokens(tokens, descriptions) {
    for (const t of tokens || []) {
      if (/^\d+$/.test(t)) continue;
      const hit = classify(t, descriptions);
      if (hit) return hit;
    }
    return null;
  }

  const api = { parseDescriptions, classify, classifyTokens };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CrewSwapActivityCodes = api;
})(typeof window !== "undefined" ? window : globalThis);
