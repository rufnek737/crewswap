/* ============================================================
   CrewSwap · 기획 프로토타입 v2
   - 양방향 등록, 패턴 띠, 매칭 점수, 룰 자동 계산
   ============================================================ */

/* ====== 1. 상수 ====== */
// 네이티브 앱(Capacitor)에서는 capacitor://localhost 등에서 로드되므로
// Netlify Functions를 절대경로로 호출해야 함. 웹(Netlify 배포)에서는 상대경로로 동작.
// Workers 배포 후 실제 URL로 교체: npx wrangler deploy 실행 후 출력된 URL
const API_BASE = "https://crewswap-api.tae26001.workers.dev";
// 앱 버전 표기 — 대부분의 앱처럼 '내 정보' 맨 아래에 버전과 배포일을 담백하게 보여준다.
// 문의가 들어왔을 때 어느 버전을 쓰는지 확인하는 용도이자, 새 빌드가 기기에 제대로
// 반영됐는지 판별하는 기준이기도 하다(빌드 번호는 Debug/Release가 공유해 구분이 안 됨).
// 코드를 배포할 때마다 날짜를 갱신할 것.
const APP_VERSION = "1.1.8";
const APP_RELEASE_DATE = "2026.08.28";
const PUBLIC_API_PATHS = new Set([
  "/api/send-verify", "/api/check-verify", "/api/user-signup", "/api/user-login",
  "/api/user-reset-password", "/api/posts-get", "/api/premium-alert-config",
]);
let _storeEnvironment = 'production';

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.sessionToken) headers.set("Authorization", `Bearer ${state.sessionToken}`);
  if (_storeEnvironment === 'sandbox') headers.set('X-CrewSwap-Store-Environment', 'sandbox');
  const response = await fetch(url, { ...options, headers });
  const path = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  if (response.status === 401 && !PUBLIC_API_PATHS.has(path)) {
    state.sessionToken = null;
    state.sessionExpiresAt = null;
    state.user.serverAuthed = false;
    saveState();
    setTimeout(() => openLoginModal(state.user.email || ""), 0);
    showToast("로그인이 만료되었습니다. 다시 로그인해주세요.");
  }
  return response;
}
const POLICY_VERSION = "2026-08-21";
const ROLE_LABELS = {
  CAPTAIN_C: "C등급 기장", CAPTAIN_B: "B등급 기장", CAPTAIN_A: "A등급 기장",
  FO_C: "C등급 부기장",   FO_B: "B등급 부기장",   FO_A: "A등급 부기장",
};
// 객실 직급 레이블 (CrewConnex 코드 → 한국어)
const CABIN_ROLE_LABELS = {
  CC: "일반 승무원 (CC)",
  AP: "부사무장 (AP)",
  PS: "사무장 (PS)",
  SP: "선임사무장 (SP)",
  CP: "수석사무장 (CP)",
};
// 객실 직급 위계 (STBY 상향 체크용: 낮을수록 하위)
const CABIN_RANK = { CC:1, AP:2, PS:3, SP:4, CP:5 };

const FO_GRADES_BY_CAPTAIN_GRADE = { A: ["A","B","C"], B: ["A","B"], C: ["A"] };
// 내 등급에서 스왑 가능한 상대 등급: A는 모두, B는 A/B, C는 C만
const VIEWABLE_GRADES = { A: ["A","B","C"], B: ["A","B"], C: ["C"] };

function today() { return new Date(); }
const HOLIDAYS = new Set(["2026-06-06"]); // 현충일 가정
// 동적 월: state.currentMonth가 진실의 원천
function curMonthLabel() {
  const [y, m] = state.currentMonth.split("-").map(Number);
  return `${y}년 ${m}월`;
}
function firstWeekdayOfCurrentMonth() {
  const [y, m] = state.currentMonth.split("-").map(Number);
  return new Date(y, m - 1, 1).getDay(); // 0=일, 1=월 ... 6=토
}
function daysInCurrentMonth() {
  const [y, m] = state.currentMonth.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function changeMonth(delta) {
  const [y, m] = state.currentMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  saveState();
  renderAll();
}

const AIRPORT_REGION = {
  ICN:"DOMESTIC", GMP:"DOMESTIC", PUS:"DOMESTIC", CJU:"DOMESTIC", TAE:"DOMESTIC",
  KIX:"JAPAN", NRT:"JAPAN", NGO:"JAPAN", FUK:"JAPAN", KMQ:"JAPAN",
  CXR:"SEA", BKI:"SEA", TAG:"SEA", MNL:"SEA", BKK:"SEA", DAD:"SEA",
  PVG:"CHINA", PEK:"CHINA", CTU:"CHINA", TAO:"CHINA",
};
const SPECIAL_AIRPORTS = ["CXR","TAG","BKI"];
const AIRPORT_ALIASES = globalThis.CrewSwapAirportAliases;

const PILL_CLASS = {
  "OFF":"pill-off", "VAC":"pill-off", "국내선":"pill-dom", "국제선":"pill-intl",
  "LAYOV":"pill-lay", "RSV":"pill-rsv", "STBY":"pill-stby", "PICK UP":"pill-pickup",
  "ARRIVAL":"pill-arrival", "GND":"pill-gnd",
};
const BAND_CLASS = { "국내선":"dom", "국제선":"", "LAYOV":"lay", "ARRIVAL":"lay", "GND":"gnd" };

const WANTED_TYPE_OPTIONS = ["OFF","국내선","국제선","LAYOV","RSV","STBY","비행(전체)","아무거나"];
// 표시용 라벨 (내부 값은 유지, 화면 텍스트만 명확하게)
const WANTED_TYPE_LABELS = { "비행(전체)": "모든 비행", "아무거나": "전부 (휴무 포함)" };
const wantedTypeLabel = t => WANTED_TYPE_LABELS[t] || t;
// 연속근무 계산 제외 유형 (휴무/휴가)
const NON_DUTY_TYPES = new Set(["OFF","VAC","VAC_A","VAC_P","UV_ML","OFFMED"]);

/* ====== 회사·직군별 룰 (확장 대비) ======
   사용자는 가입 시 airline + crewType 1회 선택 → 본인 룰 자동 적용.
   현재 베타: JEJU_PILOT만 활성. 객실/타사는 추후 추가.
================================================== */
const AIRLINE_LABELS = {
  JEJU: "제주항공", KOREAN: "대한항공", ASIANA: "아시아나",
  TWAY: "티웨이항공", AIRBUSAN: "에어부산", JINAIR: "진에어"
};
const CREWTYPE_LABELS = { PILOT: "조종사", CABIN: "객실 승무원" };

// 기종 표기 — NG=737-800, MAX=737-8. (올해까지 전원 MAX 교육 전이라 자격 구분 필요)
function aircraftLabel(ac) {
  if (!ac) return "";
  if (ac === "NG") return "737-800";
  if (ac === "MAX") return "MAX";
  if (ac === "NG_MAX") return "737-800/MAX";
  return ac;
}

// 역할 → Position 표기 (카드 배지용)
function positionLabel(roleType) {
  if (!roleType) return "";
  if (roleType.startsWith("CAPTAIN")) return "Capt.";
  if (roleType.startsWith("FO")) return "FO";
  // 객실 직급 (CrewConnex 코드)
  const cabinMap = { CC:"CC", AP:"AP", PS:"PS", SP:"SP", CP:"CP" };
  return cabinMap[roleType] || roleType;
}

const RULES = {
  JEJU_PILOT: {
    label: "제주항공 조종사",
    active: true,
    deadline: { businessDays: 2, hour: 17 },
    grades: ["A","B","C"],
    positions: ["CAPT","FO"],
    aircraftOptions: ["NG","NG_MAX"],
    pairingRule: { A: ["A","B","C"], B: ["A","B"], C: ["A"] },
    specialAirports: ["CXR","TAG","BKI"],
    monthlyHoursLimit: 90,
    consecutive24hLimit: 7,
    consecutive30dLimit: 95,
    dutyConsecLimit: 5,
    fdpHourLimit: 11,
    qualifications: ["EDTO","CAT II","CAT III"],
    parser: "crewconnex_jejuair",
    submitMenu: "J-CREW → 스케줄 변경 → 스케줄 변경 신청",
    submitContact: "운항편조팀 ☎ 1843",
  },
  JEJU_CABIN: {
    label: "제주항공 객실 승무원",
    active: true,
    deadline: { businessDays: 3 }, // 패턴 시작일 미포함 영업 3일 전
    positions: ["CC","AP","PS","SP","CP"], // CrewConnex AABB 코드 앞 2자리
    monthlyHoursLimit: 100,        // 객실 승무시간 월 100h (FOM 2.1.5)
    swapLimitMonthly: 2,           // 한달 2회
    swapLimitYearly: 12,           // 연 12회
    dutyConsecLimit: 7,            // 7일 연속 근무 불가 (STBY 포함)
    restHoursMin: 10,              // 항공안전법 객실승무원 휴식시간
    changeableTypes: ["OFF","VAC"],// UV_ML 불가
    parser: "crewconnex_jejuair",
    submitMenu: "J-ONE → 스케줄 변경 신청 → 신청",
    submitContact: "객실편조팀 ☎ 070-7420-1756",
  },
  KOREAN_PILOT: { label: "대한항공 조종사", active: false /* 룰·파싱 미확보 */ },
  KOREAN_CABIN: { label: "대한항공 객실", active: false },
  ASIANA_PILOT: { label: "아시아나 조종사", active: false },
  ASIANA_CABIN: { label: "아시아나 객실", active: false },
  TWAY_PILOT: { label: "티웨이 조종사", active: false },
  TWAY_CABIN: { label: "티웨이 객실", active: false },
  AIRBUSAN_PILOT: { label: "에어부산 조종사", active: false },
  AIRBUSAN_CABIN: { label: "에어부산 객실", active: false },
  JINAIR_PILOT: { label: "진에어 조종사", active: false },
  JINAIR_CABIN: { label: "진에어 객실", active: false },
};

function currentRules() {
  const key = `${state.user.airline}_${state.user.crewType}`;
  return RULES[key] || RULES.JEJU_PILOT;
}

/* ====== 2. 상태 ====== */
const state = {
  sessionToken: null,
  sessionExpiresAt: null,
  credits: 3,
  creditMonth: null,
  adCreditsThisMonth: 0,
  currentMonth: (() => {
    const d = new Date(); // 실시간 현재월
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })(),
  selectedDays: new Set(),
  selectionPurpose: null, // null | "post" | "request" | "ask" — 선택값이 다른 작업으로 섞이지 않게 범위 지정
  schedules: [],
  posts: [],
  myPosts: [],      // 내가 등록한 글
  myPostsHiddenInFind: 0, // 내 글이라 스왑 찾기 목록에서 뺀 건수
  postsLoadError: null,   // 스왑 글 불러오기 실패 사유 (성공하면 null)
  postsLoadedAt: null,    // 마지막으로 목록을 받아온 시각
  postDraft: null,  // 임시 저장된 등록 폼
  editingPostId: null, // 수정 중인 내 글 id (희망 조건만 수정)
  pendingRequestPostId: null, // 줄 근무 고르러 간 동안 보류된 요청 대상 글 id
  pendingRequestType: null,   // "request" | "ask"
  guideFlow: null,       // null | "post" | "find" — 단계별 스왑 진행
  managingMyPosts: false,
  findGuideStep: 1,
  requests: { sent: [], received: [] },
  reqViewMode: "sent",
  focusedRequestId: null,   // 알림에서 들어와 한 건만 보고 있을 때의 요청 id
  alerts: [],
  alertFilter: "all",
  savedSearches: [],
  filters: { direction:"all", types:[], date:"all", time:"all", arrTime:"all", region:"all", layover:"all", airports:[] },
  sortBy: "newest",
  wantedTypes: new Set(["OFF"]),
  wantedTimes: new Set(),
  user: {
    hasSignedUp: false,     // 가입 완료 여부 (이 값으로 가입 패널 숨김 결정)
    airline: "JEJU",        // JEJU | KOREAN | ASIANA | TWAY | AIRBUSAN | JINAIR
    crewType: "PILOT",      // PILOT | CABIN
    nickname:"OrangeFlight",
    roleType:"FO_C",
    aircraft:"NG_MAX",   // "NG" | "NG_MAX"
    edto:true, cat2:false, cat3:true,
    base:"GMP",
    rating:4.8,
    monthlySwapUsed: 0,
    monthlySwapLimit: 3,
    yearlySwapUsed: 0,    // 연간 누적 (객실: 12회 한도)
    // 객실 전용
    gender: "F",          // "M" | "F"
    languages: [],        // ["Japanese","Chinese","Ann_JA","Ann_CA"]
    hasBroadcastRating: false, // 방송등급 보유 여부 (미보유 시 RSV/STBY 불가)
    isPremium: false,
    proEntitlement: "none",
    proTrialAvailable: true,
    proTrialStartedAt: null,
    proTrialExpiresAt: null,
    proExpiresAt: null,
  },
};

/* ====== 3. MOCK 데이터 ====== */
function createMockSchedules() {
  // mock 데이터는 항상 2026-06에 고정 — 실제 파싱 데이터를 대체하지 않도록 month 명시
  const M = "2026-06";
  return [
    { month:M, day:1,  patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
    { month:M, day:2,  patternId:"P1", type:"국내선", title:"7C1101", dep:"ICN", arr:"CJU", reportTime:"07:20", arrivalTime:"09:35", releaseTime:"10:10", aircraft:"NG", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 4" },
    { month:M, day:3,  patternId:"P2", type:"국내선", title:"7C1102", dep:"CJU", arr:"ICN", reportTime:"13:00", arrivalTime:"15:15", releaseTime:"16:40", aircraft:"NG", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 4" },
    { month:M, day:4,  patternId:"P3", type:"RSV",    title:"RSV", reportTime:"09:00", releaseTime:"17:00", crewComposition:"대기 · 편조 미정" },
    { month:M, day:5,  patternId:"P4", type:"국내선", title:"7C1203", dep:"GMP", arr:"CJU", reportTime:"08:30", arrivalTime:"10:00", releaseTime:"10:35", aircraft:"NG", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 4" },
    { month:M, day:6,  patternId:null, type:"OFF",    title:"OFF (현충일)", crewComposition:"공휴일", holiday:true },
    { month:M, day:7,  patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
    { month:M, day:8,  patternId:"P5", type:"STBY",   title:"STBY", reportTime:"20:00", releaseTime:"02:00", crewComposition:"야간 대기 · 편조 미정" },
    { month:M, day:10, patternId:"P6", type:"국제선", title:"7C2501", dep:"ICN", arr:"BKI", reportTime:"19:10", arrivalTime:"00:55+1", releaseTime:"01:35+1", aircraft:"NG", requiresEdto:true, captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 6 · EDTO" },
    { month:M, day:11, patternId:"P6", type:"LAYOV",  title:"LAYOV BKI", layoverAirport:"BKI", aircraft:"NG", crewComposition:"BKI 체류" },
    { month:M, day:12, patternId:"P6", type:"국제선", title:"7C2502", dep:"BKI", arr:"ICN", reportTime:"01:10", arrivalTime:"08:35", releaseTime:"09:20", aircraft:"NG", requiresEdto:true, captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 6 · EDTO" },
    { month:M, day:13, patternId:"P7", type:"국내선", title:"7C1551", dep:"GMP", arr:"CJU", reportTime:"15:30", arrivalTime:"16:30", releaseTime:"17:05", aircraft:"NG", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 4" },
    { month:M, day:14, patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
    { month:M, day:15, patternId:"P8", type:"국내선", title:"7C1301", dep:"GMP", arr:"PUS", reportTime:"06:40", arrivalTime:"07:45", releaseTime:"08:20", aircraft:"NG", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 4" },
    { month:M, day:16, patternId:"P9", type:"PICK UP", title:"PICK UP", reportTime:"회사 배정", crewComposition:"배정 시 확정" },
    { month:M, day:17, patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
    { month:M, day:18, patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
    { month:M, day:19, patternId:"P10",type:"국내선", title:"7C1407", dep:"GMP", arr:"CJU", reportTime:"10:10", arrivalTime:"11:15", releaseTime:"11:50", aircraft:"MAX", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 4" },
    { month:M, day:21, patternId:"P11",type:"RSV",    title:"RSV", reportTime:"12:00", releaseTime:"20:00", crewComposition:"대기 · 편조 미정" },
    { month:M, day:24, patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
    { month:M, day:25, patternId:"P12",type:"국제선", title:"7C3401", dep:"ICN", arr:"CXR", reportTime:"19:15", arrivalTime:"00:55+1", releaseTime:"01:35+1", aircraft:"NG", requiresEdto:true, captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 6 · EDTO" },
    { month:M, day:26, patternId:"P12",type:"LAYOV",  title:"LAYOV CXR", layoverAirport:"CXR", aircraft:"NG", crewComposition:"CXR 체류" },
    { month:M, day:27, patternId:"P12",type:"LAYOV",  title:"LAYOV CXR", layoverAirport:"CXR", aircraft:"NG", crewComposition:"CXR 체류" },
    { month:M, day:28, patternId:"P12",type:"국제선", title:"7C3402", dep:"CXR", arr:"ICN", reportTime:"00:25", arrivalTime:"09:45", releaseTime:"10:20", aircraft:"NG", requiresEdto:true, captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 6 · EDTO" },
    { month:M, day:29, patternId:"P13",type:"국제선", title:"7C4101 (TAG 자격 갱신)", dep:"ICN", arr:"TAG", reportTime:"06:40", arrivalTime:"11:20", releaseTime:"12:00", aircraft:"NG", captainGrade:"B", foGrade:"B", crewComposition:"PIC B · FO B · 객실 6", lockReason:"특수공항 자격 갱신 비행 — SWAP 불가" },
    { month:M, day:30, patternId:null, type:"OFF",    title:"OFF", crewComposition:"편조 없음" },
  ];
}

// 편조에서 특정 포지션 제거 (등록자 본인 제외용)
// e.g. "PIC B · FO B · 객실 4" + "CAPTAIN" → "FO B · 객실 4"
// e.g. "강경태(Capt), 이민혁(FO), 최원준(OBSP)" + "FO" → "강경태(Capt), 최원준(OBSP)"
function buildCrewPublic(crewComposition, ownerRole) {
  if (!crewComposition) return null;
  const isCapt = ownerRole && ownerRole.startsWith("CAPTAIN");
  // 이름 포함 형식 (쉼표 구분)
  if (crewComposition.includes("(Capt)") || crewComposition.includes("(FO)")) {
    const parts = crewComposition.split(",").map(p => p.trim());
    const filtered = isCapt
      ? parts.filter(p => !p.includes("(Capt)"))
      : parts.filter(p => {
          // FO 제거: 첫 번째 (FO) 항목만 제거
          const foIdx = parts.findIndex(x => x.includes("(FO)"));
          return !(p.includes("(FO)") && parts.indexOf(p) === foIdx);
        });
    return filtered.join(", ");
  }
  // 등급 형식 (· 구분): "PIC B · FO B · 객실 4"
  const parts = crewComposition.split("·").map(p => p.trim());
  const filtered = isCapt
    ? parts.filter(p => !p.startsWith("PIC"))
    : parts.filter(p => !/^FO\b/.test(p));
  return filtered.join(" · ");
}

function createMockPosts() {
  return [
    { id:"P-001", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_B", ownerNick:"BlueSky*", ownerRating:4.8, ownerBase:"GMP",
      offered:{ patternName:"6/25-28 CXR 패턴", days:[25,26,27,28], summary:"ICN-CXR · 2박 · CXR-ICN", type:"국제선", aircraft:"NG", edto:true, cat3:true, flightMinutes:790, region:"SEA",
        reportTime:"19:15", releaseTime:"10:20",
        crewPublic:"강민준(Capt), 이서연(OBSP), 박지우(PUR), 최은지(JC1), 정수아(FA), 한가람(FA)" },
      wanted:{ types:["OFF","국내선"], dateFlex:"any", time:["AM"], excludedAirports:["CXR","BKI"], memo:"국내선 또는 OFF 희망" },
      deadlineDay:25, watchers:3, postedHoursAgo:2 },
    { id:"P-002", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_B", ownerNick:"SkyHopper*", ownerRating:4.5, ownerBase:"GMP",
      offered:{ patternName:"6/13 7C1551 (오후)", days:[13], summary:"GMP-CJU · 오후", type:"국내선", aircraft:"NG", edto:false, cat3:false, flightMinutes:65, region:"DOMESTIC",
        reportTime:"15:30", releaseTime:"17:05",
        crewPublic:"김도현(Capt), 윤미래(PUR), 송하늘(FA), 오지은(FA)" },
      wanted:{ types:["OFF"], dateFlex:"sameDay", time:[], excludedAirports:[], memo:"같은 날 OFF 절실" },
      deadlineDay:13, watchers:7, postedHoursAgo:5 },
    { id:"P-003", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_B", ownerNick:"NightOwl*", ownerRating:4.2, ownerBase:"PUS",
      offered:{ patternName:"6/10-12 BKI 패턴 (EDTO)", days:[10,11,12], summary:"ICN-BKI · 1박 · BKI-ICN", type:"국제선", aircraft:"MAX", edto:true, cat3:false, flightMinutes:570, region:"SEA",
        reportTime:"19:10", releaseTime:"09:20",
        crewPublic:"박현우(Capt), 임소연(OBSP), 조혜정(PUR), 안기옥(JC1), 양효정(FA), 김나래(FA)" },
      wanted:{ types:["국내선"], dateFlex:"sameMonth", time:["AM"], excludedAirports:[], memo:"오전 국내선 희망" },
      deadlineDay:10, watchers:2, postedHoursAgo:18 },
    { id:"P-004", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_B", ownerNick:"DayDreamer*", ownerRating:4.9, ownerBase:"GMP",
      offered:{ patternName:"6/18 OFF", days:[18], summary:"OFF 1일", type:"OFF", aircraft:null, edto:false, cat3:false, flightMinutes:0, region:null,
        reportTime:null, releaseTime:null, crewPublic:null },
      wanted:{ types:["RSV","STBY"], dateFlex:"sameDay", time:[], excludedAirports:[], memo:"OFF 양도 · RSV/STBY 가능" },
      deadlineDay:18, watchers:5, postedHoursAgo:30 },
    { id:"P-005", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_B", ownerNick:"MorningFly*", ownerRating:4.1, ownerBase:"GMP",
      offered:{ patternName:"6/21 RSV", days:[21], summary:"RSV 1일", type:"RSV", aircraft:null, edto:false, cat3:false, flightMinutes:0, region:null,
        reportTime:"12:00", releaseTime:"20:00", crewPublic:null },
      wanted:{ types:["OFF"], dateFlex:"sameDay", time:[], excludedAirports:[], memo:"OFF 희망" },
      deadlineDay:21, watchers:1, postedHoursAgo:50 },
    { id:"P-006", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_B", ownerNick:"WindRider*", ownerRating:4.7, ownerBase:"GMP",
      offered:{ patternName:"6/4 RSV", days:[4], summary:"RSV 1일", type:"RSV", aircraft:null, edto:false, cat3:false, flightMinutes:0, region:null,
        reportTime:"09:00", releaseTime:"17:00", crewPublic:null },
      wanted:{ types:["비행(전체)"], dateFlex:"sameDay", time:["AM"], excludedAirports:[], memo:"오전 비행 환영" },
      deadlineDay:4, watchers:2, postedHoursAgo:12 },
    // 기장 글 (필터링 테스트용)
    { id:"P-007", airline:"JEJU", crewType:"PILOT", ownerRole:"CAPTAIN_B", ownerNick:"CaptainK*", ownerRating:4.9, ownerBase:"GMP",
      offered:{ patternName:"6/25 CXR", days:[25,26,27,28], summary:"ICN-CXR", type:"국제선", aircraft:"NG", edto:true, cat3:true, flightMinutes:790, region:"SEA",
        reportTime:"19:15", releaseTime:"10:20",
        crewPublic:"이민혁(FO), 최원준(OBSP), 조혜정(PUR), 안기옥(JC1), 양효정(FA), 김나래(FA)" },
      wanted:{ types:["OFF"], dateFlex:"any", time:[], excludedAirports:[], memo:"OFF 희망" },
      deadlineDay:25, watchers:1, postedHoursAgo:1 },
    { id:"P-008", airline:"JEJU", crewType:"PILOT", ownerRole:"FO_A", ownerNick:"AceFlyer*", ownerRating:5.0, ownerBase:"GMP",
      offered:{ patternName:"6/21 RSV", days:[21], summary:"RSV 1일", type:"RSV", aircraft:null, edto:true, cat3:false, flightMinutes:0, region:null,
        reportTime:"12:00", releaseTime:"20:00", crewPublic:null },
      wanted:{ types:["OFF"], dateFlex:"sameDay", time:[], excludedAirports:[], memo:"" },
      deadlineDay:21, watchers:1, postedHoursAgo:6 },
    // 객실 승무원 글
    { id:"C-001", airline:"JEJU", crewType:"CABIN", ownerRole:"CC", ownerNick:"CabinStar*", ownerRating:4.7, ownerBase:"GMP",
      offered:{ patternName:"6/25-27 NRT 패턴", days:[25,26,27], summary:"ICN-NRT · 1박 · NRT-ICN", type:"국제선", aircraft:null, edto:false, cat3:false, flightMinutes:280, region:"NE",
        reportTime:"17:30", releaseTime:"11:10", crewPublic:null },
      wanted:{ types:["OFF"], dateFlex:"sameMonth", time:[], excludedAirports:[], memo:"OFF 주시면 감사합니다" },
      deadlineDay:25, watchers:4, postedHoursAgo:3 },
    { id:"C-002", airline:"JEJU", crewType:"CABIN", ownerRole:"PS", ownerNick:"PurserMin*", ownerRating:4.9, ownerBase:"GMP",
      offered:{ patternName:"6/18 OFF", days:[18], summary:"OFF 1일", type:"OFF", aircraft:null, edto:false, cat3:false, flightMinutes:0, region:null,
        reportTime:null, releaseTime:null, crewPublic:null },
      wanted:{ types:["국내선","국제선"], dateFlex:"sameDay", time:["AM"], excludedAirports:[], memo:"오전 비행 원합니다" },
      deadlineDay:18, watchers:6, postedHoursAgo:8 },
    { id:"C-003", airline:"JEJU", crewType:"CABIN", ownerRole:"CC", ownerNick:"JerrySky*", ownerRating:4.3, ownerBase:"GMP",
      offered:{ patternName:"6/21 RSV", days:[21], summary:"RSV 1일", type:"RSV", aircraft:null, edto:false, cat3:false, flightMinutes:0, region:null,
        reportTime:"09:00", releaseTime:"17:00", crewPublic:null },
      wanted:{ types:["OFF"], dateFlex:"sameDay", time:[], excludedAirports:[], memo:"" },
      deadlineDay:21, watchers:2, postedHoursAgo:14 },
    { id:"C-004", airline:"JEJU", crewType:"CABIN", ownerRole:"AP", ownerNick:"SunnyAP*", ownerRating:4.6, ownerBase:"PUS",
      offered:{ patternName:"6/13 GMP-CJU 국내선", days:[13], summary:"GMP-CJU · 오후", type:"국내선", aircraft:null, edto:false, cat3:false, flightMinutes:65, region:"DOMESTIC",
        reportTime:"14:00", releaseTime:"16:00", crewPublic:null },
      wanted:{ types:["OFF","RSV"], dateFlex:"any", time:[], excludedAirports:[], memo:"GMP 베이스 글 우선" },
      deadlineDay:13, watchers:3, postedHoursAgo:20 },
    { id:"C-005", airline:"JEJU", crewType:"CABIN", ownerRole:"CC", ownerNick:"MoonFlight*", ownerRating:4.5, ownerBase:"GMP",
      offered:{ patternName:"6/10-12 BKI 패턴", days:[10,11,12], summary:"ICN-BKI · 1박 · BKI-ICN", type:"국제선", aircraft:null, edto:false, cat3:false, flightMinutes:570, region:"SEA",
        reportTime:"19:00", releaseTime:"09:30", crewPublic:null },
      wanted:{ types:["OFF","국내선"], dateFlex:"any", time:[], excludedAirports:[], memo:"국내선 또는 OFF 환영" },
      deadlineDay:10, watchers:5, postedHoursAgo:36 },
  ];
}

function createMockRequests() {
  return {
    sent: [
      { id:"R-001", postTitle:"6/25-28 CXR 패턴", postOwnerRole:"FO_B", aircraft:"NG", quals:"EDTO / CAT III",
        status:"요청 대기", stage:1, sentAgo:"2시간 전", base:"GMP", nickname:"BlueSky*" },
      { id:"R-002", postTitle:"6/18 OFF", postOwnerRole:"FO_B", aircraft:"NG", quals:"일반",
        status:"요청 대기", stage:2, sentAgo:"6시간 전", base:"GMP", nickname:"DayDreamer*" },
      { id:"R-003", postTitle:"6/13 7C1551", postOwnerRole:"FO_B", aircraft:"NG", quals:"일반",
        status:"상호 수락 — 회사 상신 필요", stage:3, sentAgo:"1일 전", base:"GMP", nickname:"SkyHopper*" },
    ],
    received: [
      { id:"R-101", postTitle:"내 6/4 RSV → 오전 비행", requesterRole:"FO_B", aircraft:"NG", quals:"EDTO",
        status:"응답 대기", stage:1, sentAgo:"30분 전", base:"GMP", nickname:"WindRider*" },
      { id:"R-102", postTitle:"내 6/19 7C1407 → OFF", requesterRole:"FO_B", aircraft:"MAX", quals:"EDTO / CAT III",
        status:"상호 수락 — 회사 상신 필요", stage:3, sentAgo:"3시간 전", base:"PUS", nickname:"DayDreamer*" },
    ],
  };
}

function createMockAlerts() {
  const alerts = [
    { id:"guide", kind:"announce", title:"📢 CrewSwap 사용 안내", date:"2026.08.03",
      body:"1. 내 근무 확인\nCrewConnex에 로그인해 스케줄을 불러오면 달력에서 근무와 세부 일정을 확인할 수 있습니다.\n\n2. 원하는 스왑 찾기\n모든 스왑을 보거나 날짜·근무 종류 등 원하는 조건을 선택해 찾을 수 있습니다. 글을 누르면 쇼업 시간과 비행 일정을 자세히 확인할 수 있습니다.\n\n3. 내 스왑 올리기\n내가 바꾸고 싶은 근무와 원하는 조건을 선택해 등록합니다. 등록한 글은 ‘내가 올린 스왑 관리’에서 수정·취소·삭제할 수 있습니다.\n\n4. 요청과 의향 묻기\n정식 요청은 내 근무를 제안해 교환을 요청하는 기능입니다. 의향 묻기는 크레딧 없이 상대방의 교환 의사부터 확인하는 기능입니다.\n\n5. 요청 확인\n‘요청’ 메뉴에서 받은 요청과 보낸 요청을 확인합니다. 필요한 경우 서로의 달력을 비교해 교환할 일정을 선택할 수 있습니다.\n\n6. 규정 및 개인정보\n앱이 휴식시간과 스왑 규정을 확인하며, 교환할 수 없는 일정은 사유와 함께 알려줍니다. 실명·사번·연락처는 상호 수락 후에만 공개됩니다.\n\n7. 최종 변경\n상호 수락 후 실제 스케줄 변경은 회사 시스템을 통해 최종 신청해야 합니다.\n\n8. PRO 알림\n원하는 스왑 조건을 저장하면 앱을 열지 않아도 조건에 맞는 새 글 알림을 받을 수 있습니다.",
      time:"공지" },
    { id:"qna", kind:"announce", title:"❓ 자주 묻는 질문 (Q&A)", date:"2026.08.21",
      body:"Q1. 스왑 올리기·요청하기·의향 묻기는 어떻게 다른가요?\n‘내 스왑 올리기’는 내가 바꿀 근무를 게시하는 기능입니다. ‘요청하기’는 상대 글에 내 근무를 제안하는 정식 교환 요청이고, ‘의향 묻기’는 크레딧 없이 상대의 교환 의사부터 확인하는 기능입니다.\n\nQ2. 요청할 때 내 스케줄 전체가 상대에게 보이나요?\n같은 날짜끼리 바로 교환할 수 있는 1:1 스왑은 제안한 근무만 보입니다. 날짜가 다르거나 상대가 받을 근무를 직접 골라야 할 때만 공개 달력이 전달되며, ‘내 스케줄 숨기기’로 원하지 않는 날짜를 제외할 수 있습니다.\n\nQ3. 실명·사번·연락처는 언제 공개되나요?\n양쪽이 상호 수락한 뒤에만 공개됩니다. 그전에는 닉네임·베이스·직책 등 공개 정보만 표시됩니다. 공개된 정보는 회사 스왑 진행 목적으로만 사용해야 합니다.\n\nQ4. 규정 경고로 요청할 수 없는 이유는 무엇인가요?\n앱이 휴식시간, 연속 근무, 모기지 휴무, RSV·STBY 패턴, 자격 및 스왑 횟수 등을 자동 확인합니다. 규정과 충돌하면 해당 날짜와 사유를 표시하고 요청을 막습니다. 이 판정은 보조 기능이므로 원본 일정과 최신 회사 규정을 반드시 다시 확인해야 합니다.\n\nQ5. 요청이나 의향을 거절하면 어떤 내용이 전달되나요?\n일반 거절은 개인 사정으로 진행하기 어렵다는 안내가 전달됩니다. 자동 규정 판정으로 불가능한 경우에는 개인 사유가 아니라 충돌 날짜와 규정 사유가 전달됩니다.\n\nQ6. 상호 수락하면 스왑이 끝난 건가요?\n아닙니다. 상호 수락은 두 이용자의 의사 확인이며 회사 승인이 아닙니다. 글을 올린 사람이 회사 시스템에 근무교환을 신청하고 최종 승인 여부를 확인해야 합니다.\n\nQ7. 무료 크레딧은 어떻게 사용되나요?\n무료 이용자는 스왑 글 등록과 정식 요청에 각각 1크레딧을 사용하며 의향 묻기는 무료입니다. 매월 첫 실행 시 기본 3크레딧으로 재설정되고 남은 크레딧과 광고 보상은 다음 달로 이월되지 않습니다. 보상형 광고가 제공되면 시청 1회당 그달에 사용할 1크레딧을 추가로 받을 수 있습니다.\n\nQ8. 취소하거나 마감되면 크레딧이 환급되나요?\n진행 전 등록을 취소하면 사용한 등록 크레딧이 기본 상한 3개까지 복원됩니다. 등록 글이 매칭 없이 마감되면 사용한 크레딧의 50%가 자동 환급됩니다. PRO 무제한으로 등록한 글은 처음부터 크레딧을 쓰지 않으므로 환급도 없습니다.\n\nQ9. 무료와 PRO는 무엇이 다른가요?\n스왑 검색·등록·요청·수락과 규정 확인 등 핵심 기능은 무료입니다. PRO는 원하는 목적지·근무 유형·체류조건을 저장해 앱을 열지 않아도 조건에 맞는 새 글 알림을 받고, 스왑 등록과 정식 요청 크레딧을 무제한으로 이용하며, 편조구성원(동료 이름)을 상호 수락 전에도 미리 볼 수 있는 편의 기능입니다.\n\nQ10. PRO 30일 무료 이용권은 언제 시작되나요?\n가입 즉시 시작되지 않습니다. 계정당 한 번, 내가 필요한 시점에 직접 시작하며 활성화 순간부터 30일 동안 PRO 알림과 무제한 크레딧을 동일하게 이용합니다. 결제정보가 필요 없고 기간 종료 후 자동 결제되지 않으며 일시정지하거나 다시 사용할 수 없습니다.\n\nQ11. 앱을 닫아도 PRO 알림이 오나요?\n알림 권한과 백그라운드 알림을 켜고 조건을 서버에 저장하면 앱을 열지 않은 상태에서도 받을 수 있습니다. 기기의 알림 차단, 네트워크 상태나 운영체제 정책에 따라 전달이 늦거나 제한될 수 있습니다.\n\nQ12. 스왑 횟수 제한이 있나요?\n객실승무원은 실제 상호 수락된 스왑을 기준으로 월 2회·연 12회 한도를 확인하며, 한도에 도달하면 경고하고 진행을 막습니다. 운항승무원은 현재 앱에서 별도 횟수 제한을 적용하지 않습니다.\n\nQ13. 달력의 👀·⚠️ 아이콘은 무엇인가요?\n👀 옆 숫자는 다른 사용자가 해당 날짜에 내놓은 스왑 글 수입니다. ⚠️는 연속 근무 등 규정상 주의가 필요한 날짜입니다. 실제 교환 가능 여부는 등록·요청 단계에서 다시 자동 확인합니다.\n\nQ14. 휴대폰을 바꾸거나 앱을 삭제하면 일정과 크레딧이 복원되나요?\n계정·프로필·등록 글·요청·PRO 정보와 크레딧은 서버 계정에 연결되어 다시 로그인하면 복원됩니다. CrewConnex로 불러온 근무표도 서버에 저장되어 다른 기기에서 같은 계정으로 로그인하면 자동으로 동기화됩니다. 탈퇴하면 서버 정보와 현재 기기 정보가 함께 삭제됩니다.\n\nQ15. 편조구성원(동료 이름)은 언제 볼 수 있나요?\nPRO 구독자는 스왑 글을 둘러볼 때부터 바로 확인할 수 있습니다. 무료 사용자는 상호 수락이 끝난 뒤에만 공개됩니다.",
      time:"공지" },
  ];
  const guide = alerts.find(item => item.id === "guide");
  if (guide) {
    guide.body = guide.body.replace(
      "8. PRO 알림\n원하는 스왑 조건을 저장하면 앱을 열지 않아도 조건에 맞는 새 글 알림을 받을 수 있습니다.",
      "8. PRO 편의 기능\n원하는 스왑 조건을 저장하면 앱을 열지 않아도 새 글 알림을 받을 수 있습니다. 스왑 등록·정식 요청 크레딧은 무제한이며, 스왑 목록에서 편조구성원 이름을 상호 수락 전에도 미리 확인할 수 있습니다."
    );
  }
  const qna = alerts.find(item => item.id === "qna");
  if (qna) {
    qna.date = "2026.08.23";
    qna.body = qna.body
      .replace(
        "Q9. 무료와 PRO는 무엇이 다른가요?\n스왑 검색·등록·요청·수락과 규정 확인 등 핵심 기능은 무료입니다. PRO는 원하는 목적지·근무 유형·체류조건을 저장해 앱을 열지 않아도 조건에 맞는 새 글 알림을 받고, 스왑 등록과 정식 요청 크레딧을 무제한으로 이용하며, 편조구성원(동료 이름)을 상호 수락 전에도 미리 볼 수 있는 편의 기능입니다.",
        "Q9. 무료와 PRO는 무엇이 다른가요?\n스왑 검색·등록·요청·수락과 규정 확인 등 핵심 기능은 무료입니다. PRO 영구 이용권은 한 번만 구매하는 상품으로, 원하는 조건의 새 글을 앱을 닫은 상태에서도 알림받고 스왑 등록·정식 요청 크레딧을 무제한으로 이용할 수 있습니다. 또한 스왑 목록에서 편조구성원(동료 이름)을 상호 수락 전에도 미리 확인할 수 있습니다."
      )
      .replace(
        "Q10. PRO 30일 무료 이용권은 언제 시작되나요?\n가입 즉시 시작되지 않습니다. 계정당 한 번, 내가 필요한 시점에 직접 시작하며 활성화 순간부터 30일 동안 PRO 알림과 무제한 크레딧을 동일하게 이용합니다.",
        "Q10. PRO 30일 무료 이용권은 언제 시작되나요?\n가입 즉시 시작되지 않습니다. 계정당 한 번, 내가 필요한 시점에 직접 시작하며 활성화 순간부터 30일 동안 자동 알림·무제한 크레딧·편조구성원 미리보기를 모두 이용합니다."
      )
      .replace(
        "Q15. 편조구성원(동료 이름)은 언제 볼 수 있나요?\nPRO 구독자는 스왑 글을 둘러볼 때부터 바로 확인할 수 있습니다. 무료 사용자는 상호 수락이 끝난 뒤에만 공개됩니다.",
        "Q15. 편조구성원(동료 이름)은 언제 볼 수 있나요?\nPRO 이용자는 스왑 목록을 둘러볼 때부터 바로 확인할 수 있습니다. 무료 사용자는 상호 수락이 끝난 뒤에만 공개됩니다. 편조 정보가 원본 스케줄에 없거나 아직 미정인 근무는 PRO에서도 표시되지 않을 수 있습니다."
      );
  }
  const releaseAnnouncement = window.CrewSwapReleaseNotice?.announcement();
  if (releaseAnnouncement) alerts.unshift(releaseAnnouncement);
  return alerts;
}

function createMockSavedSearches() {
  return []; // 실제 저장검색은 사용자가 직접 추가
}

/* ====== 4. 유틸 ====== */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const SERVICE_LINKS = Object.freeze({
  privacy: "https://rufnek737.github.io/crewswap/privacy.html",
  terms: "https://rufnek737.github.io/crewswap/terms.html",
  contact: "mailto:info@rufnekcrew.com?subject=CrewSwap%20문의",
});

function isNativeApp() {
  return !!window.Capacitor?.isNativePlatform?.();
}

async function openServiceLink(kind) {
  const url = SERVICE_LINKS[kind];
  if (!url) return;

  try {
    if (kind === "contact") {
      if (isNativeApp() && window.Capacitor?.Plugins?.AppLauncher) {
        await window.Capacitor.Plugins.AppLauncher.openUrl({ url });
      } else {
        window.location.href = url;
      }
      return;
    }

    if (isNativeApp() && window.Capacitor?.Plugins?.Browser) {
      await window.Capacitor.Plugins.Browser.open({ url });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    if (kind === "contact") {
      try { await navigator.clipboard.writeText("info@rufnekcrew.com"); } catch (_) {}
      showToast("메일 앱을 열 수 없어 문의 주소를 복사했습니다: info@rufnekcrew.com");
      return;
    }
    showToast("페이지를 열 수 없습니다. 잠시 후 다시 시도해주세요.");
  }
}


// iOS 핀치 줌 차단 (확대 시 하단 고정바가 떠버리는 문제 방지)
["gesturestart", "gesturechange", "gestureend"].forEach(evt =>
  document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);
// 더블탭 줌 차단 — "같은 자리에서 빠른 두번째 탭"만 막음
// (다른 칩을 빠르게 연속 탭하는 건 거리가 멀어서 안 막힘 → 칩 선택 정상)
let _lastTapInfo = { t: 0, x: 0, y: 0 };
document.addEventListener("touchend", e => {
  const tch = e.changedTouches && e.changedTouches[0];
  if (!tch) return;
  const now = Date.now();
  const dt = now - _lastTapInfo.t;
  const dist = Math.hypot(tch.clientX - _lastTapInfo.x, tch.clientY - _lastTapInfo.y);
  if (dt > 0 && dt < 320 && dist < 40) e.preventDefault(); // 더블탭 줌 제스처
  _lastTapInfo = { t: now, x: tch.clientX, y: tch.clientY };
}, { passive: false });

// 공항 코드 입력 — 쉼표/공백 어느 쪽으로 구분해도 인식 (예: "CXR BKI" 또는 "CXR, BKI")
function parseAirportList(str) {
  return (str || "").split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove("is-visible"), 2800);
}

function dayToDate(day, month) {
  return new Date(`${month || state.currentMonth}-${String(day).padStart(2,"0")}T00:00:00`);
}
// 스케줄 객체의 월 숫자 (크로스월 표시용) — s.month "2026-06" → 6
function schedMonthNum(s) {
  return parseInt((s && s.month || state.currentMonth).split("-")[1], 10);
}
// 글의 마감 기준 월 — deadlineMonth 우선, 없으면 패턴 제목("7/7~9")에서 추출, 그래도 없으면 현재월
function postDeadlineMonth(post) {
  if (post && post.deadlineMonth) return post.deadlineMonth;
  const name = post && post.offered && post.offered.patternName || "";
  const m = /^\s*(\d{1,2})\//.exec(name);
  if (m) {
    const yr = (state.currentMonth || "2026-01").split("-")[0];
    return `${yr}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  }
  return state.currentMonth;
}
// 스케줄의 월이 현재 보고있는 달과 일치하는지
function scheduleInCurrentMonth(s) {
  return (s.month || state.currentMonth) === state.currentMonth;
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function weekdayOf(day) { return dayToDate(day).getDay(); } // 0=일,6=토
function isWeekend(day) { const w = weekdayOf(day); return w === 0 || w === 6; }
function isHoliday(day) { return HOLIDAYS.has(ymd(dayToDate(day))); }
function isBusinessDay(date) {
  const d = date.getDay();
  if (d === 0 || d === 6) return false;
  return !HOLIDAYS.has(ymd(date));
}
function addBusinessDays(start, n) {
  const d = new Date(start);
  let remaining = Math.abs(n);
  const dir = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    d.setDate(d.getDate() + dir);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

function parseTimeOfDay(reportTime) {
  if (!reportTime || !/^\d/.test(reportTime)) return null;
  const h = parseInt(reportTime.split(":")[0], 10);
  if (h < 10) return "AM";
  if (h < 18) return "PM";
  return "NIGHT";
}

// BLH (Block Hours · 실제 비행시간) — CrewConnex의 진짜 승무시간
function flightMinutesOf(s) {
  // BLH 데이터가 있으면 그것을 사용 (정확)
  if (typeof s.blockMinutes === "number") return s.blockMinutes;
  // BLH 없으면 0 (재추출 필요)
  return 0;
}

// 근무시간 (report→release) — 11h/24h 룰 등 별도 계산용
function dutyMinutesOf(s) {
  if (!s.reportTime || !s.releaseTime || !/^\d/.test(s.reportTime)) return 0;
  const parseMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})(\+1)?$/.exec(t);
    if (!m) return null;
    return parseInt(m[1],10)*60 + parseInt(m[2],10) + (m[3] ? 24*60 : 0);
  };
  const a = parseMin(s.reportTime), b = parseMin(s.releaseTime);
  if (a == null || b == null) return 0;
  return Math.max(0, b - a);
}

/* ====== 비행 전후 휴식시간 검증 ======
 * 계획 단계 기준: 실제 비행시각 대신 C/I(reportTime)·STA(arrivalTime)·C/O(releaseTime)로 산정.
 * 새로 받는 근무 블록의 직전/직후 날짜에 내 근무가 남아 있을 때, 그 사이 휴식이
 * 최소 기준을 만족하는지 검사한다.
 *
 * - 운항(PILOT): FOM 5.5.3 가 — 직전 근무 C/O → 새 근무 C/I 간격이 직전 FDT 기준 휴식 이상.
 * - 객실(CABIN): 회사 SKD Swap 산정기준 — 직전 STA(도착) → 새 근무 C/I(출두) 간격.
 *     도착공항 ICN이면 12h00(인천-김포 셔틀 40분 포함), 그 외(GMP/PUS 등) 11h20.
 *     (Rest 10h 포함값. 객실 FOM상 비행근무 14h 초과 시 휴식 14h → +4h 가산) */

// [운항] 비행근무시간(분) → 최소 휴식(분). FOM 5.5.3 가 표.
function minRestMinForFDT(fdtMin) {
  const h = fdtMin / 60;
  if (h < 8)  return 600;   // 10h
  if (h < 9)  return 660;   // 11h
  if (h < 10) return 720;   // 12h
  if (h < 11) return 780;   // 13h
  if (h < 12) return 840;   // 14h
  if (h < 13) return 900;   // 15h
  if (h < 14) return 960;   // 16h
  if (h < 15) return 1020;  // 17h
  if (h < 16) return 1080;  // 18h
  if (h < 17) return 1200;  // 20h
  if (h < 18) return 1320;  // 22h
  if (h < 19) return 1440;  // 24h
  return 1560;              // 26h (19h 이상)
}

// "HH:MM" 또는 "HH:MM+1" → 해당 day 기준 절대 분 (월 내 가정)
function absMinAt(day, t) {
  const m = /^(\d{1,2}):(\d{2})(\+1)?$/.exec((t || "").trim());
  if (!m) return null;
  return day * 1440 + parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? 1440 : 0);
}

// 해당 날짜에 시각이 있는 '근무'가 있으면 반환, OFF/VAC/무시간이면 null(=휴식으로 간주)
function dutyOnDay(day) {
  const s = state.schedules.find(x => x.day === day && scheduleInCurrentMonth(x));
  if (!s || !s.reportTime || !s.releaseTime || !/^\d/.test(s.reportTime) || !/^\d/.test(s.releaseTime)) return null;
  return s;
}

function fmtDur(min) {
  if (min == null || isNaN(min)) return "-";
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

// [객실] 직전 근무 도착공항·비행근무시간 → 최소 STA→C/I 필요시간(분). 회사 SKD Swap 산정기준.
function cabinRestReqMin(arrAirport, nextDepAirport, fdtMin, nextType) {
  const previous = {
    arr: arrAirport,
    reportTime: "00:00",
    releaseTime: fdtMin ? `${String(Math.floor(fdtMin / 60)).padStart(2, "0")}:${String(fdtMin % 60).padStart(2, "0")}` : null,
  };
  const policy = window.CrewSwapCabinPolicy;
  const next = { dep: nextDepAirport, type: nextType };
  const stdGap = policy?.minimumRestGapMinutes(
    previous,
    next,
  ) ?? 10 * 60;
  return Math.max(10 * 60, stdGap - (policy?.reportToDepartureMinutes(next) || 0));
}

// offered: { days, reportTime(첫날 C/I), firstDepAirport(첫 출발공항),
//            releaseTime(막날 C/O), lastReport(막날 C/I),
//            lastArrival(막날 STA), lastArrAirport(막날 도착공항) }
// givenAwayDays: 내가 내주는 날짜(이 날들의 내 근무는 사라지므로 인접 검사에서 제외)
function restCheckIncoming(offered, givenAwayDays) {
  if (!offered || !offered.days || !offered.days.length) return { ok: true, issues: [] };
  const days = [...offered.days].sort((a, b) => a - b);
  const firstDay = days[0], lastDay = days[days.length - 1];
  const firstCI = offered.reportTime;
  // 새로 받는 근무에 출두(C/I) 정보가 없으면(OFF/RSV 등) 검사 불가 → 제약 없음
  if (!firstCI || !/^\d/.test(firstCI)) return { ok: true, issues: [], unknown: true };
  const isCabin = state.user.crewType === "CABIN";
  const given = new Set(givenAwayDays || []);
  const issues = [];
  const newCI = absMinAt(firstDay, firstCI);

  // ── 직전 휴식: (firstDay-1)의 내 근무 → 새 근무 첫날 출두(C/I)
  if (!given.has(firstDay - 1)) {
    const prev = dutyOnDay(firstDay - 1);
    if (prev) {
      let gap = null, need = null;
      if (isCabin) {
        // STA(도착) → C/I(출두), 직전 근무 도착공항·FDT 기준
        if (prev.arrivalTime && /^\d/.test(prev.arrivalTime)) {
          gap = newCI - absMinAt(prev.day, prev.arrivalTime);
          need = cabinRestReqMin(prev.arr, offered.firstDepAirport, dutyMinutesOf(prev), offered.type);
        }
      } else {
        // 운항: C/O(퇴근) → C/I(출두), 직전 근무 FDT 기준
        gap = newCI - absMinAt(prev.day, prev.releaseTime);
        need = minRestMinForFDT(dutyMinutesOf(prev));
      }
      if (gap != null && !isNaN(gap) && gap < need)
        issues.push({ side: "before", gap, need, label: `${prev.day}일 ${prev.title}` });
    }
  }
  // ── 직후 휴식: 새 근무 막날 → (lastDay+1)의 내 근무 출두(C/I)
  if (!given.has(lastDay + 1)) {
    const next = dutyOnDay(lastDay + 1);
    if (next && next.reportTime && /^\d/.test(next.reportTime)) {
      const nextCI = absMinAt(next.day, next.reportTime);
      let gap = null, need = null;
      if (isCabin) {
        // 새 근무 막날 STA(도착) → 다음 근무 C/I(출두)
        if (offered.lastArrival && /^\d/.test(offered.lastArrival)) {
          const blockFDT = (offered.lastReport && /^\d/.test(offered.lastReport) && offered.releaseTime && /^\d/.test(offered.releaseTime))
            ? Math.max(0, absMinAt(lastDay, offered.releaseTime) - absMinAt(lastDay, offered.lastReport)) : 0;
          gap = nextCI - absMinAt(lastDay, offered.lastArrival);
          need = cabinRestReqMin(offered.lastArrAirport, next.dep, blockFDT, next.type);
        }
      } else {
        // 운항: 새 근무 막날 C/O → 다음 근무 C/I, 막날 FDT 기준
        if (offered.releaseTime && /^\d/.test(offered.releaseTime)) {
          const lastCI = offered.lastReport && /^\d/.test(offered.lastReport) ? offered.lastReport : firstCI;
          const blockFDT = Math.max(0, absMinAt(lastDay, offered.releaseTime) - absMinAt(lastDay, lastCI));
          gap = nextCI - absMinAt(lastDay, offered.releaseTime);
          need = minRestMinForFDT(blockFDT);
        }
      }
      if (gap != null && !isNaN(gap) && gap < need)
        issues.push({ side: "after", gap, need, label: `${next.day}일 ${next.title}` });
    }
  }
  return { ok: issues.length === 0, issues };
}

// 휴식 검사 결과 → 사용자 메세지 (첫 위반 기준)
function restIssueMessage(rc) {
  if (!rc || rc.ok) return null;
  const i = rc.issues[0];
  const where = i.side === "before" ? "직전" : "직후";
  return `❌ 휴식시간 부족 — ${where} 근무(${i.label})와 간격 ${fmtDur(i.gap)} · 최소 ${fmtDur(i.need)} 필요`;
}

/* ====== 노조 협약(JPUF 단체교섭 협약서) — 모기지 휴식일수 검증 (운항승무원 전용) ======
 * "모기지를 떠난 일수"(오버나이트 LAYOV가 포함된 연속 트립의 총 일수)에 따라
 * 복귀 후 필요한 모기지(집·베이스) 휴식일수가 정해져 있음. 퀵턴(당일 왕복, LAYOV 없음)은 해당 없음.
 * 검사 방향은 직후만: 새 트립 복귀 후 → 다음 LAYOV 트립 출발 전까지 남는 날수가 부족하면 경고. */
function mogijiRestReqDays(tripDays) {
  return window.CrewSwapMogijiPolicy?.requiredRestDays(tripDays) ?? 0;
}

// day 이후(> day) 가장 빠른 "LAYOV 포함 트립"의 시작일 찾기 (현재 달 스케줄 범위 내)
function nextLayoverTripStartAfter(day) {
  const seenPid = new Set();
  let best = null;
  currentMonthSchedules().forEach(s => {
    if (s.day <= day || !s.patternId || seenPid.has(s.patternId)) return;
    seenPid.add(s.patternId);
    const groupDays = connectedPatternDays(s.patternId, s.day);
    const hasLayover = groupDays.some(d => {
      const gs = getSchedule(d);
      return gs && (gs.type === "LAYOV" || gs.type === "ARRIVAL");
    });
    if (!hasLayover) return;
    const start = groupDays[0];
    if (start > day && (best === null || start < best)) best = start;
  });
  return best;
}

// offered: { days, hasLayover }. givenAwayDays: 내가 내주는 날짜(사라지는 근무라 다음 트립 판정에서 제외)
function mogijiRestCheckIncoming(offered, givenAwayDays) {
  if (state.user.crewType !== "PILOT") return { ok: true, issues: [] };
  if (!offered || !offered.hasLayover || !offered.days || !offered.days.length) return { ok: true, issues: [] };
  const tripDays = offered.days.length;
  const required = mogijiRestReqDays(tripDays);
  if (required === 0) return { ok: true, issues: [] };
  const lastDay = Math.max(...offered.days);
  const given = new Set(givenAwayDays || []);
  let nextStart = nextLayoverTripStartAfter(lastDay);
  if (nextStart != null && given.has(nextStart)) nextStart = null; // 그 트립도 이번 스왑으로 내가 내주는 근무면 제외
  if (nextStart == null) return { ok: true, issues: [] }; // 이번 달엔 다음 LAYOV 트립 없음 → 판정 불가(제약 없음)
  const available = nextStart - lastDay - 1;
  if (available < required)
    return { ok: false, issues: [{ available, required, nextStart, tripDays }] };
  return { ok: true, issues: [] };
}

function mogijiIssueMessage(rc) {
  if (!rc || rc.ok) return null;
  const i = rc.issues[0];
  return `❌ 모기지 휴식일수 부족 — ${i.tripDays}일 트립 복귀 후 ${i.required}일 필요하나 다음 트립(${i.nextStart}일)까지 ${Math.max(0, i.available)}일뿐 (노조 협약 기준)`;
}

function airportRegion(code) { return AIRPORT_REGION[code] || "OTHER"; }

/* ====== 5. 패턴 / 선택 ====== */
function getSchedule(day) {
  return state.schedules.find(s => s.day === day && scheduleInCurrentMonth(s));
}
function patternDays(pid) {
  return state.schedules.filter(s => s.patternId === pid && scheduleInCurrentMonth(s)).map(s => s.day);
}
function currentMonthSchedules() {
  return state.schedules.filter(scheduleInCurrentMonth);
}

// 데이터가 있는 모든 월 (s.month가 없는 항목은 state.currentMonth로 간주)
function availableMonths() {
  const set = new Set();
  state.schedules.forEach(s => set.add(s.month || state.currentMonth));
  return [...set].sort();
}

// 같은 patternId라도 일자가 떨어져 있으면 별도 패턴 — 클릭한 일자를 포함한
// 연속 구간만 반환. ARRIVAL은 패턴 종단점이며, OFF는 패턴 연결 브릿지로 쓰이지 않음.
function connectedPatternDays(pid, anchorDay) {
  const anchorSched = state.schedules.find(s => s.day === anchorDay && s.patternId === pid && scheduleInCurrentMonth(s));
  // OFF 당일 클릭: 단독 선택
  if (!anchorSched || anchorSched.type === "OFF") return [anchorDay];

  const pidSched = state.schedules
    .filter(s => s.patternId === pid && scheduleInCurrentMonth(s))
    .sort((a, b) => a.day - b.day);
  const allDays = pidSched.map(s => s.day);
  const idx = allDays.indexOf(anchorDay);
  if (idx < 0) return [anchorDay];

  let start = idx, end = idx;
  // 전방 확장: ARRIVAL이 현재 end면 그 이후는 다른 패턴
  while (end < allDays.length - 1 && allDays[end + 1] === allDays[end] + 1) {
    if (pidSched[end].type === "ARRIVAL") break;
    if (pidSched[end + 1].type === "OFF") break;
    end++;
  }
  // 후방 확장: 직전 일이 ARRIVAL이면 이전 패턴의 끝, OFF이면 연결 고리 없음
  while (start > 0 && allDays[start - 1] === allDays[start] - 1) {
    if (pidSched[start - 1].type === "ARRIVAL") break;
    if (pidSched[start - 1].type === "OFF") break;
    start--;
  }
  return allDays.slice(start, end + 1);
}

// selectedDays 키 형식: "YYYY-MM-DD"
function dayKey(day, month) {
  return `${month || state.currentMonth}-${String(day).padStart(2, '0')}`;
}
function parseDayKey(key) {
  return { month: key.slice(0, 7), day: parseInt(key.slice(8), 10) };
}

function refreshScheduleSelectionUi() {
  renderCalendar();
  renderSelection();
  renderRuleCheck();
  syncOfferedSlot();
  renderPendingBar();
}

function resetScheduleSelection(render = true) {
  window.CrewSwapSelectionFlow?.reset(state);
  if (render) refreshScheduleSelectionUi();
}

function beginScheduleSelection(purpose, postId = null, render = false) {
  window.CrewSwapSelectionFlow?.begin(state, purpose, postId);
  if (render) refreshScheduleSelectionUi();
}
function areConsecCalendarDays(k1, k2) {
  return (new Date(k2) - new Date(k1)) === 86400000;
}

// 선택한 날짜들을 '연속된 날짜' 단위로 끊어 독립 패턴 목록을 만든다.
// 예: 2, 11, 12, 26 → [[2], [11,12], [26]] — 각각 별개의 스왑 글이고 크레딧도 따로 든다.
// 등록 시점과 화면 표시가 같은 기준을 쓰도록 여기 한 곳에서만 판단한다.
function groupConsecutiveDayKeys(dayKeys) {
  const sorted = [...dayKeys].sort();
  if (!sorted.length) return [];
  const groups = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (areConsecCalendarDays(sorted[i - 1], sorted[i])) cur.push(sorted[i]);
    else { groups.push(cur); cur = [sorted[i]]; }
  }
  groups.push(cur);
  return groups;
}

// 현재 선택을 독립 패턴 단위로 묶어, 각 그룹의 스케줄 배열로 돌려준다.
function selectedScheduleGroups() {
  return groupConsecutiveDayKeys([...state.selectedDays])
    .map(keys => keys
      .map(key => {
        const { day, month } = parseDayKey(key);
        return state.schedules.find(s => s.day === day && (s.month || state.currentMonth) === month);
      })
      .filter(Boolean))
    .filter(g => g.length);
}


function selectPattern(day) {
  if (!state.selectionPurpose) {
    state.selectionPurpose = state.pendingRequestType || "post";
  }
  let s = getSchedule(day);
  if (!s) {
    // 파싱 데이터가 없는 날(예: 다음 달로 넘어간 직후)도 선택은 가능하게 —
    // 빈 placeholder를 만들어 묶음 등록에 포함시킬 수 있도록 함
    s = { month: state.currentMonth, day, patternId: null, type: "UNKNOWN", title: "미정 (데이터 없음)" };
    state.schedules.push(s);
  }
  const isAdding = !state.selectedDays.has(dayKey(day));
  if (isAdding) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (dayToDate(day, s.month) < today) {
      showToast("이미 지난 근무는 SWAP/의향 표시를 할 수 없습니다.");
      return;
    }
  }

  // 패턴 자동 묶음 선택 비활성화 — CrewConnex 파싱이 묶음을 잘못 잡는 경우가 있어
  // 클릭한 날짜만 개별 토글 (여러 날을 묶고 싶으면 각각 클릭)
  const key = dayKey(day);
  if (state.selectedDays.has(key)) {
    state.selectedDays.delete(key);
  } else {
    state.selectedDays.add(key);
  }

  renderCalendar();
  renderSelection();
  renderRuleCheck();
  syncOfferedSlot();
  renderPendingBar();
}

// 요청/의향묻기 진행 중일 때 하단에 뜨는 "N일 선택됨 · 다음" 바
function renderPendingBar() {
  const bar = $("#pendingActionBar");
  if (!bar) return;
  if (!state.pendingRequestPostId) { bar.hidden = true; return; }
  const n = selectedSchedules().length; // 이제 '잠금할 근무' 수
  const label = state.pendingRequestType === "ask" ? "의향 표시" : "요청";
  // 내가 바꾸려던 상대 근무(대상 포스트)를 간단히 표시
  const target = state.posts.find(p => p.id === state.pendingRequestPostId);
  const targetHtml = target ? `
    <span class="pending-target">
      <span class="pending-target-label">🎯 바꾸려는 상대 근무</span>
      <span class="pending-target-name">${escapeHtml(target.offered.patternName || "")}</span>
      <span class="pending-target-sub">${escapeHtml(target.offered.summary || target.offered.type || "")} · ${(target.offered.days || []).length}일</span>
    </span>` : "";
  const guide = n > 0
    ? `🙈 내 스케줄 ${n}일 숨김 — 나머지 일정만 상대에게 보여집니다. 다음을 누르세요 (${label})`
    : `상대에게 보여주기 싫은 근무는 달력에서 눌러 '내 스케줄 숨기기'로 선택하세요. (${label})`;
  $("#pendingActionText").innerHTML = `${targetHtml}<span class="pending-guide">${guide}</span>`;
  $("#pendingActionNext").disabled = false; // 잠금 0개(전체 공개)도 진행 가능
  bar.hidden = false;
}

function cancelPendingAction() {
  resetScheduleSelection();
}

function confirmPendingAction() {
  const { postId: pid, type } = window.CrewSwapSelectionFlow?.detachPending(state) || {};
  if (!pid) return;
  renderPendingBar();
  switchTab("find", { preserveSelection: true });
  setTimeout(() => {
    if (type === "ask") openAskModal(pid);
    else openRequestModal(pid);
  }, 50);
}

function selectedSchedules() {
  return [...state.selectedDays].sort().map(key => {
    const { month, day } = parseDayKey(key);
    return state.schedules.find(s => s.day === day && (s.month || state.currentMonth) === month);
  }).filter(Boolean);
}

/* ====== 5b. CrewConnex 텍스트 파서 ====== */
const WEEKDAY_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|월|화|수|목|금|토|일)$/i;

function normalizeTime(t) {
  if (!t) return null;
  const m = /^(\d{1,2}):?(\d{2})(\+1)?$/.exec(t.trim());
  if (!m) return null;
  return `${m[1].padStart(2,"0")}:${m[2]}${m[3]||""}`;
}

function parseCrewConnexPaste(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim().replace(/\([LZ]\)/gi,"").trim()).filter(Boolean);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    // 일자 시작 감지: 줄 맨 앞 1~31 + 공백 (시간 HH:MM 아닌 것)
    const dayMatch = /^(\d{1,2})(?:\s+|$)/.exec(line);
    const isTime = /^\d{1,2}:\d{2}/.test(line);
    if (dayMatch && !isTime) {
      const n = parseInt(dayMatch[1], 10);
      if (n >= 1 && n <= 31) {
        const rest = line.slice(dayMatch[0].length).trim();
        cur = { day: n, lines: rest ? [rest] : [] };
        blocks.push(cur);
        continue;
      }
    }
    if (cur) cur.lines.push(line);
  }
  const parsed = blocks.map(parseDayBlock);
  return fillLayoverGaps(assignPatternIds(parsed));
}

function parseDayBlock(block) {
  // 첫 토큰이 요일이면 제거
  const rawTokens = block.lines.join(" ").split(/\s+/).filter(Boolean);
  const tokens = rawTokens.filter(t => !WEEKDAY_RE.test(t));
  const full = tokens.join(" ");
  const day = block.day;
  const base = { day, patternId: null };

  // OFF
  if (/^(OFF|REST)\b/i.test(full) && !/(LAYOV|7C\d|[A-Z]{3}-[A-Z]{3})/i.test(full)) {
    return { ...base, type:"OFF", title:"OFF", crewComposition:"편조 없음" };
  }
  // LAYOV
  const lay = /LAYOV\s*[\(\[]?\s*([A-Z]{3})/i.exec(full);
  if (lay) {
    const ap = lay[1].toUpperCase();
    return { ...base, type:"LAYOV", title:`LAYOV ${ap}`, layoverAirport:ap, aircraft:"NG", crewComposition:`${ap} 체류` };
  }
  // RSV
  if (/\bRSV\b|Reserve/i.test(full)) {
    const timeRange = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(full);
    return { ...base, type:"RSV", title:"RSV",
      reportTime: normalizeTime(timeRange?.[1]) || "09:00",
      releaseTime: normalizeTime(timeRange?.[2]) || "17:00",
      crewComposition:"대기 · 편조 미정" };
  }
  // STBY
  if (/\bSTBY\b|Standby/i.test(full)) {
    const timeRange = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(full);
    return { ...base, type:"STBY", title:"STBY",
      reportTime: normalizeTime(timeRange?.[1]) || "20:00",
      releaseTime: normalizeTime(timeRange?.[2]) || "02:00",
      crewComposition:"대기 · 편조 미정" };
  }
  // PICK UP (단독)
  if (/\bPICK\s*UP\b/i.test(full) && !/[A-Z]{3}-[A-Z]{3}/.test(full)) {
    return { ...base, type:"PICK UP", title:"PICK UP", crewComposition:"배정 시 확정" };
  }
  // 비행
  const route = /([A-Z]{3})\s*[-–]\s*([A-Z]{3})/.exec(full);
  const flight = /(7C\s?\d{3,4})/i.exec(full);
  const times = [...full.matchAll(/(\d{1,2}:\d{2}(?:\+1)?)/g)].map(m => normalizeTime(m[1])).filter(Boolean);
  // 지상근무·훈련(JCRM 지상수업 / SIM 등): 실제 여객편(7C 편명)이 없고
  // 출·도착 공항이 같은 반복 형태(GMP-GMP, GMP-GMP-GMP)는 비행이 아니다.
  // → 국내선으로 오인하지 않도록 별도 분류하고 스왑 대상에서 제외한다.
  if (route && !flight) {
    // 공항이 아닌 근무 코드(SIM/OPC 등)를 공항으로 오인하지 않도록 제외
    const NON_AIRPORT = new Set(["SIM","OPC","LPC","LOFT","SPT","GND","JCRM","RSV","OFF","VAC","REST","STBY","PICK","LAYOV"]);
    const airports = [...full.matchAll(/\b([A-Z]{3})\b/g)]
      .map(m => m[1].toUpperCase())
      .filter(a => !NON_AIRPORT.has(a));
    const uniqAir = [...new Set(airports)];
    if (uniqAir.length === 1) {
      const isSim = /\b(SIM|OPC|LPC|LOFT|SPT)\b/i.test(full);
      return { ...base, type:"GND", ground: isSim ? "SIM" : "지상",
        title: isSim ? "SIM 훈련" : "지상근무",
        station: uniqAir[0],
        reportTime: times[0] || null,
        releaseTime: times[times.length-1] || times[0] || null,
        crewComposition: "비행 아님 · 회사 지정 근무",
        lockReason: (isSim ? "SIM 훈련" : "지상근무") + " — 비행 아님, SWAP 불가" };
    }
  }
  if (route) {
    const [, dep, arr] = [route[0], route[1].toUpperCase(), route[2].toUpperCase()];
    const region = AIRPORT_REGION[arr] || AIRPORT_REGION[dep] || "OTHER";
    const isDom = region === "DOMESTIC";
    const isSpecialIntl = !isDom && (SPECIAL_AIRPORTS.includes(arr) || SPECIAL_AIRPORTS.includes(dep));
    // 제주항공 EDTO: GUM / SPN만
    const isEdto = arr === "GUM" || arr === "SPN" || dep === "GUM" || dep === "SPN";
    return {
      ...base,
      type: isDom ? "국내선" : "국제선",
      title: flight ? flight[1].replace(/\s/g,"").toUpperCase() : `${dep}-${arr}`,
      dep, arr,
      reportTime: times[0] || null,
      arrivalTime: times[1] || null,
      releaseTime: times[2] || times[1] || null,
      aircraft: "NG",
      requiresEdto: isEdto,
      requiresCat3: false,
      captainGrade: "B", foGrade: "B",
      crewComposition: "PIC B · FO B · (편조 정보 입력 필요)",
      lockReason: arr === "TAG" && /자격|갱신|qualif/i.test(full) ? "특수공항 자격 갱신 비행" : undefined,
    };
  }
  // 인식 불가 — 사용자 편집 유도
  return { ...base, type:"UNKNOWN", title: full.slice(0,40) || "(빈 항목)", raw: full };
}

function assignPatternIds(schedules) {
  // 일자 정렬
  const arr = schedules.slice().sort((a,b) => a.day - b.day);
  let pid = 1;
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (s.patternId) continue;
    if (s.type === "OFF") continue;
    // 국제선 시작 → 다음 국제선까지 같은 패턴 (연속 일자만)
    if (s.type === "국제선") {
      const tag = `P${pid++}`;
      s.patternId = tag;
      let prevDay = s.day;
      for (let j = i + 1; j < arr.length; j++) {
        const next = arr[j];
        if (next.day !== prevDay + 1) break;
        if (next.type === "LAYOV" || next.type === "국제선") {
          next.patternId = tag;
          prevDay = next.day;
          if (next.type === "국제선") break; // 복귀편
        } else break;
      }
    } else {
      // 단일 일자 패턴 (국내선/RSV/STBY/PICK UP)
      s.patternId = `P${pid++}`;
    }
  }
  return arr;
}

function fillLayoverGaps(schedules) {
  // 국제선 outbound ↔ inbound 사이 미인식 일자를 LAYOV로 보완
  const arr = schedules.slice().sort((a,b) => a.day - b.day);
  for (let i = 0; i < arr.length; i++) {
    const out = arr[i];
    if (out.type !== "국제선" || !out.arr) continue;
    for (let j = i + 1; j < arr.length; j++) {
      const back = arr[j];
      if (back.type === "국제선" && back.dep === out.arr) {
        for (let k = i + 1; k < j; k++) {
          const mid = arr[k];
          if (mid.day === arr[k-1].day + 1 && (mid.type === "UNKNOWN" || mid.type === "PICK UP")) {
            mid.type = "LAYOV";
            mid.title = `LAYOV ${out.arr}`;
            mid.layoverAirport = out.arr;
            mid.aircraft = out.aircraft || "NG";
            mid.crewComposition = `${out.arr} 체류`;
            mid.patternId = out.patternId;
          }
        }
        break;
      }
    }
  }
  return arr;
}

/* ====== 5c. 파싱 미리보기 / 편집 ====== */
let previewSchedules = [];

const TYPE_OPTIONS = ["OFF","VAC","국내선","국제선","LAYOV","RSV","STBY","PICK UP","ARRIVAL","GND","UNKNOWN"];
const GRADE_OPTIONS = ["","A","B","C"];

function openImportDialog() {
  $("#parsePreview").hidden = true;
  $("#defaultDialogActions").hidden = false;
  $$(".import-mode").forEach(el => { el.hidden = el.id !== "autoMode"; });
  $$(".import-tab").forEach(t => t.classList.toggle("is-active", t.dataset.mode === "auto"));
  openGenericModal("crewDialog", "crewOverlay");
}

// CrewConnex 서버 파싱은 지상근무(JCRM)·SIM을 GMP-GMP 형태의 '비행'으로 내려준다.
// 실제 여객편(7C 편명)이 없고 출·도착 공항이 동일하면 GND(지상/훈련)로 재분류해
// 국내선 비행으로 오인·스왑되지 않게 한다. (parseDayBlock의 수동 파싱과 동일 기준)
function reclassifyGroundDuty(s) {
  if (!s || !["국내선", "국제선", "UNKNOWN"].includes(s.type)) return s;
  const title = s.title || "";
  if (/7C\s?\d/i.test(title)) return s; // 실제 여객편은 제외
  const NON_AIRPORT = new Set(["SIM","OPC","LPC","LOFT","SPT","GND","JCRM","RSV","OFF","VAC","REST","STBY","PICK","LAYOV"]);
  const codes = [];
  if (s.dep) codes.push(s.dep);
  if (s.arr) codes.push(s.arr);
  `${title} ${s.routeSummary || ""}`.match(/\b[A-Z]{3}\b/g)?.forEach(c => codes.push(c));
  const air = [...new Set(codes.map(c => c.toUpperCase()).filter(c => !NON_AIRPORT.has(c)))];
  if (air.length !== 1) return s;
  const isSim = /\b(SIM|OPC|LPC|LOFT|SPT)\b/i.test(`${title} ${s.routeSummary || ""}`);
  s.type = "GND";
  s.ground = isSim ? "SIM" : "지상";
  s.title = isSim ? "SIM 훈련" : "지상근무";
  s.station = air[0];
  s.lockReason = (isSim ? "SIM 훈련" : "지상근무") + " — 비행 아님, SWAP 불가";
  s.crewComposition = "비행 아님 · 회사 지정 근무";
  delete s.dep; delete s.arr; delete s.routeSummary; delete s.legs; delete s.aircraft;
  return s;
}

function showPreview(schedules) {
  // 월 → 일 순으로 정렬 (다중 월 시 같은 일자가 섞이지 않도록)
  previewSchedules = schedules.map(reclassifyGroundDuty).sort((a, b) => {
    const ma = a.month || "", mb = b.month || "";
    if (ma !== mb) return ma < mb ? -1 : 1;
    return a.day - b.day;
  });
  $$(".import-mode").forEach(el => el.hidden = true);
  $("#parsePreview").hidden = false;
  $("#defaultDialogActions").hidden = true;
  renderPreviewTable();
}

function renderPreviewTable() {
  const html = `
    <table class="preview-table">
      <thead><tr>
        <th>월</th><th>일</th><th>유형</th><th>편명/타이틀</th><th>출-도/LAYOV</th>
        <th>리포트</th><th>도착</th><th>릴리즈</th><th>기종</th>
        <th>CAPT</th><th>FO</th><th>EDTO</th><th>CAT3</th><th>패턴ID</th><th></th>
      </tr></thead>
      <tbody>
        ${previewSchedules.map((s, i) => {
          const route = s.routeSummary || (s.dep && s.arr ? `${s.dep}-${s.arr}` : (s.layoverAirport || ""));
          const warn = s.type === "UNKNOWN" || (s.type === "국제선" && !s.captainGrade);
          const monthLabel = s.month ? s.month.slice(2).replace("-", "/") : "—";
          return `<tr class="${warn?"has-warning":""}">
            <td style="font-weight:700;color:var(--muted);font-size:11px;white-space:nowrap;">${monthLabel}</td>
            <td><input type="number" min="1" max="31" value="${s.day}" data-i="${i}" data-k="day" /></td>
            <td><select data-i="${i}" data-k="type">${TYPE_OPTIONS.map(t => `<option ${s.type===t?"selected":""}>${t}</option>`).join("")}</select></td>
            <td><input value="${s.title||""}" data-i="${i}" data-k="title" /></td>
            <td><input value="${route}" data-i="${i}" data-k="route" placeholder="ICN-CJU 또는 CXR" /></td>
            <td><input value="${s.reportTime||""}" data-i="${i}" data-k="reportTime" placeholder="HH:MM" /></td>
            <td><input value="${s.arrivalTime||""}" data-i="${i}" data-k="arrivalTime" placeholder="HH:MM" /></td>
            <td><input value="${s.releaseTime||""}" data-i="${i}" data-k="releaseTime" placeholder="HH:MM" /></td>
            <td><select data-i="${i}" data-k="aircraft"><option value="">-</option><option ${s.aircraft==="NG"?"selected":""}>NG</option><option ${s.aircraft==="MAX"?"selected":""}>MAX</option></select></td>
            <td><select data-i="${i}" data-k="captainGrade">${GRADE_OPTIONS.map(g => `<option value="${g}" ${(s.captainGrade||"")===g?"selected":""}>${g||"-"}</option>`).join("")}</select></td>
            <td><select data-i="${i}" data-k="foGrade">${GRADE_OPTIONS.map(g => `<option value="${g}" ${(s.foGrade||"")===g?"selected":""}>${g||"-"}</option>`).join("")}</select></td>
            <td><input type="checkbox" ${s.requiresEdto?"checked":""} data-i="${i}" data-k="requiresEdto" /></td>
            <td><input type="checkbox" ${s.requiresCat3?"checked":""} data-i="${i}" data-k="requiresCat3" /></td>
            <td><input value="${s.patternId||""}" data-i="${i}" data-k="patternId" placeholder="P1" style="width:50px;" /></td>
            <td><button type="button" class="row-del" data-del="${i}" title="삭제">×</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  $("#previewTable").innerHTML = html;
  $$("#previewTable [data-del]").forEach(b => b.onclick = () => {
    previewSchedules.splice(parseInt(b.dataset.del,10), 1);
    renderPreviewTable();
  });
}

function collectPreviewEdits() {
  $$("#previewTable [data-i]").forEach(el => {
    const i = parseInt(el.dataset.i, 10);
    const k = el.dataset.k;
    const s = previewSchedules[i];
    if (!s) return;
    if (el.type === "checkbox") {
      s[k] = el.checked;
    } else if (k === "day") {
      s.day = parseInt(el.value, 10) || s.day;
    } else if (k === "route") {
      const v = el.value.trim().toUpperCase();
      // 다구간 (A-B-C-D, A→B→C→D, A>B>C>D) / 2구간 (A-B) / LAYOV (A) 자동 분기
      const segs = v.split(/\s*[-→>]\s*/).filter(x => /^[A-Z]{3}$/.test(x));
      if (segs.length >= 3) {
        s.routeSummary = segs.join("→");
        s.dep = segs[0]; s.arr = segs[segs.length - 1];
        s.legs = segs.length - 1;
        delete s.layoverAirport;
      } else if (segs.length === 2) {
        s.dep = segs[0]; s.arr = segs[1];
        delete s.routeSummary; delete s.legs; delete s.layoverAirport;
      } else if (segs.length === 1) {
        s.layoverAirport = segs[0];
        delete s.dep; delete s.arr; delete s.routeSummary; delete s.legs;
      } else {
        delete s.dep; delete s.arr; delete s.layoverAirport; delete s.routeSummary; delete s.legs;
      }
    } else if (k === "reportTime" || k === "arrivalTime" || k === "releaseTime") {
      s[k] = normalizeTime(el.value) || null;
    } else {
      s[k] = el.value || null;
    }
    // crewComposition 자동 보강
    if (s.captainGrade && s.foGrade && s.type !== "OFF") {
      s.crewComposition = `PIC ${s.captainGrade} · FO ${s.foGrade}`;
      if (s.requiresEdto) s.crewComposition += " · EDTO";
      if (s.requiresCat3) s.crewComposition += " · CAT III";
    }
  });
  return previewSchedules.filter(s => s.day >= 1 && s.day <= 31);
}


// 분 → "HH:MM" (CrewConnex 형식)
function formatHM(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function calcCumulative() {
  const monthScheds = currentMonthSchedules();
  const totalMin = monthScheds.reduce((sum, s) => sum + flightMinutesOf(s), 0);
  const dayCount = daysInCurrentMonth();
  let maxConsec = 0, current = 0;
  for (let d = 1; d <= dayCount; d++) {
    const s = getSchedule(d);
    if (s && !NON_DUTY_TYPES.has(s.type)) { current++; maxConsec = Math.max(maxConsec, current); }
    else current = 0;
  }
  // warnDays: 달력 셀에 ⚠ 경고 아이콘(.is-warn-consec)을 띄우는 날짜 집합.
  // 회사 최대 연속 근무일(dutyConsecLimit, 운항 5일/객실 7일) 한도 "하루 전" 시점에
  // 도달한 날부터 경고 — 이 날짜에 근무를 더 얹으면(스왑 등) 한도 초과 위험이라는 사전 알림.
  // OFF/RSV 등 NON_DUTY_TYPES는 연속 카운트를 리셋시킴.
  const consecLimit = (currentRules().dutyConsecLimit || 5) - 1;
  const warnDays = new Set();
  let run = 0;
  for (let d = 1; d <= dayCount; d++) {
    const s = getSchedule(d);
    if (s && !NON_DUTY_TYPES.has(s.type)) { run++; if (run >= consecLimit) warnDays.add(d); }
    else run = 0;
  }
  return { totalHours: totalMin / 60, maxConsec, warnDays };
}

function dDayInfo(day, month) {
  // 회사 근무교환 신청 마감: 패턴 시작일 기준 영업일 역산
  // (조종사 2영업일 전 17시 / 객실 3영업일 전)
  const rules = currentRules();
  const bDays = (rules.deadline && rules.deadline.businessDays) || 2;
  const deadlineHour = (rules.deadline && rules.deadline.hour) || 17;
  const start = dayToDate(day, month);
  const deadline = addBusinessDays(start, -bDays);
  deadline.setHours(deadlineHour, 0, 0, 0);
  const diffMs = deadline - today();
  if (diffMs < 0) return { expired: true, deadlineDate: deadline };
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return { expired: false, days, hours, deadlineDate: deadline };
}

function sameCalendarDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function companyDeadlineDueText(dd) {
  if (!dd?.deadlineDate) return "회사 제출 시각 확인 필요";
  const deadline = dd.deadlineDate;
  const hour = String(deadline.getHours()).padStart(2, "0");
  const minute = String(deadline.getMinutes()).padStart(2, "0");
  const time = minute === "00" ? `${Number(hour)}시` : `${hour}:${minute}`;
  if (sameCalendarDate(deadline, today())) return `오늘 ${time}`;
  return `${deadline.getMonth() + 1}/${deadline.getDate()} ${time}`;
}

function companyDeadlineText(day, month, dd) {
  const target = dayToDate(day, month);
  const targetLabel = `${target.getMonth() + 1}/${target.getDate()} 근무교환`;
  const due = companyDeadlineDueText(dd);
  return dd?.expired
    ? `${targetLabel} 회사 제출 마감됨 (${due})`
    : `${targetLabel} 회사 제출: ${due}까지`;
}

function crewPairingCheck(s) {
  if (!s.captainGrade || !s.foGrade) return { status:"NA", label:"편조 기준 해당 없음", detail:"OFF/RSV/STBY/LAYOV" };
  // 미가입 → 등급 모름, 확인 필요
  if (!state.user.hasSignedUp) {
    return { status:"WARN", label:"가입 후 확인 가능", detail:"내 등급 정보가 없어 편조 기준 자동 체크 불가" };
  }
  const isCapt = state.user.roleType.startsWith("CAPTAIN");
  const myGrade = state.user.roleType.replace("CAPTAIN_","").replace("FO_","");
  if (isCapt) {
    // 기장: 내 등급이 허용하는 FO 등급 목록 확인
    const allowedFo = FO_GRADES_BY_CAPTAIN_GRADE[myGrade] || [];
    if (!allowedFo.includes(s.foGrade)) {
      return { status:"FAIL", label:"편조 기준 불가", detail:`${myGrade}등급 기장 → ${allowedFo.join("/")}등급 부기장만 가능 (이 스케줄: ${s.foGrade}등급)` };
    }
    return { status:"PASS", label:"편조 기준 충족", detail:`${myGrade}등급 기장 · ${s.foGrade}등급 부기장 편조 가능` };
  } else {
    // 부기장: 내 등급을 허용하는 기장 등급 목록 확인
    const allowedCapt = Object.entries(FO_GRADES_BY_CAPTAIN_GRADE)
      .filter(([, fos]) => fos.includes(myGrade))
      .map(([k]) => k);
    if (!allowedCapt.includes(s.captainGrade)) {
      return { status:"FAIL", label:"편조 기준 불가", detail:`${myGrade}등급 부기장은 ${allowedCapt.join("/")}등급 기장과만 편조 가능 (이 스케줄: ${s.captainGrade}등급 기장)` };
    }
    return { status:"PASS", label:"편조 기준 충족", detail:`${s.captainGrade}등급 기장 · ${myGrade}등급 부기장 편조 가능` };
  }
}

function userAircraftOK(s) {
  if (!s.aircraft) return true;
  if (state.user.aircraft === "NG_MAX") return true;
  return state.user.aircraft === s.aircraft;
}
function userQualOK(s) {
  if (s.requiresEdto && !state.user.edto) return false;
  if (s.requiresCat2 && !state.user.cat2) return false;
  if (s.requiresCat3 && !state.user.cat3) return false;
  return true;
}

function checkRulesCabin(ss, rules) {
  const cum = calcCumulative();
  const firstDay = ss[0].day;
  const dd = dDayInfo(firstDay, ss[0].month);
  const hasLocked = ss.some(s => s.lockReason);
  const blockedHoliday = ss.some(s => isHoliday(s.day));

  // 연속 근무 7일 체크
  const consecLimit = rules.dutyConsecLimit || 7;
  const consecFail = cum.maxConsec >= consecLimit;
  const consecWarn = !consecFail && cum.maxConsec >= consecLimit - 1;

  // RSV 다음날 OFF 불가 체크 (RSV 선택 시 다음날이 OFF면 불가)
  let rsvNextOff = false;
  ss.forEach(s => {
    if (s.type !== "RSV") return;
    const next = getSchedule(s.day + 1);
    if (next && next.type === "OFF") rsvNextOff = true;
  });

  // RSV/STBY 부분 선택 차단 (인접 RSV/STBY 미선택)
  let partialRsvStby = false;
  ss.forEach(s => {
    if (s.type !== "RSV" && s.type !== "STBY") return;
    [s.day - 1, s.day + 1].forEach(d => {
      const adj = getSchedule(d);
      if (adj && (adj.type === "RSV" || adj.type === "STBY") && !state.selectedDays.has(dayKey(d))) {
        partialRsvStby = true;
      }
    });
  });

  // UV_ML 포함 여부 (변경 불가)
  const hasUvml = ss.some(s => s.type === "UV_ML");

  // STBY/RSV 변경 시 동일 or 상위 직급만 가능
  // (내 직급 코드: roleType이 CC/AP/PS/SP/CP)
  const myRankCode = (state.user.roleType || "CC").toUpperCase();
  const myRank = CABIN_RANK[myRankCode] || 1;
  // 이 체크는 스왑 상대방 정보가 필요해서 여기선 Info 안내만 표시
  const hasStby = ss.some(s => s.type === "STBY" || s.type === "RSV");

  const deadlineLabel = "회사 근무교환 신청 마감";

  // 방송등급 미보유 → RSV/STBY 불가
  const noBroadcast = !state.user.hasBroadcastRating;
  const rsvStbySelected = ss.some(s => s.type === "RSV" || s.type === "STBY");
  const broadcastFail = noBroadcast && rsvStbySelected;

  // 월/연 스왑 횟수 (운항승무원은 제한 없음)
  const isPilotUser  = state.user.crewType !== "CABIN";
  const monthlyLimit = rules.swapLimitMonthly || 2;
  const yearlyLimit  = rules.swapLimitYearly  || 12;
  const monthlyUsed  = state.user.monthlySwapUsed || 0;
  const yearlyUsed   = state.user.yearlySwapUsed  || 0;
  const monthlyFail  = !isPilotUser && monthlyUsed >= monthlyLimit;
  const yearlyFail   = !isPilotUser && yearlyUsed  >= yearlyLimit;

  // 노선 언어/성별 자격 안내
  const langs = state.user.languages || [];
  const gender = state.user.gender || "F";
  const langLabels = { Japanese:"일본어 전공", Chinese:"중국어 전공", Ann_JA:"일본어 방송", Ann_CA:"중국어 방송" };
  const langStr = langs.length ? langs.map(k => langLabels[k] || k).join(", ") : "없음";
  const genderStr = gender === "M" ? "남성" : "여성";

  return [
    { label: deadlineLabel,
      status: dd.expired ? "FAIL" : dd.days < 1 ? "WARN" : "PASS",
      detail: companyDeadlineText(firstDay, ss[0].month, dd),
      ref: `Swap Guide p.47 — 스왑 성사 후 회사 시스템에 근무교환 신청서를 변경 시작일의 ${rules.deadline.businessDays}영업일 전까지 제출해야 합니다. 마감 이후에는 회사 접수가 불가합니다.` },
    { label:`연속 근무일 (${consecLimit}일 미만)`,
      status: consecFail ? "FAIL" : consecWarn ? "WARN" : "PASS",
      detail:`최대 ${cum.maxConsec}일`,
      ref: "Swap Guide p.48 — 스왑 후 7일 이상 연속 근무가 발생하면 신청 불가. OFF·VAC는 연속 근무일 계산에서 제외됩니다." },
    { label:"RSV 다음날 OFF 불가",
      status: rsvNextOff ? "FAIL" : "PASS",
      detail: rsvNextOff ? "RSV 포함 최소 3일 SKD 필요" : "해당 없음",
      ref: "Swap Guide p.48 — RSV를 포함한 스왑 시 패턴 전체(최소 3일)를 함께 변경해야 합니다. RSV 다음날 OFF 단독 스왑 불가." },
    { label:"변경 불가 타입 (UV_ML)",
      status: hasUvml ? "FAIL" : "PASS",
      detail: hasUvml ? "UV_ML은 스왑 불가" : "해당 없음",
      ref: "Swap Guide p.48 — UV_ML 코드가 포함된 스케줄은 변경 불가 대상입니다." },
    { label:"변경 불가 지정 근무",
      status: hasLocked ? "FAIL" : "PASS",
      detail: hasLocked ? "회사 지정 변경 불가 근무 포함" : "해당 없음",
      ref: "회사 지정 변경 불가 근무(예: 특별편, 의전, 훈련 비행 등)는 스왑 대상에서 제외됩니다." },
    { label:"공휴일/연휴 SWAP 제한",
      status: blockedHoliday ? "WARN" : "PASS",
      detail: blockedHoliday ? "공휴일 포함 — 회사 정책 추가 확인" : "해당 없음",
      ref: "Swap Guide p.49 — 공휴일·연휴 기간 스왑은 별도 회사 정책 적용. 편조팀 사전 문의 권장 (070-7420-1756)." },
    { label:"RSV/STBY 부분 SWAP 차단",
      status: partialRsvStby ? "FAIL" : "PASS",
      detail: partialRsvStby ? "부분 선택 불가 — 패턴 단위" : "해당 없음",
      ref: "Swap Guide p.48 — RSV·STBY는 연속된 패턴 전체를 단위로만 변경 가능. 인접 RSV/STBY 중 일부만 선택하는 것은 불가." },
    { label:"방송등급 미보유 RSV/STBY 불가",
      status: broadcastFail ? "FAIL" : "PASS",
      detail: broadcastFail ? "방송등급 미보유 — RSV·공항대기(STBY) 변경 불가 (규정 5.아)" : "해당 없음",
      ref: "객실 생활 백과사전 5.아 — 방송등급 미보유 승무원은 RSV(대기) 및 공항대기(STBY) 근무에 배정될 수 없으므로 해당 유형의 스왑 불가." },
    { label: isPilotUser ? "월 스왑 횟수 (무제한)" : `월 스왑 횟수 (월 ${monthlyLimit}회)`,
      status: monthlyFail ? "FAIL" : (!isPilotUser && monthlyUsed >= monthlyLimit - 1 ? "WARN" : "PASS"),
      detail: isPilotUser ? "운항승무원 — 제한 없음" : `이번 달 ${monthlyUsed}/${monthlyLimit}회 사용`,
      ref: isPilotUser ? null : "Swap Guide p.47 — 스왑은 월 2회, 연 12회를 초과할 수 없습니다. 카운트는 스왑이 실제 성사(상호 수락)된 경우에만 증가합니다." },
    { label: isPilotUser ? "연 스왑 횟수 (무제한)" : `연 스왑 횟수 (연 ${yearlyLimit}회)`,
      status: yearlyFail ? "FAIL" : (!isPilotUser && yearlyUsed >= yearlyLimit - 2 ? "WARN" : "PASS"),
      detail: isPilotUser ? "운항승무원 — 제한 없음" : `올해 ${yearlyUsed}/${yearlyLimit}회 사용`,
      ref: isPilotUser ? null : "Swap Guide p.47 — 연간 스왑 총 횟수는 12회 한도. 월 한도(2회)와 별도로 적용됩니다." },
    { label:"STBY/RSV 직급 조건",
      status: hasStby ? "WARN" : "PASS",
      detail: hasStby
        ? `STBY/RSV 변경 시 동일 or 상위 직급(${CABIN_ROLE_LABELS[myRankCode] || myRankCode} 이상)만 가능 — 상대방 확인 필요`
        : "해당 없음",
      ref: "Swap Guide p.49 — STBY·RSV 스왑의 경우 본인보다 동일 직급 또는 상위 직급 승무원과만 교환 가능합니다." },
    { label:"6일 연속 근무 랜딩 시간",
      status:"WARN",
      detail:"6일 연속 근무 시 마지막 날 랜딩 20:00 이전 SKD인지 직접 확인 필요",
      ref: "Swap Guide p.48 — 연속 6일 근무가 되는 경우, 6일차 비행의 착륙 시각(STA)이 20:00 이전인 스케줄만 배정 가능. 앱에서 자동 확인 불가 — 직접 CrewConnex에서 확인 필요." },
    { label:"Base별 신청 가능 시간",
      status:"WARN",
      detail:"전날 복귀(STA) 기준 신청 가능 시간 확인 (예: ICN-ICN STA 22:00 기준 당일 13:00 이후 STD)",
      ref: "Swap Guide p.47 Base별 휴식시간 기준표 — 전날 도착(STA) 이후 충분한 휴식 후 신청 가능. ICN-ICN: STA 22:00 기준 다음날 13:00 이후 / GMP-GMP: 12:10 이후 / PUS-PUS: 11:30 이후 등. 앱에서 자동 확인 불가 — 직접 확인 필요." },
    { label:"노선 언어/성별 자격",
      status:"WARN",
      detail:`내 자격: ${genderStr} · ${langStr} — MNL(남성 필수), 일본/중국 노선 배정 자격 확인`,
      ref: "객실 편조 기준 — MNL(마닐라) 노선은 남성 승무원 1인 이상 필수 탑승. 일본 노선은 일본어 전공 또는 일본어 방송 자격 보유자 배정 우선. 중국 노선도 동일 기준 적용." },
  ];
}

function checkRulesForSelection() {
  const ss = selectedSchedules();
  if (ss.length === 0) return [];
  const rules = currentRules();

  // 객실 승무원: 별도 룰 체크
  if (state.user.crewType === "CABIN") return checkRulesCabin(ss, rules);

  const cum = calcCumulative();
  const firstDay = ss[0].day;
  const dd = dDayInfo(firstDay, ss[0].month);

  const totalFlightMin = ss.reduce((sum, s) => sum + flightMinutesOf(s), 0);
  const monthAfter = cum.totalHours; // 단순화: 선택분 포함 합계

  const pairChecks = ss.map(s => crewPairingCheck(s));
  const pairFail = pairChecks.some(c => c.status === "FAIL");
  const pairWarn = !pairFail && pairChecks.some(c => c.status === "WARN");
  const pairDetailObj = pairChecks.find(c => c.status === "FAIL") || pairChecks.find(c => c.status === "WARN") || pairChecks.find(c => c.status === "PASS");
  const needsEdto = ss.some(s => s.requiresEdto);
  const needsCat3 = ss.some(s => s.requiresCat3);
  const hasLocked = ss.some(s => s.lockReason);

  // 특정 사유로 차단되는 패턴
  const blockedHoliday = ss.some(s => isHoliday(s.day));
  // 부분 RSV/STBY: 선택한 RSV/STBY 일자와 인접한 RSV/STBY가 미선택이면 partial
  // (OFF+RSV처럼 RSV가 단독이면 불가 아님 — 인접 RSV/STBY 미선택일 때만 불가)
  let partialRsvStby = false;
  ss.forEach(s => {
    if (s.type !== "RSV" && s.type !== "STBY") return;
    [s.day - 1, s.day + 1].forEach(d => {
      const adj = getSchedule(d);
      if (adj && (adj.type === "RSV" || adj.type === "STBY") && !state.selectedDays.has(dayKey(d))) {
        partialRsvStby = true;
      }
    });
  });

  return [
    { label:"동일 등급/직책 매칭", status:"PASS", detail: (() => {
        const pos = state.user.roleType.startsWith("CAPTAIN") ? "기장" : "부기장";
        return `${ROLE_LABELS[state.user.roleType]} · 동일 포지션(${pos}) 글만 노출`;
      })(),
      ref: "편조 기준 — 기장↔기장, 부기장↔부기장 간 스왑만 가능. 기장 A/B등급 간 교환은 가능하나 부기장↔기장 교환 불가." },
    { label:"비행 편조 기준", status: pairFail ? "FAIL" : pairWarn ? "WARN" : "PASS",
      detail: pairDetailObj ? pairDetailObj.detail : "편조 기준 충족",
      ref: "편조 기준표 — 기장 등급(A/B), 부기장 등급(A/B) 별 운항 가능 노선 제한. B등급 기장+A등급 FO 조합, A등급 기장+B등급 FO 조합 가능 여부 편조팀 확인 필요." },
    { label:"기종 조건", status: ss.every(userAircraftOK) ? "PASS" : "FAIL",
      detail: ss.every(userAircraftOK) ? "내 기종 자격으로 운항 가능" : "내 기종 자격으로 불가 가능성",
      ref: "기종 자격 — NG(B737-800)/MAX(B737-8/10) 자격은 별도 취득. NG 자격만 있으면 MAX 비행 불가. 기종이 다른 패턴과 스왑 시 자동 FAIL 처리됩니다." },
    { label:"EDTO 조건", status: needsEdto && !state.user.edto ? "FAIL" : "PASS",
      detail: needsEdto ? (state.user.edto ? "EDTO 자격 보유" : "EDTO 미보유 — 불가") : "해당 없음",
      ref: "EDTO (Extended-range Twin-engine Operations) — 쌍발 항공기 장거리 운항 자격. 제주항공의 경우 BKI·CXR·MNL 등 일부 국제노선 비행에 필요. EDTO 미보유 시 해당 비행 스왑 불가." },
    { label:"CAT II/III 조건", status: needsCat3 && !state.user.cat3 ? "WARN" : "PASS",
      detail: needsCat3 ? (state.user.cat3 ? "CAT III 자격 보유" : "CAT III 미보유 — 확인") : "해당 없음",
      ref: "CAT II/III — 저시정(안개 등) 착륙 자격. 특정 기상 조건이 예상되는 비행 편에 지정. 미보유 시 해당 비행 스왑 가능하나 기상 악화 시 운항 제한될 수 있어 편조팀 확인 권장." },
    { label:"회사 근무교환 신청 마감", status: dd.expired ? "FAIL" : dd.days < 1 ? "WARN" : "PASS",
      detail: companyDeadlineText(firstDay, ss[0].month, dd),
      ref: "스왑 성사 후 J-CREW에 근무교환 신청서를 변경 시작일의 2영업일 전 17:00까지 제출해야 합니다. 예: 수요일 비행 변경 건은 전주 월요일 17시까지이며, 이후에는 회사 접수가 불가합니다." },
    { label:"월 승무시간 (90h 미만)", status: monthAfter >= 90 ? "FAIL" : monthAfter >= 80 ? "WARN" : "PASS",
      detail:`현재 ${monthAfter.toFixed(1)}h / 90h`,
      ref: "항공법 제46조 및 운항기술기준 — 승무원 월 최대 비행 시간 90시간. 스왑 후 월 승무시간이 90시간을 초과하면 편조 불가. 80시간 이상 시 WARN 처리됩니다." },
    { label:"연속 근무일 (5일 미만)", status: cum.maxConsec >= 6 ? "FAIL" : cum.maxConsec >= 5 ? "WARN" : "PASS",
      detail:`최대 ${cum.maxConsec}일`,
      ref: "항공법 승무기준 — 조종사 연속 근무 한도 5일(OFF 제외). 5일째 WARN, 6일 이상 FAIL. OFF·VAC는 연속 근무일 계산에서 제외됩니다." },
    { label:"특수공항 자격 갱신 비행", status: hasLocked ? "FAIL" : "PASS",
      detail: hasLocked ? "자격 갱신 지정 비행 포함 — SWAP 불가" : "해당 없음",
      ref: "특수공항 자격 갱신 비행 — TAG, HKG 등 특수공항 자격 유지를 위한 지정 비행은 스왑 대상에서 제외됩니다." },
    { label:"공휴일/연휴 SWAP 제한", status: blockedHoliday ? "WARN" : "PASS",
      detail: blockedHoliday ? "공휴일 포함 — 회사 정책 추가 확인" : "해당 없음",
      ref: "공휴일·연휴 편조 정책 — 설날·추석 연휴 등 특별 기간은 회사 별도 편조 정책 적용. 스왑 가능 여부를 편조팀에 사전 문의 필요 (070-7420-1756)." },
    { label:"RSV/STBY 부분 SWAP 차단", status: partialRsvStby ? "FAIL" : "PASS",
      detail: partialRsvStby ? "부분 선택 불가 — 패턴 단위" : "해당 없음",
      ref: "RSV·STBY 연속 패턴 단위 스왑 — 연속된 RSV/STBY는 개별 분리 스왑 불가. 인접 RSV/STBY가 있으면 모두 함께 선택해야 합니다." },
  ];
}

/* ====== 7. 매칭 / 점수 ====== */
// 이 글이 자동 필터에서 빠지는 이유 (통과하면 null).
// 매칭 점수와 빈 목록 안내가 같은 기준을 쓰도록 판정은 match-exclusions.js 한 곳에서 한다.
function matchExclusionReason(post) {
  const api = window.CrewSwapMatchExclusions;
  if (!api) return null;
  const dd = dDayInfo(post.deadlineDay, postDeadlineMonth(post));
  return api.reasonFor(post, state.user, { expired: dd.expired });
}

function matchScore(post) {
  // 자동 필터(회사·직군·직책·기종·자격·마감)에 걸리면 목록에 올리지 않는다.
  if (matchExclusionReason(post)) return null;

  // 객실: 포지션 무관 매칭 (직책 규정은 룰 체크에서 안내)
  if (state.user.crewType === "CABIN") {
    const dd = dDayInfo(post.deadlineDay, postDeadlineMonth(post));
    const breakdown = {
      roleMatch: 30,
      aircraftMatch: 20,
      qualMatch: 15,
      baseBonus: post.ownerBase === state.user.base ? 10 : 0,
      timeMatch: state.filters.direction === "all" ? 5 : (matchesDirection(post, state.filters.direction) ? 10 : 0),
      deadlineUrgency: dd.days <= 1 ? 10 : dd.days <= 3 ? 6 : 3,
      ratingBonus: post.ownerRating >= 4.5 ? 5 : 0,
    };
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { total: Math.min(100, total), breakdown, dDay: dd };
  }

  // 조종사 — 포지션·기종·자격은 위 자동 필터에서 이미 통과한 상태다.
  // 점수 계산 (100 만점)
  const breakdown = {
    roleMatch: 30,           // 동일 등급
    aircraftMatch: 20,
    qualMatch: 15,           // 자격 통과
    baseBonus: post.ownerBase === state.user.base ? 10 : 0,
    timeMatch: 0,            // 시간대 (방향 변환 일치 시)
    deadlineUrgency: 0,
    ratingBonus: post.ownerRating >= 4.5 ? 5 : 0,
  };
  // 마감 임박 시 가중치
  const dd = dDayInfo(post.deadlineDay, postDeadlineMonth(post));
  if (dd.days <= 1) breakdown.deadlineUrgency = 10;
  else if (dd.days <= 3) breakdown.deadlineUrgency = 6;
  else breakdown.deadlineUrgency = 3;
  // 방향 변환 일치
  const dir = state.filters.direction;
  if (dir === "all") breakdown.timeMatch = 5;
  else if (matchesDirection(post, dir)) breakdown.timeMatch = 10;

  const total = Object.values(breakdown).reduce((a,b)=>a+b, 0);
  return { total, breakdown, dDay: dd };
}

function matchesDirection(post, dir) {
  // 내가 원하는 변환 방향과 post.offered ↔ post.wanted 가 부합하는가.
  // 판정은 swap-direction.js가 한다 — 새 글에는 wanted.types가 없어서 예전처럼
  // 여기서 직접 읽으면 예외가 나고 매칭 목록 전체가 그려지지 않았다.
  const api = window.CrewSwapSwapDirection;
  if (!api) return true; // 모듈 로드 실패 시에도 글을 감추지 않는다
  return api.matches(post, dir);
}

function visiblePosts() {
  const scored = state.posts.map(p => ({ post:p, score: matchScore(p) })).filter(x => x.score !== null);

  // 유형 필터 (복수선택)
  let list = scored;
  if (state.filters.types.length > 0) list = list.filter(x => state.filters.types.includes(x.post.offered.type));
  // 방향 변환 필터 (선택 시)
  if (state.filters.direction !== "all") list = list.filter(x => matchesDirection(x.post, state.filters.direction));
  // 출근 시간대 필터
  if (state.filters.time !== "all") {
    list = list.filter(x => {
      const rt = x.post.offered.reportTime;
      if (!rt) return state.filters.time !== "AM" && state.filters.time !== "NIGHT"; // OFF/VAC: 제외
      if (state.filters.time === "AM") return rt < "10:00";
      if (state.filters.time === "PM") return rt >= "10:00" && rt < "20:00";
      if (state.filters.time === "NIGHT") return rt >= "20:00" || rt < "06:00";
      return true;
    });
  }
  // 퇴근 시간대 필터
  if (state.filters.arrTime !== "all") {
    list = list.filter(x => {
      const rt = x.post.offered.releaseTime;
      if (!rt) return false; // OFF 등 퇴근시간 없음 → 제외
      const isNextDay = rt.includes("+");
      const timeStr = isNextDay ? rt.replace(/\+\d+/, "").trim() : rt;
      if (state.filters.arrTime === "noEarlyArr") return isNextDay || timeStr >= "06:00"; // 새벽 도착 제외
      if (state.filters.arrTime === "beforeNoon") return !isNextDay && timeStr < "12:00";
      if (state.filters.arrTime === "beforeEvening") return !isNextDay && timeStr < "18:00";
      return true;
    });
  }
  // 권역
  if (state.filters.region !== "all") {
    const r = state.filters.region;
    list = list.filter(x => {
      const reg = x.post.offered.region;
      if (r === "DOMESTIC") return reg === "DOMESTIC" || x.post.offered.type === "OFF";
      if (r === "exCHINA") return reg !== "CHINA";
      if (r === "exCXR") return !x.post.offered.summary.includes("CXR");
      if (r === "exBKI") return !x.post.offered.summary.includes("BKI");
      return reg === r;
    });
  }
  // 날짜
  if (state.filters.date === "weekend") list = list.filter(x => x.post.offered.days.some(isWeekend));
  if (state.filters.date === "weekday") list = list.filter(x => x.post.offered.days.some(d => !isWeekend(d)));
  // 공항 검색 (포함된 글만)
  if (state.filters.airports.length > 0) {
    list = list.filter(x => {
      const summary = (x.post.offered.summary || "").toUpperCase();
      return state.filters.airports.some(ap => summary.includes(ap));
    });
  }
  // LAYOV 박수
  if (state.filters.layover !== "all") {
    const need = state.filters.layover === "3" ? 3 : parseInt(state.filters.layover, 10);
    list = list.filter(x => {
      const lays = x.post.offered.days.length - 2; // 출발+복귀 제외 가정
      if (need === 3) return lays >= 3;
      return x.post.offered.type === "LAYOV" || x.post.offered.summary.includes(`${need}박`);
    });
  }

  // 정렬
  list.sort((a,b) => {
    switch (state.sortBy) {
      case "deadline": return (a.score.dDay.expired?999:a.score.dDay.days) - (b.score.dDay.expired?999:b.score.dDay.days);
      case "newest":   return a.post.postedHoursAgo - b.post.postedHoursAgo;
      case "off":      return (b.post.offered.type === "OFF") - (a.post.offered.type === "OFF") || b.score.total - a.score.total;
      case "base":     return (b.post.ownerBase === state.user.base) - (a.post.ownerBase === state.user.base) || b.score.total - a.score.total;
      case "flightShort": return a.post.offered.flightMinutes - b.post.offered.flightMinutes;
      default: return b.score.total - a.score.total;
    }
  });
  return list;
}

function exposureCount() {
  const isCabin = state.user.crewType === "CABIN";
  return state.posts.filter(p =>
    isCabin
      ? p.crewType === "CABIN" && p.airline === state.user.airline
      : p.ownerRole === state.user.roleType
  ).length;
}

function candidateCountForOffered() {
  if (!state.selectedDays.size) return 0;
  // 단순화: 내가 내놓는 type을 다른 사람이 원하는 글 수
  const ss = selectedSchedules();
  const myType = ss[0]?.type;
  if (!myType) return 0;
  const isCabin = state.user.crewType === "CABIN";
  const isFlight = ["국내선","국제선","LAYOV"].includes(myType);
  return state.posts.filter(p => {
    const roleOK = isCabin
      ? p.crewType === "CABIN" && p.airline === state.user.airline
      : p.ownerRole === state.user.roleType;
    const typeOK = !!window.CrewSwapSwapDirection?.wantsOfferedType(p, myType);
    return roleOK && typeOK;
  }).length;
}

/* ====== 8. 렌더링 ====== */
function renderAll() {
  updateBadges();
  renderProDiscovery();
  renderMetrics();
  renderCalendar();
  renderSelection();
  renderRuleCheck();
  renderWantedChips();
  syncOfferedSlot();
  renderPostFooter();
  renderMyPosts();
  renderMatches();
  renderRequests();
  renderAlerts();
  renderCredits();
  renderFlowUi();
}

function renderFlowUi() {
  const postFlow = state.guideFlow === "post";
  const findFlow = state.guideFlow === "find";
  const postGuide = document.getElementById("postGuideDetails");
  const findGuide = document.getElementById("findGuide");
  const findView = document.getElementById("find");
  if (postGuide) postGuide.hidden = !postFlow;
  if (findGuide) findGuide.hidden = !findFlow;
  if (findView) findView.classList.toggle("is-guided", findFlow);

  const notice = document.getElementById("flowScheduleNotice");
  if (notice) {
    const months = availableMonths();
    notice.innerHTML = state.schedules.length
      ? `<span>✓</span><div><strong>내 스케줄 준비됨</strong><small>${state.schedules.length}건 · ${months.length || 1}개월</small></div>`
      : `<span>!</span><div><strong>먼저 CrewConnex 스케줄이 필요합니다</strong><small>‘내 스왑 올리기’를 누르면 불러오기부터 안내합니다.</small></div>`;
    notice.classList.toggle("is-ready", state.schedules.length > 0);
  }
  if (findFlow) setFindGuideStep(state.findGuideStep || 1, false);
}

function exitGuideFlow(target = "swapGuide") {
  resetScheduleSelection(false);
  state.guideFlow = null;
  state.managingMyPosts = false;
  state.findGuideStep = 1;
  renderFlowUi();
  switchTab(target);
}

function startPostGuide() {
  state.managingMyPosts = false;
  if (!state.schedules.length) {
    state.guideFlow = "post";
    showToast("먼저 CrewConnex 스케줄을 불러와주세요.");
    openGenericModal("crewDialog", "crewOverlay");
    return;
  }
  state.guideFlow = "post";
  beginScheduleSelection("post");
  renderAll();
  switchTab("schedule", { preserveSelection: true });
}

async function openMyPostsManager() {
  resetScheduleSelection(false);
  state.guideFlow = null;
  state.managingMyPosts = true;
  renderFlowUi();
  switchTab("myPostsManager");
  await fetchMyPosts();
  renderMyPosts();
}

function openPremiumAlertManager() {
  resetScheduleSelection(false);
  state.guideFlow = null;
  state.managingMyPosts = false;
  renderFlowUi();
  switchTab("premiumAlerts");
  renderSavedSearches();
}

function startFindGuide() {
  resetScheduleSelection(false);
  state.managingMyPosts = false;
  state.guideFlow = "find";
  state.findGuideStep = 1;
  state.filters.types = [];
  renderFlowUi();
  switchTab("find");
}

function syncGuideTypeChips() {
  document.querySelectorAll("#guideTypeChips [data-guide-type]").forEach(button => {
    button.classList.toggle("is-active", state.filters.types.includes(button.dataset.guideType));
  });
}

function syncMainFilterControls() {
  const allChip = document.querySelector("#typeFilters [data-filter='all']");
  document.querySelectorAll("#typeFilters [data-filter]").forEach(button => {
    button.classList.toggle("is-active",
      button.dataset.filter === "all"
        ? state.filters.types.length === 0
        : state.filters.types.includes(button.dataset.filter));
  });
  if (allChip && state.filters.types.length === 0) allChip.classList.add("is-active");
  const values = {
    dateFilter: state.filters.date,
    timeFilter: state.filters.time,
    regionFilter: state.filters.region,
  };
  Object.entries(values).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value || "all";
  });
  const airport = document.getElementById("airportSearchFilter");
  if (airport) airport.value = (state.filters.airports || []).join(", ");
}

function findGuideSummaryText() {
  const typeText = state.filters.types.length ? state.filters.types.join(" · ") : "모든 종류";
  const dateLabels = { all:"날짜 전체", thisMonth:"이번 달", weekend:"주말", weekday:"평일", d7:"D-7 이내" };
  const timeLabels = { all:"시간 전체", AM:"오전 출근", PM:"오후 출근", NIGHT:"야간 출근" };
  const regionLabels = { all:"권역 전체", DOMESTIC:"국내선", JAPAN:"일본", SEA:"동남아", CHINA:"중국", exCHINA:"중국 제외" };
  return [
    typeText,
    dateLabels[state.filters.date] || "날짜 전체",
    timeLabels[state.filters.time] || "시간 전체",
    regionLabels[state.filters.region] || "권역 전체",
    (state.filters.airports || []).length ? `공항 ${(state.filters.airports || []).join(", ")}` : null,
  ].filter(Boolean).join(" · ");
}

function setFindGuideStep(step, scroll = true) {
  state.findGuideStep = Math.max(1, Math.min(3, step));
  document.getElementById("find")?.classList.toggle("show-guide-results", state.findGuideStep === 3);
  document.querySelectorAll("[data-find-step-panel]").forEach(panel => {
    panel.hidden = Number(panel.dataset.findStepPanel) !== state.findGuideStep;
  });
  document.querySelectorAll("[data-find-step-dot]").forEach(dot => {
    const n = Number(dot.dataset.findStepDot);
    dot.classList.toggle("is-active", n === state.findGuideStep);
    dot.classList.toggle("is-done", n < state.findGuideStep);
  });
  syncGuideTypeChips();
  if (state.findGuideStep === 2) {
    const values = {
      guideDate: state.filters.date,
      guideTime: state.filters.time,
      guideRegion: state.filters.region,
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.value = value || "all";
    });
    const airport = document.getElementById("guideAirports");
    if (airport) airport.value = (state.filters.airports || []).join(", ");
  }
  const summary = document.getElementById("findGuideSummary");
  if (summary) summary.textContent = findGuideSummaryText();
  if (state.findGuideStep === 3) renderMatches();
  if (scroll) document.getElementById("findGuide")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateBadges() {
  const airlineLbl = AIRLINE_LABELS[state.user.airline] || state.user.airline;
  const crewLbl = CREWTYPE_LABELS[state.user.crewType] || state.user.crewType;
  const ab = $("#airlineBadge");
  if (ab) ab.textContent = `${airlineLbl}·${crewLbl}`;
  $("#roleBadge").textContent = ROLE_LABELS[state.user.roleType] || CABIN_ROLE_LABELS[state.user.roleType] || state.user.roleType;
  const isCabin = state.user.crewType === "CABIN";
  const abEl = $("#aircraftBadge");
  const qEl  = $("#qualBadge");
  if (abEl) abEl.hidden = isCabin;
  if (qEl)  qEl.hidden  = isCabin;
  if (!isCabin) {
    if (abEl) abEl.textContent = state.user.aircraft === "NG_MAX" ? "NG + MAX" : "NG";
    const q = [state.user.edto?"EDTO":null, state.user.cat2?"CAT II":null, state.user.cat3?"CAT III":null].filter(Boolean).join(" / ");
    if (qEl) qEl.textContent = q || "추가 자격 없음";
  }
  $("#baseBadge").textContent = state.user.base;
  $("#ratingBadge").textContent = `★ ${state.user.rating.toFixed(1)}`;
  // 헤더 상단: 닉네임 + 소속 한 줄
  const nickEl = $("#headerNick");
  if (nickEl) nickEl.textContent = `${state.user.nickname || "CrewSwap"} 님`;
  const subEl = $("#headerSub");
  const roleLbl = ROLE_LABELS[state.user.roleType] || CABIN_ROLE_LABELS[state.user.roleType] || state.user.roleType;
  if (subEl) subEl.textContent = `${airlineLbl} · ${roleLbl} · ${state.user.base}`;
  const emailEl = $("#profileEmailDisplay");
  if (emailEl) emailEl.textContent = state.user.email || "-";
}

function renderCredits() {
  const unlimited = isPremiumUser();
  const display = unlimited ? "∞" : (Number.isInteger(state.credits) ? String(state.credits) : state.credits.toFixed(1));
  $("#creditCount").textContent = display;
  if ($("#profileCredits")) $("#profileCredits").textContent = display;
  const nextEl = $("#creditRegenHint");
  if (nextEl) nextEl.textContent = creditRegenHint();
  const adCount = Math.max(0, Number(state.adCreditsThisMonth) || 0);
  const adLabel = `📺 테스트 광고 보고 +1 크레딧${adCount ? ` · 이번 달 ${adCount}회` : ""}`;
  if ($("#watchAdButton")) {
    $("#watchAdButton").textContent = adLabel;
    $("#watchAdButton").hidden = true;
  }
  if ($("#watchAdButtonProfile")) {
    $("#watchAdButtonProfile").textContent = adLabel;
    $("#watchAdButtonProfile").hidden = true;
  }
}

function applyCreditWallet(wallet, shouldRender = true) {
  if (!wallet || !Number.isFinite(Number(wallet.credits))) return false;
  state.credits = Number(wallet.credits);
  state.creditMonth = wallet.creditMonth || CREDIT_POLICY.monthKey();
  state.adCreditsThisMonth = Number(wallet.adCreditsThisMonth) || 0;
  state.creditWalletServer = true;
  saveState();
  if (shouldRender) renderCredits();
  return true;
}

async function refreshCreditWallet() {
  if (!state.sessionToken || !state.user.serverAuthed) return { ok: false, skipped: true };
  try {
    const response = await apiFetch(`${API_BASE}/api/credits-status`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '크레딧 조회 실패');
    applyCreditWallet(data.wallet);
    return { ok: true, wallet: data.wallet };
  } catch (error) {
    console.warn('credit wallet refresh failed:', error);
    return { ok: false, error: error.message };
  }
}

/* ====== 월 단위 크레딧 정책 ======
 * 매월 첫 실행에 기본 3개로 재설정한다.
 * 광고 보상만 3개를 초과할 수 있고, 다음 달로 이월되지 않는다. */
const CREDIT_POLICY = window.CrewSwapCreditPolicy;
const CREDIT_CAP = CREDIT_POLICY.BASE_MONTHLY_CREDITS;

function regenCredits() {
  if (state.sessionToken && state.user.serverAuthed) {
    refreshCreditWallet();
    return { changed: false, server: true };
  }
  const result = CREDIT_POLICY.reconcileMonth(state);
  delete state.lastCreditAt;
  if (!result.changed) return result;
  saveState();
  renderCredits();
  if (result.changedMonth) showToast("새 달 기본 크레딧 3개가 충전되었습니다.");
  return result;
}

function creditRegenHint() {
  if (isPremiumUser()) return "PRO 이용 중 · 스왑 등록과 정식 요청 크레딧 무제한";
  const adCount = Math.max(0, Number(state.adCreditsThisMonth) || 0);
  return `이번 달 기본 ${CREDIT_CAP}개${adCount ? ` · 광고 시청 ${adCount}회` : ""} · 다음 달 1일 3개로 재설정`;
}

let rewardAdTimer = null;
let rewardAdRunning = false;

function openRewardAd() {
  if (isPremiumUser()) {
    showToast("PRO 이용 중에는 크레딧이 무제한입니다.");
    return;
  }
  regenCredits();
  rewardAdRunning = false;
  const status = $("#rewardAdStatus");
  const start = $("#rewardAdStartButton");
  const cancel = $("#rewardAdCancelButton");
  if (status) status.textContent = "재생을 누르면 5초 테스트가 시작됩니다.";
  if (start) {
    start.disabled = false;
    start.textContent = "테스트 광고 재생";
  }
  if (cancel) cancel.disabled = false;
  openGenericModal("rewardAdDialog", "rewardAdOverlay");
}

function closeRewardAd() {
  if (rewardAdRunning) return;
  if (rewardAdTimer) clearInterval(rewardAdTimer);
  rewardAdTimer = null;
  closeGenericModal("rewardAdDialog", "rewardAdOverlay");
}

function startRewardAd() {
  if (rewardAdRunning) return;
  rewardAdRunning = true;
  let seconds = 5;
  const status = $("#rewardAdStatus");
  const start = $("#rewardAdStartButton");
  const cancel = $("#rewardAdCancelButton");
  if (start) start.disabled = true;
  if (cancel) cancel.disabled = true;
  if (status) status.textContent = `테스트 광고 재생 중 · ${seconds}초`;

  rewardAdTimer = setInterval(() => {
    seconds--;
    if (seconds > 0) {
      if (status) status.textContent = `테스트 광고 재생 중 · ${seconds}초`;
      return;
    }
    clearInterval(rewardAdTimer);
    rewardAdTimer = null;
    CREDIT_POLICY.grantAdCredit(state);
    saveState();
    renderCredits();
    rewardAdRunning = false;
    closeGenericModal("rewardAdDialog", "rewardAdOverlay");
    showToast("테스트 광고 시청 완료 · 이번 달 크레딧 +1");
  }, 1000);
}

function renderMetrics() {
  const usage = window.CrewSwapUsage?.summary(state.user.crewType, state.user, currentRules());
  if (!usage) return;
  const card = document.getElementById("profileSwapCard");
  const status = document.getElementById("profileSwapStatus");
  const counts = document.getElementById("profileSwapCounts");
  const warning = document.getElementById("profileSwapWarning");
  if (!card || !status || !counts || !warning) return;
  card.classList.toggle("is-limit", usage.level === "limit");
  card.classList.toggle("is-over", usage.level === "over");
  status.textContent = usage.status;
  counts.hidden = !usage.limited;
  if (usage.limited) {
    document.getElementById("profileSwapMonthly").textContent = `${usage.monthly.used} / ${usage.monthly.limit}회`;
    document.getElementById("profileSwapYearly").textContent = `${usage.yearly.used} / ${usage.yearly.limit}회`;
  }
  warning.textContent = usage.limited ? usage.warning : "운항승무원은 별도 SWAP 횟수 제한이 없습니다.";
}

function renderAvailableMonths() {
  const el = document.getElementById("availableMonths");
  if (!el) return;
  const months = availableMonths();
  // 1개 이하면 칩 영역 숨김 (의미 없음)
  if (months.length <= 1) { el.innerHTML = ""; el.style.display = "none"; return; }
  el.style.display = "";
  el.innerHTML = months.map(m => {
    const [y, mm] = m.split("-").map(Number);
    const count = state.schedules.filter(s => (s.month || state.currentMonth) === m).length;
    const isActive = m === state.currentMonth;
    return `<button type="button" class="month-chip${isActive ? " is-active" : ""}" data-month="${m}">${y}/${mm} <small>(${count})</small></button>`;
  }).join("");
  el.querySelectorAll(".month-chip").forEach(b => {
    b.onclick = () => {
      if (state.currentMonth === b.dataset.month) return;
      state.currentMonth = b.dataset.month;
      saveState();
      renderAll();
    };
  });
}

function renderCalendar() {
  const grid = $("#calendarGrid");
  $("#calendarMonthLabel").textContent = curMonthLabel();
  renderAvailableMonths();
  grid.innerHTML = "";
  const cum = calcCumulative();

  // 시작 요일 offset (월화수목금토일 그리드 기준)
  const startWeekday = firstWeekdayOfCurrentMonth(); // 0=일 ... 6=토
  const offset = (startWeekday + 6) % 7; // 월=0, ..., 일=6
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day calendar-empty";
    grid.appendChild(empty);
  }

  const dayCount = daysInCurrentMonth();
  for (let day = 1; day <= dayCount; day++) {
    const s = getSchedule(day);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.dataset.day = String(day);
    if (state.selectedDays.has(dayKey(day))) cell.classList.add("is-selected");
    if (isWeekend(day)) cell.classList.add("is-weekend");
    if (isHoliday(day)) cell.classList.add("is-holiday");
    if (cum.warnDays.has(day)) cell.classList.add("is-warn-consec"); // ⚠ 연속근무 한도 임박 (calcCumulative 참고)
    // 👀 등록 글 카운트 — 다른 사용자가 이 날짜의 근무를 내놓은 스왑 글 건수
    // (post.offered.days에 해당 날짜가 포함된 글을 집계).
    const watcherCount = state.posts.filter(p => p.offered.days.includes(day)).length;
    cell.innerHTML = `
      <div class="date-number">
        <span>${day}</span>
        ${watcherCount ? `<span class="watchers">👀 ${watcherCount}</span>` : ""}
      </div>
    `;

    if (s) {
      // 패턴 띠 (해당 일이 패턴의 일부일 때) — 연속된 일자 구간만 한 띠로
      if (s.patternId) {
        const days = connectedPatternDays(s.patternId, day);
        const isStart = day === days[0];
        const isEnd = day === days[days.length - 1];
        const isSingle = days.length === 1;
        const band = document.createElement("div");
        const cls = BAND_CLASS[s.type] || "";
        band.className = `pattern-band ${cls} ${isSingle?"single": isStart?"start": isEnd?"end":""}`;
        cell.appendChild(band);
      }

      const pill = document.createElement("div");
      const tod = parseTimeOfDay(s.reportTime);
      // 다중 leg 페어링이면 전체 경유 표시
      const routeText = s.type === "ARRIVAL" && s.arrivalAirport
        ? `← ${s.arrivalAirport} 도착${s.arrivalTime ? ` ${s.arrivalTime}` : ""}`
        : s.routeSummary
        ? s.routeSummary
        : (s.dep && s.arr && s.dep !== s.arr ? `${s.dep}-${s.arr}` : s.layoverAirport ? `${s.layoverAirport} 체류` : "");
      pill.className = `schedule-pill ${PILL_CLASS[s.type] || ""}`;
      pill.innerHTML = `
        ${tod ? `<span class="pill-time-position">${tod}</span>` : ""}
        <strong>${s.title}${s.legs && s.legs > 1 ? ` <em style="font-style:normal;opacity:.7;font-size:10px;">(${s.legs}leg)</em>` : ""}</strong>
        ${routeText ? `<span class="pill-route">${routeText}</span>` : ""}
        ${s.reportTime && /^\d/.test(s.reportTime) ? `<small>${s.reportTime} check in</small>` : ""}
      `;
      cell.appendChild(pill);
    }

    cell.addEventListener("click", () => selectPattern(day));
    grid.appendChild(cell);
  }
}

function renderSelection() {
  const ss = selectedSchedules();
  const has = ss.length > 0;
  const checks = has ? checkRulesForSelection() : [];
  const failItems = checks.filter(c => c.status === "FAIL");
  const hasFail = failItems.length > 0;
  const regBtn = $("#registerSelectionButton");
  const pending = !!state.pendingRequestPostId;
  if (pending) {
    // 의향묻기/요청하기로 진입한 상태 — 버튼이 '스왑 올리기'가 아니라 진행 버튼으로 바뀜
    regBtn.textContent = state.pendingRequestType === "ask" ? "의향묻기로 진행 →" : "요청하기로 진행 →";
    regBtn.disabled = !has;
    regBtn.title = "";
  } else {
    regBtn.textContent = state.guideFlow === "post" ? "다음: 희망 조건 입력 →" : "이 근무로 스왑 올리기";
    regBtn.disabled = !has || hasFail;
    regBtn.title = hasFail ? `등록 불가: ${failItems.map(c => c.label).join(", ")}` : "";
  }
  $("#clearSelectionButton").disabled = !has;
  if (!has) {
    $("#selectedSummary").className = "empty-state";
    $("#selectedSummary").textContent = "달력에서 패턴을 드래그하거나 클릭하세요.";
    $("#ruleCheck").innerHTML = "";
    return;
  }
  // 날짜가 이어지지 않은 선택은 서로 다른 패턴이라 각각 별개의 글로 등록된다.
  // 예전에는 전부 한 덩어리로 요약해 보여줘서, 통으로 하나의 스왑이 올라간다고 오해하기 쉬웠다.
  const groups = selectedScheduleGroups();
  const patternHtml = groups.map(g => {
    const blockMin = g.reduce((sum, s) => sum + flightMinutesOf(s), 0);
    const dutyMin = g.reduce((sum, s) => sum + dutyMinutesOf(s), 0);
    const gdd = dDayInfo(g[0].day, g[0].month);
    const gddText = gdd.expired ? "마감됨" : `${companyDeadlineDueText(gdd)}까지`;
    return `
    <div class="pattern-summary">
      <strong>${patternTitleFor(g)}</strong>
      <div class="meta">
        <span>승무(BLH) <b>${formatHM(blockMin)}</b></span>
        <span>근무 <b>${formatHM(dutyMin)}</b></span>
        <span>일수 <b>${g.length}일</b></span>
        <span>회사 제출 <b>${gddText}</b></span>
      </div>
    </div>`;
  }).join("");

  $("#selectedSummary").className = "";
  $("#selectedSummary").innerHTML = `
    ${groups.length > 1 ? `<div class="split-notice">📌 날짜가 이어지지 않아 <strong>${groups.length}개의 별개 스왑</strong>으로 나뉘어 등록됩니다${isPremiumUser() ? "" : ` · <strong>${groups.length}크레딧</strong> 사용`}</div>` : ""}
    ${patternHtml}
    <div class="selected-list">
      ${ss.map(s => {
        const pair = crewPairingCheck(s);
        return `
        <div class="selected-item">
          <strong>${schedMonthNum(s)}/${s.day} · ${s.title}</strong>
          <dl>
            <div><dt>유형</dt><dd>${s.type}${s.routeSummary ? ` · ${s.routeSummary}${s.legs?` (${s.legs}leg)`:""}` : s.dep ? ` · ${s.dep}-${s.arr}` : s.layoverAirport ? ` · ${s.layoverAirport}` : ""}</dd></div>
            ${s.reportTime ? `<div><dt>check in</dt><dd>${s.reportTime}</dd></div>` : ""}
            ${s.releaseTime ? `<div><dt>check out</dt><dd>${s.releaseTime}</dd></div>` : ""}
            <div><dt>편조</dt><dd>${s.crewComposition || "-"}</dd></div>
            <div><dt>편조기준</dt><dd>${pair.label}</dd></div>
            ${s.aircraft ? `<div><dt>기종/자격</dt><dd>${s.aircraft}${s.requiresEdto?" · EDTO":""}${s.requiresCat3?" · CAT III":""}</dd></div>` : ""}
          </dl>
        </div>`;
      }).join("")}
    </div>
  `;
}

function renderRuleCheck() {
  const checks = checkRulesForSelection();
  if (checks.length === 0) { $("#ruleCheck").innerHTML = ""; return; }
  const rule = currentRules();
  const ruleLabel = rule.label || `${AIRLINE_LABELS[state.user.airline] || state.user.airline} ${CREWTYPE_LABELS[state.user.crewType] || state.user.crewType}`;
  const failCount = checks.filter(c => c.status === "FAIL").length;
  const warnCount = checks.filter(c => c.status === "WARN").length;
  const statusSummary = failCount > 0
    ? `<span class="rule-summary-badge fail">불가 ${failCount}건</span>`
    : warnCount > 0
    ? `<span class="rule-summary-badge warn">확인 ${warnCount}건</span>`
    : `<span class="rule-summary-badge pass">모두 통과</span>`;
  $("#ruleCheck").innerHTML = `
    <div class="rule-check-header">
      <div class="rule-check-title">
        <span class="rule-scope-badge">${ruleLabel}</span>
        <strong>회사 룰 사전 체크</strong>
      </div>
      ${statusSummary}
    </div>
    ${checks.map((c, i) => `
      <div class="rule-row ${c.status.toLowerCase()}" data-rule-idx="${i}" style="cursor:${c.ref ? "pointer" : "default"}">
        <div style="flex:1;">
          <strong style="display:block;font-size:12px;">${c.label}${c.ref ? ' <span style="font-size:10px;opacity:.6;">▼ 규정 보기</span>' : ""}</strong>
          <span style="font-size:11px;color:var(--muted);">${c.detail}</span>
          ${c.ref ? `<div class="rule-ref-text" id="ruleRef${i}" style="display:none;margin-top:6px;padding:6px 8px;background:var(--bg-card);border-left:3px solid var(--border);font-size:11px;line-height:1.5;border-radius:4px;">${c.ref}</div>` : ""}
        </div>
        <span class="verdict">${c.status === "PASS" ? "통과" : c.status === "WARN" ? "확인" : c.status === "FAIL" ? "불가" : "-"}</span>
      </div>
    `).join("")}
    <p class="disclaimer">⚠️ 본 결과는 회사 최종 승인 전 사전 검토용입니다. 실제 가능 여부는 회사 시스템 및 규정에 따라 달라질 수 있습니다.</p>
  `;
  // 규정 원본 토글
  checks.forEach((c, i) => {
    if (!c.ref) return;
    const row = document.querySelector(`[data-rule-idx="${i}"]`);
    if (row) row.addEventListener("click", () => {
      const ref = $(`#ruleRef${i}`);
      if (ref) ref.style.display = ref.style.display === "none" ? "block" : "none";
    });
  });
}

// "아무거나"(어떤 유형이든), "비행(전체)"(모든 비행)는 배타적 마스터 토글
const MASTER_WANTED_TYPES = ["아무거나", "비행(전체)"];

// 칩 선택 상태만 DOM 클래스로 반영 (innerHTML 재생성 금지 — 빠른 탭 시 터치 엉킴 방지)
function syncWantedChipStates() {
  const w = $("#wantedTypeChips");
  if (w) w.querySelectorAll("button").forEach(b => {
    b.classList.toggle("is-active", state.wantedTypes.has(b.dataset.type));
  });
  const tw = $("#wantedTimeChips");
  if (tw) tw.querySelectorAll("button").forEach(b => {
    b.classList.toggle("is-active", state.wantedTimes.has(b.dataset.time));
  });
}

let _wantedChipsBuilt = false;
function renderWantedChips() {
  const w = $("#wantedTypeChips");
  if (!w) return;
  // 최초 1회만 DOM 생성 + 이벤트 바인딩 (이후엔 클래스만 갱신)
  if (!_wantedChipsBuilt) {
    w.innerHTML = WANTED_TYPE_OPTIONS.map(t =>
      `<button type="button" data-type="${t}">${wantedTypeLabel(t)}</button>`
    ).join("");
    w.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      const t = b.dataset.type;
      const isMaster = MASTER_WANTED_TYPES.includes(t);
      if (state.wantedTypes.has(t)) {
        state.wantedTypes.delete(t);
      } else if (isMaster) {
        state.wantedTypes.clear();
        state.wantedTypes.add(t);
      } else {
        MASTER_WANTED_TYPES.forEach(m => state.wantedTypes.delete(m));
        state.wantedTypes.add(t);
      }
      syncWantedChipStates();
      renderPostFooter();
    }));
    const tw = $("#wantedTimeChips");
    if (tw) tw.querySelectorAll("button").forEach(b => {
      b.addEventListener("click", () => {
        const t = b.dataset.time;
        if (state.wantedTimes.has(t)) state.wantedTimes.delete(t);
        else state.wantedTimes.add(t);
        syncWantedChipStates();
        renderPostFooter();
      });
    });
    _wantedChipsBuilt = true;
  }
  syncWantedChipStates();
}

function syncOfferedSlot() {
  const slot = $("#offeredSlot");
  if (state.editingPostId) {
    const post = state.myPosts.find(p => p.id === state.editingPostId);
    if (post) {
      slot.className = "slot-card filled is-editing";
      slot.innerHTML = `
        <strong>✏️ 수정 중인 글: ${post.offered.patternName}</strong>
        <div>${post.offered.summary || ""}</div>
        <div class="slot-meta">
          <span>오퍼/크레딧은 변경 불가 — 희망 조건만 아래에서 수정</span>
        </div>
      `;
      return;
    }
  }
  const ss = selectedSchedules();
  if (ss.length === 0) {
    slot.className = "slot-card empty";
    slot.innerHTML = `
      <div>달력에서 패턴을 선택하면 자동 입력됩니다.</div>
      <button class="link-button" id="goToCalendar">달력으로 이동 →</button>
    `;
    $("#goToCalendar").onclick = () => switchTab("schedule", { preserveSelection: true });
  } else {
    const totalBlock = ss.reduce((sum, s) => sum + flightMinutesOf(s), 0);
    slot.className = "slot-card filled";
    const routes = ss.map(s => s.routeSummary || (s.dep&&s.arr ? `${s.dep}-${s.arr}` : s.layoverAirport ? `LAYOV ${s.layoverAirport}` : s.type)).join(" · ");
    const totalLegs = ss.reduce((sum, s) => sum + (s.legs || (s.dep && s.arr ? 1 : 0)), 0);
    slot.innerHTML = `
      <strong>${patternTitleFor(ss)}</strong>
      <div>${ss.map(s => s.title).join(" · ")}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">${routes}</div>
      <div class="slot-meta">
        ${ss[0].aircraft ? `<span>${ss[0].aircraft}</span>` : ""}
        ${ss.some(s=>s.requiresEdto) ? `<span>EDTO</span>` : ""}
        ${ss.some(s=>s.requiresCat3) ? `<span>CAT III</span>` : ""}
        <span>승무 ${formatHM(totalBlock)}</span>
        <span>${ss.length}일${totalLegs>ss.length?` · ${totalLegs}leg`:""}</span>
      </div>
      <button class="link-button" id="editOfferedSlot" style="margin-top:8px;">✏️ 선택 수정하러 가기 →</button>
    `;
    document.getElementById("editOfferedSlot").onclick = () => switchTab("schedule", { preserveSelection: true });
  }
  renderPostFooter();
}

// 선택된 스케줄들의 유형이 섞여 있으면 "혼합 패턴"으로, 같으면 기존처럼 표시
function patternTitleFor(ss) {
  const range = `${schedMonthNum(ss[0])}/${ss[0].day}~${schedMonthNum(ss.at(-1))}/${ss.at(-1).day}`;
  const types = [...new Set(ss.map(s => s.type))];
  if (types.length === 1) return `${range} · ${types[0]} 패턴`;
  return `${range} · ${types.join("→")} 혼합 패턴`;
}

// 희망 조건 표시 — 새 방식(memo) 우선, 구버전(구조화 필드) 호환
function wantedSummary(w) {
  if (!w) return "";
  if (w.memo) return w.memo;
  const parts = [];
  if (w.types && w.types.length) parts.push(w.types.map(wantedTypeLabel).join(" / "));
  if (w.time && w.time.length) parts.push(w.time.join(", "));
  if (w.excludedAirports && w.excludedAirports.length) parts.push(w.excludedAirports.join("/") + " 제외");
  return parts.join(" · ") || "조건 없음";
}

function renderMyPosts() {
  const el = $("#myPostList");
  if (!el) return;
  const section = $("#myPostSection");
  const title = $("#myPostTitle");
  const closeButton = $("#closeMyPostsManager");
  const menuCount = $("#myPostMenuCount");
  const managing = !!state.managingMyPosts;
  if (title) title.textContent = managing ? "📋 내가 올린 스왑 관리" : "📋 이미 올린 스케줄";
  if (closeButton) closeButton.hidden = !managing;
  if (menuCount) {
    menuCount.textContent = state.myPosts.length
      ? `현재 ${state.myPosts.length}건 · 진행 중인 글은 수정·취소하고, 환급 완료 기록은 삭제할 수 있습니다.`
      : "등록한 스왑이 있는지 서버에서 확인합니다.";
  }
  if (state.myPosts.length === 0) {
    el.innerHTML = managing
      ? `<div class="empty-state">이 계정으로 등록한 스왑이 없습니다.</div>`
      : "";
    if (section) section.hidden = !managing;
    return;
  }
  if (section) section.hidden = false;
  el.innerHTML = state.myPosts.map(p => {
    const rd = p.registeredAt;
    const rdDisplay = (rd && rd.includes('T'))
      ? (() => { const d = new Date(rd); return `${d.getMonth()+1}/${d.getDate()} 등록`; })()
      : (rd || '');
    const creditSpent = CREDIT_POLICY.recordedSpend(p);
    const refundGranted = Object.prototype.hasOwnProperty.call(p, "refundGranted")
      ? p.refundGranted
      : creditSpent * 0.5;
    const refundedHistory = window.CrewSwapPostHistory.isRefundedHistory(p);
    const statusHtml = refundedHistory
      ? `<span class="my-post-status expired">마감됨${p.refunded ? (refundGranted > 0 ? ` · ${refundGranted}크레딧 환급` : creditSpent === 0 ? " · PRO 등록" : " · 환급 상한 도달") : ""}</span>`
      : `<span class="my-post-status done">등록 완료</span>`;
    return `
    <div class="my-post-card" data-my-post-id="${escapeHtml(p.id)}">
      <div class="my-post-head">
        <strong>${p.offered.patternName}</strong>
        ${statusHtml}
      </div>
      <div class="my-post-meta">
        <span>${p.offered.type} · ${p.offered.summary || ""}</span>
        <span class="my-post-time">${rdDisplay}</span>
      </div>
      <details class="my-post-detail">
        <summary>자세히 보기 ▾</summary>
        <dl class="my-post-detail-dl">
          ${p.offered.reportTime ? `<div><dt>Check-in</dt><dd>${p.offered.reportTime}</dd></div>` : ""}
          ${p.offered.releaseTime ? `<div><dt>Check-out</dt><dd>${p.offered.releaseTime}</dd></div>` : ""}
          ${p.offered.flightMinutes ? `<div><dt>비행시간</dt><dd>${(p.offered.flightMinutes/60).toFixed(1)}h</dd></div>` : ""}
          ${p.offered.aircraft ? `<div><dt>기종</dt><dd>${p.offered.aircraft}${p.offered.edto?" · EDTO":""}${p.offered.cat3?" · CAT III":""}</dd></div>` : ""}
          ${p.offered.crewPublic ? `<div><dt>편조</dt><dd>${p.offered.crewPublic}</dd></div>` : ""}
          <div><dt>희망 조건</dt><dd>${wantedSummary(p.wanted)}</dd></div>
        </dl>
      </details>
      ${refundedHistory
        ? `<p class="hint" style="margin:8px 0 0;">이미 마감되어 크레딧 처리가 끝난 글입니다.</p>
          ${managing ? `<button class="delete-post-history-button" data-my-post-id="${p.id}">기록 삭제</button>` : ""}`
        : `<div class="my-post-btn-row">
        <button class="secondary-button edit-post-button" data-my-post-id="${p.id}">희망 조건 수정</button>
        <button class="cancel-post-button" data-my-post-id="${p.id}">${creditSpent > 0 ? `등록 취소 · 최대 ${creditSpent}크레딧 환급` : "등록 취소 · PRO 등록"}</button>
      </div>`}
    </div>
  `;
  }).join("");
  el.querySelectorAll(".edit-post-button").forEach(b => {
    b.onclick = () => enterEditPostMode(b.dataset.myPostId);
  });
  el.querySelectorAll(".cancel-post-button").forEach(b => {
    b.onclick = async () => {
      const pid = b.dataset.myPostId;
      const post = state.myPosts.find(x => x.id === pid);
      if (!post) return;
      // 방어: 이미 마감/환급된 글은 취소 재환급 불가 (중복 환급 차단)
      if (post.status === "expired" || post.refunded) {
        showToast("이미 마감되어 환급된 글입니다.");
        renderMyPosts();
        return;
      }
      const creditSpent = CREDIT_POLICY.recordedSpend(post);
      const creditNote = creditSpent > 0
        ? `기본 크레딧이 3개 미만일 때만 최대 ${creditSpent}크레딧이 환급됩니다.`
        : "PRO 무제한으로 등록한 글이라 크레딧 변동은 없습니다.";
      if (!confirm(`"${post.offered.patternName}" 등록을 취소하시겠습니까?\n${creditNote}`)) return;
      if (!post.deleteToken) { showToast("구버전 글은 서버에서 취소할 수 없습니다."); return; }
      let result;
      try {
        const response = await apiFetch(`${API_BASE}/api/posts-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: pid, deleteToken: post.deleteToken, reason: "cancelled" }),
        });
        result = await response.json().catch(() => ({}));
        if (result.wallet) applyCreditWallet(result.wallet);
        if (!response.ok) { showToast(result.error || "등록 취소 실패 — 다시 시도해주세요."); return; }
      } catch (e) { showToast("등록 취소 실패 — 네트워크를 확인해주세요."); return; }
      _deletedPostIds.add(pid);
      state.myPosts = state.myPosts.filter(x => x.id !== pid);
      const refund = Number(result.refunded) || 0;
      saveState();
      renderMyPosts();
      renderCredits();
      showToast(creditSpent === 0
        ? "PRO 등록 취소 완료 — 크레딧 변동 없음"
        : refund > 0
        ? `등록 취소 완료 — ${refund}크레딧 환급됨`
        : "등록 취소 완료 — 기본 크레딧 상한(3개)이라 추가 환급 없음");
    };
  });
  el.querySelectorAll(".delete-post-history-button").forEach(b => {
    b.onclick = async () => {
      const pid = b.dataset.myPostId;
      const post = state.myPosts.find(x => x.id === pid);
      if (!window.CrewSwapPostHistory.isRefundedHistory(post)) return;
      if (!confirm(`"${post.offered.patternName}" 환급 완료 기록을 삭제하시겠습니까?\n크레딧은 변동되지 않습니다.`)) return;
      if (post.deleteToken) {
        try {
          await apiFetch(`${API_BASE}/api/posts-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: pid, deleteToken: post.deleteToken }),
          });
        } catch (e) { console.warn("refunded post history delete failed:", e); }
      }
      _deletedPostIds.add(pid);
      state.myPosts = window.CrewSwapPostHistory.remove(state.myPosts, pid);
      saveState();
      renderMyPosts();
      showToast("환급 완료 기록을 삭제했습니다. 크레딧은 변동되지 않습니다.");
    };
  });
}

function enterEditPostMode(postId) {
  const post = state.myPosts.find(p => p.id === postId);
  if (!post) return;
  resetScheduleSelection(false);
  state.editingPostId = postId;
  switchTab("post");
  syncOfferedSlot();
  const memo = document.getElementById("postMemo");
  // 새 글은 memo, 구버전 글은 구조화 필드를 텍스트로 변환해서 채움
  if (memo) memo.value = post.wanted.memo || wantedSummary(post.wanted).replace("조건 없음", "");
  renderPostFooter();
}

function exitEditPostMode() {
  state.editingPostId = null;
  syncOfferedSlot();
  renderPostFooter();
}

function renderPostFooter() {
  const editing = !!state.editingPostId;
  const ss = selectedSchedules();
  const hasOffered = editing || ss.length > 0;

  const submitBtn = $("#submitPostButton");
  const existingBanner = document.getElementById("editPostBanner");
  if (editing) {
    submitBtn.textContent = "희망 조건 수정 완료";
    if (!existingBanner) {
      const banner = document.createElement("div");
      banner.id = "editPostBanner";
      banner.className = "notice";
      banner.style.marginBottom = "10px";
      banner.innerHTML = `✏️ 기존 글의 희망 조건을 수정 중입니다 (오퍼/크레딧 변경 없음). <button type="button" id="cancelEditPostButton" class="secondary-button" style="margin-left:8px;">취소</button>`;
      submitBtn.parentElement.insertBefore(banner, submitBtn);
      document.getElementById("cancelEditPostButton").onclick = exitEditPostMode;
    }
  } else {
    // 날짜가 이어지지 않으면 여러 글로 나뉘어 등록되므로 크레딧도 그만큼 든다.
    const postCount = Math.max(1, selectedScheduleGroups().length);
    submitBtn.textContent = isPremiumUser()
      ? (postCount > 1 ? `${postCount}건 등록하기 · PRO 무제한` : "등록하기 · PRO 무제한")
      : (postCount > 1 ? `${postCount}건 등록하기 · ${postCount}크레딧` : "등록하기 · 1크레딧");
    // 상단 '등록 비용' 요약도 실제 건수에 맞춘다 (예전에는 항상 '무료 1크레딧' 고정)
    const costValue = document.getElementById("previewCostValue");
    const costNote = document.getElementById("previewCostNote");
    if (costValue) costValue.textContent = isPremiumUser()
      ? (postCount > 1 ? `${postCount}건 · PRO 무제한` : "PRO 무제한")
      : (postCount > 1 ? `${postCount}건 · ${postCount}크레딧` : "무료 1크레딧");
    if (costNote) costNote.textContent = postCount > 1
      ? "날짜가 이어지지 않아 글이 나뉩니다"
      : (isPremiumUser() ? "PRO 이용 중" : "PRO는 무제한");
    if (existingBanner) existingBanner.remove();
  }

  if (!hasOffered) {
    $("#postRuleCheck").innerHTML = `<h4>회사 룰 사전 체크</h4><p class="hint">달력에서 패턴을 선택하면 룰 체크가 표시됩니다.</p>`;
    submitBtn.disabled = true;
    $("#saveDraftButton").disabled = !hasOffered;
    return;
  }
  if (editing) {
    submitBtn.disabled = false;
    $("#saveDraftButton").disabled = true;
    $("#postRuleCheck").innerHTML = `<p class="hint">희망 조건 수정 중에는 회사 룰 재검사를 하지 않습니다.</p>`;
    return;
  }
  const checks = checkRulesForSelection();
  const hasFail = checks.some(c => c.status === "FAIL");
  const hasWarn = checks.some(c => c.status === "WARN");
  const canSubmit = hasOffered && !hasFail;
  submitBtn.disabled = !canSubmit || !CREDIT_POLICY.canSpend(state, 1, isPremiumUser());
  $("#saveDraftButton").disabled = !hasOffered;

  const headerNote = hasFail
    ? `<span class="rule-header-note fail">불가 항목 있음 — 등록 차단됨</span>`
    : hasWarn
    ? `<span class="rule-header-note warn">확인 항목 있음 — 등록 후 회사 문의 필요</span>`
    : `<span class="rule-header-note pass">모두 통과</span>`;

  $("#postRuleCheck").innerHTML = `
    <div class="rule-check-header">
      <div class="rule-check-title">
        <strong>회사 룰 사전 체크</strong>
        <span class="hint" style="font-size:11px;">✗ 불가 = 등록 차단 · ⚠ 확인 = 등록 가능, 회사 문의 필요</span>
      </div>
      ${headerNote}
    </div>
    <div class="rule-grid">
      ${checks.map(c => `<div class="${c.status.toLowerCase()}">${c.status==="PASS"?"✓":c.status==="WARN"?"⚠":c.status==="FAIL"?"✗":"–"} ${c.label}</div>`).join("")}
    </div>
  `;
}

// 편조구성원(동료 이름): PRO는 상호 수락 전에도 바로 보이지만(서버가 posts-get
// 응답에 offered.crewPublic을 포함), 무료 사용자에게는 서버가 애초에 이 필드를
// 보내지 않는다. 그래서 없으면 "PRO면 바로, 아니면 상호 수락 후" 안내만 보여준다.
function crewPublicHtml(offered) {
  if (offered.crewPublic) {
    return `<div class="match-crew-public"><small>편조</small><span>${escapeHtml(offered.crewPublic)}</span></div>`;
  }
  return `<div class="match-crew-locked">🔒 편조구성원 — <strong>PRO</strong>는 지금 바로, 무료는 상호 수락 후 공개</div>`;
}

function matchPostDetailsHtml(offered) {
  const rows = window.CrewSwapPostDetails.rows(offered);
  return `
    <details class="match-flight-detail">
      <summary>운항 상세 보기 ▾</summary>
      <div class="match-flight-detail-list">
        ${crewPublicHtml(offered)}
        ${rows.map(row => {
          const times = [
            [row.fallback ? "첫 Show-up" : "Show-up", row.reportTime],
            [row.fallback ? "첫 STD" : "STD", row.departureTime],
            [row.fallback ? "마지막 STA" : "STA", row.arrivalTime],
            [row.fallback ? "마지막 Check-out" : "Check-out", row.releaseTime],
          ].filter(([, value]) => value);
          return `
            <div class="match-flight-detail-row">
              <div class="match-flight-detail-head">
                <strong>${escapeHtml(row.date)} · ${escapeHtml(row.title)}</strong>
                <span>${escapeHtml(row.type)}</span>
              </div>
              ${row.route ? `<p>${escapeHtml(row.route)}</p>` : ""}
              ${times.length ? `<div class="match-flight-times">
                ${times.map(([label, value]) => `<span><small>${label}</small><b>${escapeHtml(value)}</b></span>`).join("")}
              </div>` : `<div class="match-flight-no-time">추가 시간 정보가 없습니다.</div>`}
            </div>`;
        }).join("")}
      </div>
    </details>`;
}

// 자동 필터에 걸린 글을 사유별로 센다. 요약 줄과 빈 목록 안내가 같은 값을 쓴다.
// 같은 서버 글을 봐도 계정마다 보이는 건수가 다른 것이 정상인지 아닌지를
// 사용자가 직접 확인할 수 있어야 해서, 목록이 비지 않았을 때도 보여준다.
function matchExclusionRows() {
  const api = window.CrewSwapMatchExclusions;
  if (!api) return [];
  return api.summarize(state.posts.map(matchExclusionReason));
}

const EXCLUSION_SHORT_LABELS = {
  airline: "다른 항공사", crewType: "다른 직군", position: "다른 직책",
  aircraft: "기종", edto: "EDTO", cat3: "CAT III", deadline: "마감",
};

// "· 제외 8건 (마감 5 · 다른 직책 3)" 형태의 짧은 요약
function matchExclusionSummaryText(rows, filteredOut) {
  const mine = state.myPostsHiddenInFind || 0;
  const parts = rows.map(row => `${EXCLUSION_SHORT_LABELS[row.reason] || row.reason} ${row.count}`);
  if (filteredOut > 0) parts.push(`내 조건 ${filteredOut}`);
  if (mine > 0) parts.push(`내 글 ${mine}`);
  const total = rows.reduce((sum, row) => sum + row.count, 0) + Math.max(0, filteredOut) + mine;
  return total ? ` · 제외 ${total}건 (${parts.join(" · ")})` : "";
}

// 목록이 비었을 때 "왜 안 보이는지"를 그대로 보여준다.
// 이유 없이 빈 화면만 나오면 앱이 고장 난 것으로 보이고, 실제로 문의로 이어졌다.
function emptyMatchHtml() {
  const hint = `저장 검색에 등록해두면 조건에 맞는 새 글이 올라올 때 알림을 받을 수 있습니다.`;
  const hiddenMine = state.myPostsHiddenInFind || 0;
  const mine = hiddenMine
    ? `<p class="empty-note">내가 올린 글 ${hiddenMine}건은 이 목록에 나오지 않습니다 — <strong>내가 올린 스왑 관리</strong>에서 확인하세요.</p>`
    : "";

  // 불러오기가 실패한 상태 — "0건"과 구분해서 보여주고 다시 시도할 수 있게 한다.
  if (state.postsLoadError) {
    return `<div class="empty-state is-detailed is-error">
      <strong>스왑 글을 불러오지 못했습니다.</strong>
      <p>${escapeHtml(state.postsLoadError)} · 목록이 비어 보이는 것은 서버에 글이 없어서가 아닙니다.</p>
      <button class="secondary-button" data-action="retry-posts">다시 시도</button>
      ${state.postsLoadedAt ? `<p class="empty-note">마지막으로 불러온 시각 ${new Date(state.postsLoadedAt).toLocaleTimeString("ko-KR")}</p>` : ""}
    </div>`;
  }

  if (!state.posts.length) {
    return `<div class="empty-state"><strong>지금 올라온 다른 사람의 스왑 글이 없습니다.</strong>
      <p>${hint}</p>${mine}</div>`;
  }

  const rows = matchExclusionRows();
  const excluded = rows.reduce((sum, row) => sum + row.count, 0);
  const byMyFilters = state.posts.length - excluded; // 자동 필터는 통과했지만 내가 건 필터에 걸린 글
  const lines = rows.map(row => `<li>${escapeHtml(row.label)} · ${row.count}건</li>`);
  if (byMyFilters > 0) {
    lines.push(`<li>내가 선택한 조건(종류·날짜·시간·권역)에 걸린 글 · ${byMyFilters}건 — <strong>조건 수정</strong>에서 완화해보세요.</li>`);
  }

  return `<div class="empty-state is-detailed">
    <strong>지금 올라온 스왑 글 ${state.posts.length}건이 모두 제외됐습니다.</strong>
    <ul class="empty-reasons">${lines.join("")}</ul>
    <p>${hint}</p>${mine}</div>`;
}

function renderMatches() {
  const list = $("#matchList");
  const items = visiblePosts();
  const airlineLbl = AIRLINE_LABELS[state.user.airline] || state.user.airline;
  const crewLbl = CREWTYPE_LABELS[state.user.crewType] || state.user.crewType;
  const roleLabel = ROLE_LABELS[state.user.roleType] || CABIN_ROLE_LABELS[state.user.roleType] || state.user.roleType;
  const pilotQualStr = state.user.crewType !== "CABIN"
    ? ` · ${state.user.aircraft==="NG_MAX"?"NG+MAX":"NG"}${state.user.edto?" · EDTO":""}${state.user.cat3?" · CAT III":""}` : "";
  const exclusionRows = matchExclusionRows();
  const autoExcluded = exclusionRows.reduce((sum, row) => sum + row.count, 0);
  // 자동 필터는 통과했지만 내가 건 조건에 걸린 글
  const filteredOut = state.posts.length - autoExcluded - items.length;
  if (state.postsLoadError) {
    $("#matchSummary").textContent = `⚠️ 스왑 글을 불러오지 못했습니다 — ${state.postsLoadError}`;
    list.innerHTML = emptyMatchHtml();
    list.querySelector("[data-action='retry-posts']")?.addEventListener("click", () => {
      state.postsLoadError = null;
      renderMatches();
      fetchPosts();
    });
    return;
  }
  $("#matchSummary").textContent = items.length
    ? `${items.length}건의 매칭 가능 글 · 자동 필터: ${airlineLbl} · ${crewLbl} · ${roleLabel}${pilotQualStr}`
      + matchExclusionSummaryText(exclusionRows, filteredOut)
    : `올라온 글 ${state.posts.length}건 중 매칭 가능한 글이 없습니다 · 아래에서 제외 사유를 확인하세요.`;
  if (items.length === 0) {
    list.innerHTML = emptyMatchHtml();
    return;
  }
  list.innerHTML = items.map(({post, score}) => {
    const dd = score.dDay;
    const wantedTxt = wantedSummary(post.wanted);
    const isSubmitting = post.status === "submitting";
    return `
    <article class="match-card${isSubmitting ? " is-submitting" : ""}">
      <div class="card-head">
        <div>
          <h3>${post.offered.patternName}${isSubmitting ? ` <span class="badge badge-submitting">회사 상신중</span>` : ""}</h3>
          <p>${post.offered.summary}${post.offered.flightMinutes ? ` · ${(post.offered.flightMinutes/60).toFixed(1)}h` : ""}</p>
          <div class="badges">
            <span class="badge ${post.offered.type==="OFF"?"off":post.offered.type==="국내선"?"dom":post.offered.type==="RSV"?"rsv":""}">${post.offered.type}</span>
            <span class="badge badge-position">${positionLabel(post.ownerRole)}</span>
            ${post.offered.aircraft ? `<span class="badge badge-aircraft">✈ ${aircraftLabel(post.offered.aircraft)}</span>` : ""}
            ${post.offered.edto ? `<span class="badge">EDTO</span>` : ""}
            ${post.offered.cat3 ? `<span class="badge">CAT III</span>` : ""}
          </div>
        </div>
        <div class="match-deadline ${dd.days<=1?"urgent":""}">회사 제출<br>${dd.expired?"마감됨":`${companyDeadlineDueText(dd)}까지`}</div>
      </div>

      ${wantedTxt && wantedTxt !== "조건 없음" ? `<div class="match-wanted"><strong>원하는 조건</strong> ${wantedTxt}</div>` : ""}

      ${matchPostDetailsHtml(post.offered)}

      <div class="card-actions">
        ${post.status === "submitting"
          ? `<div class="card-unavailable submitting">🔒 이미 스왑이 성사되어 <strong>회사 상신 중</strong>입니다 — 요청할 수 없습니다</div>`
          : post.contactable === false
          ? `<div class="card-unavailable">이전 버전 글이라 요청할 수 없습니다</div>`
          : `<button class="secondary-button" data-action="ask" data-post="${post.id}">💬 양도 의향 묻기</button>
        <button class="primary-button" data-action="request" data-post="${post.id}">${isPremiumUser() ? "요청하기 · PRO 무제한" : "요청하기 · 1크레딧"}</button>`}
      </div>
    </article>`;
  }).join("");

  list.querySelectorAll("[data-action='request']").forEach(b => b.onclick = () => requestSwap(b.dataset.post));
  list.querySelectorAll("[data-action='ask']").forEach(b => b.onclick = () => askAboutPost(b.dataset.post));
}

/* ====== 공유 포스트 API 로드 (Netlify Blobs) ====== */
/* ====== PRO 권한 ======
 * 핵심 스왑 기능은 무료이며, PRO는 저장조건 자동 알림, 무제한 크레딧, 편조구성원 미리보기를 제공한다.
 * 가입 즉시가 아니라 사용자가 원할 때 계정당 한 번 30일 무료 이용권을 시작한다. */
const BETA_ALL_PREMIUM = false;
function isPremiumUser() {
  if (BETA_ALL_PREMIUM) return true;
  if (state.user.proEntitlement === 'lifetime') return true;
  if (state.user.proEntitlement === 'sandbox' || state.user.proEntitlement === 'trial' || state.user.proEntitlement === 'legacy') {
    const expiry = Date.parse(state.user.proExpiresAt || state.user.proTrialExpiresAt || '');
    return Number.isFinite(expiry) && expiry > Date.now();
  }
  return false;
}

function applyPremiumStatus(status, shouldRender = true) {
  const premium = status || {};
  state.user.isPremium = !!premium.active;
  state.user.proEntitlement = premium.entitlement || 'none';
  state.user.proTrialAvailable = premium.trialAvailable !== false;
  state.user.proTrialStartedAt = premium.trialStartedAt || null;
  state.user.proTrialExpiresAt = premium.trialExpiresAt || null;
  state.user.proExpiresAt = premium.expiresAt || premium.trialExpiresAt || null;
  saveState();
  if (shouldRender) {
    renderProDiscovery();
    renderSavedSearches();
    renderCredits();
    renderPostFooter();
    renderMatches();
  }
}

function formatProDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function renderProDiscovery() {
  const status = document.getElementById("profileProStatus");
  const button = document.getElementById("openProfilePro");
  const mainButton = document.getElementById("openMainPro");
  const updateMainButton = (title, detail) => {
    if (!mainButton) return;
    mainButton.innerHTML = `<strong>${title}</strong><small>${detail}</small>`;
  };
  if (state.user.proEntitlement === "lifetime") {
    if (status) status.textContent = "PRO 영구 이용권 사용 중 · 맞춤 알림, 무제한 크레딧, 편조구성원 미리보기";
    if (button) button.textContent = "PRO 기능 관리";
    updateMainButton("👑 PRO 기능 관리", "맞춤 알림 · 무제한 크레딧");
    return;
  }
  if (isPremiumUser()) {
    const until = formatProDate(state.user.proExpiresAt || state.user.proTrialExpiresAt);
    if (status) status.textContent = `${until ? `${until}까지 · ` : ""}맞춤 알림, 무제한 크레딧, 편조구성원 미리보기`;
    if (button) button.textContent = "PRO 기능 관리·영구 이용권 보기";
    updateMainButton("👑 PRO 기능 관리", `${until ? `${until}까지 · ` : ""}혜택 사용 중`);
    return;
  }
  if (status) status.textContent = "맞춤 알림 · 크레딧 무제한 · 편조구성원 미리보기";
  if (button) button.textContent = "PRO 자세히·구매";
  updateMainButton("👑 PRO 안내·구매", "맞춤 알림 · 무제한 크레딧");
}

async function refreshPremiumStatus() {
  if (!state.sessionToken || !state.user.email) return { ok: false, skipped: true };
  try {
    const response = await apiFetch(`${API_BASE}/api/premium-status`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'PRO 상태 확인 실패');
    applyPremiumStatus(data.premium);
    return { ok: true, premium: data.premium };
  } catch (error) {
    console.warn('premium status refresh failed:', error);
    return { ok: false, error: error.message };
  }
}

async function activateProTrialPass() {
  if (!state.user.proTrialAvailable) {
    showToast('PRO 30일 무료 이용권은 계정당 한 번만 사용할 수 있습니다.');
    return;
  }
  if (!confirm('PRO 30일 무료 이용권을 지금 시작할까요?\n시작하는 순간부터 30일 동안 사용할 수 있으며 일시정지하거나 다시 시작할 수 없습니다.')) return;
  const button = document.getElementById('activateProTrialBtn');
  if (button) button.disabled = true;
  try {
    const response = await apiFetch(`${API_BASE}/api/premium-trial-activate`, { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '무료 이용권 활성화 실패');
    applyPremiumStatus(data.premium);
    await syncPremiumAlertSettings();
    showToast(`PRO 무료 이용권 시작 · ${formatProDate(data.premium?.trialExpiresAt)}까지`);
  } catch (error) {
    showToast(error.message || '무료 이용권을 시작하지 못했습니다.');
    await refreshPremiumStatus();
  } finally {
    if (button) button.disabled = false;
  }
}

const PRO_PRODUCT_ID = 'com.rufnekcrewswap.pro.lifetime';

function storeKitBridge() {
  if (!isNativeIosCrewSwapApp()) return null;
  return window.Capacitor?.Plugins?.StoreKitBridge || null;
}

async function refreshNativeStoreEnvironment() {
  const StoreKit = storeKitBridge();
  if (!StoreKit) {
    _storeEnvironment = 'production';
    return _storeEnvironment;
  }
  try {
    const result = await StoreKit.getEnvironment();
    _storeEnvironment = result?.environment === 'sandbox' ? 'sandbox' : 'production';
  } catch {
    _storeEnvironment = 'production';
  }
  return _storeEnvironment;
}

async function verifyAndApplyApplePurchase(transaction, { finish = true } = {}) {
  if (!transaction || transaction.status !== 'verified') return { ok: false, skipped: true };
  const response = await apiFetch(`${API_BASE}/api/pro-purchase-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productId: PRO_PRODUCT_ID,
      transactionId: transaction.transactionId,
      signedTransaction: transaction.signedTransaction,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'App Store 구매 확인에 실패했습니다.');
  _storeEnvironment = data.environment === 'sandbox' ? 'sandbox' : _storeEnvironment;
  applyPremiumStatus(data.premium);
  if (finish) {
    await storeKitBridge()?.finish({ transactionId: transaction.transactionId }).catch(() => {});
  }
  await syncPremiumAlertSettings();
  return { ok: true, premium: data.premium };
}

async function purchaseLifetimePro() {
  const StoreKit = storeKitBridge();
  if (!StoreKit) {
    showToast('PRO 구매는 iPhone 앱에서 이용할 수 있습니다.');
    return;
  }
  const button = document.getElementById('purchaseLifetimeProBtn');
  if (button) button.disabled = true;
  try {
    const transaction = await StoreKit.purchase();
    if (transaction?.status === 'cancelled') return;
    if (transaction?.status === 'pending') {
      showToast('구매 승인을 기다리고 있습니다. 승인 후 자동으로 반영됩니다.');
      return;
    }
    await verifyAndApplyApplePurchase(transaction);
    showToast('CrewSwap PRO 영구 이용권이 활성화되었습니다.');
  } catch (error) {
    showToast(error?.message || 'PRO 구매를 완료하지 못했습니다.');
    await refreshPremiumStatus();
  } finally {
    if (button) button.disabled = false;
  }
}

async function restoreLifetimePro() {
  const StoreKit = storeKitBridge();
  if (!StoreKit) {
    showToast('구매 복원은 iPhone 앱에서 이용할 수 있습니다.');
    return;
  }
  const button = document.getElementById('restoreLifetimeProBtn');
  if (button) button.disabled = true;
  try {
    const transaction = await StoreKit.restore();
    if (transaction?.status !== 'verified') {
      showToast('복원할 CrewSwap PRO 구매 내역이 없습니다.');
      return;
    }
    await verifyAndApplyApplePurchase(transaction);
    showToast('CrewSwap PRO 구매 내역을 복원했습니다.');
  } catch (error) {
    showToast(error?.message || '구매 내역을 복원하지 못했습니다.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function refreshNativeStoreEntitlement() {
  await refreshNativeStoreEnvironment();
  const StoreKit = storeKitBridge();
  if (!StoreKit || !state.sessionToken || !state.user.email) return;
  try {
    const transaction = await StoreKit.currentEntitlement();
    if (transaction?.status === 'verified') await verifyAndApplyApplePurchase(transaction, { finish: false });
  } catch (error) {
    console.warn('StoreKit entitlement refresh failed:', error);
  }
}

async function loadProProductDisplay() {
  const button = document.getElementById('purchaseLifetimeProBtn');
  if (!button) return;
  const StoreKit = storeKitBridge();
  if (!StoreKit) {
    button.textContent = 'iPhone 앱에서 PRO 구매';
    button.disabled = true;
    return;
  }
  try {
    const product = await StoreKit.getProduct();
    button.textContent = `PRO 영구 이용권 구매 · ${product.displayPrice}`;
    button.disabled = false;
  } catch {
    button.textContent = '가격 설정 후 구매 가능';
    button.disabled = true;
  }
}

function proPurchaseControlsHtml() {
  if (!isNativeIosCrewSwapApp()) {
    return `<div class="premium-purchase-box"><small>PRO 영구 이용권 구매와 복원은 iPhone 앱에서 제공됩니다.</small></div>`;
  }
  return `<div class="premium-purchase-box">
    <button type="button" id="purchaseLifetimeProBtn" class="primary-button" disabled>PRO 상품 확인 중…</button>
    <button type="button" id="restoreLifetimeProBtn" class="secondary-button">이전 구매 복원</button>
    <small>한 번 구매하면 만료 없이 사용할 수 있으며 자동 결제되지 않습니다.</small>
  </div>`;
}

/* ====== 저장검색(스왑 알림) ======
 * PRO 이용자가 원하는 조건을 서버에 저장하면 새 글 등록 시 서버가 대조해 푸시한다. */
// 글의 박수(nights) 추정: 0=퀵턴(당일), 1=1박, 2+=장박, null=박수 개념 없음(OFF/RSV 등)
// 홈(퇴근 가능) 공항 — 여기서 밤을 보내는 건 '박'으로 치지 않음
function homeAirports() {
  return state.user.base === "PUS" ? ["PUS"] : ["GMP", "ICN"];
}
// 실제 오버나이트(박) 수 추정: 0=퀵턴, 1=1박, 2+=장박, null=박수 개념 없음(OFF/RSV 등)
function postNights(post) {
  const o = post.offered || {};
  const text = `${o.summary || ""} ${o.patternName || ""}`;
  const m = /(\d+)\s*박/.exec(text);            // ① 요약에 'N박' 명시가 있으면 그대로
  if (m) return parseInt(m[1], 10);
  // ② 라우트 기반: 연속 근무일이 같은 '비(非)홈' 공항에서 이어지면 그날 그 공항에서 1박
  const home = homeAirports();
  const segs = (o.summary || "").split("·").map(s => s.trim()).filter(Boolean);
  const airportsOf = seg => (seg.match(/[A-Z]{3}/g) || []);
  let nights = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const a = airportsOf(segs[i]), b = airportsOf(segs[i + 1]);
    if (!a.length || !b.length) continue;
    const last = a[a.length - 1], first = b[0];
    if (last === first && !home.includes(last)) nights++; // 같은 외지 공항에서 이어짐 = 오버나이트
  }
  const layovCount = (text.match(/LAYOV/gi) || []).length; // ③ LAYOV 표기 수도 참고
  nights = Math.max(nights, layovCount);
  if (nights > 0) return nights;
  if (o.type === "LAYOV" || o.layoverAirport) return 1;   // LAYOV인데 위에서 못 잡으면 최소 1박
  if (o.type === "국제선" || o.type === "국내선") return 0; // 박 근거 없으면 퀵턴/무박
  return null; // OFF/RSV/STBY 등
}
// 박수 → 버킷 라벨
function nightsBucket(n) { return n == null ? null : n === 0 ? "quick" : n === 1 ? "1" : "2plus"; }
const NIGHTS_OPTIONS = [{ v: "quick", label: "퀵턴(당일)" }, { v: "1", label: "1박" }, { v: "2plus", label: "2박+" }];

function postMatchesSavedSearch(post, s) {
  const o = post.offered || {};
  if (s.types && s.types.length && !s.types.includes(o.type)) return false;
  if (s.nights && s.nights.length) {
    const b = nightsBucket(postNights(post));
    if (b === null || !s.nights.includes(b)) return false;
  }
  if (s.keyword && s.keyword.trim()) {
    const sourceText = `${o.patternName || ""} ${o.summary || ""} ${o.region || ""} ${o.type || ""} ${o.layoverAirport || ""}`;
    if (!AIRPORT_ALIASES.airportKeywordMatches(sourceText, s.keyword)) return false;
  }
  return true;
}

// 새로 불러온 글들을 저장검색과 대조 → 조건 맞는 '새' 글이면 알림 (내가 실제 스왑 가능한 글만)
function scanSavedSearches() {
  if (!isPremiumUser()) return;
  if (!state.savedSearches || !state.savedSearches.length) return;
  let changed = false;
  state.savedSearches.forEach(s => {
    if (!s.notified) s.notified = [];
    state.posts.forEach(post => {
      if (s.notified.includes(post.id)) return;
      if (matchScore(post) === null) return; // 내 직군/자격으로 스왑 불가한 글은 제외
      if (!postMatchesSavedSearch(post, s)) return;
      s.notified.push(post.id);
      changed = true;
      const sLabel = s.label || s.keyword || (s.types && s.types.join("/")) || (s.nights && s.nights.join("/")) || "저장한 조건";
      state.alerts.unshift({
        kind: "match",
        goTo: "find",
        title: "🔔 관심 스왑 등장",
        body: `저장한 조건 '${sLabel}'에 맞는 스왑이 올라왔습니다 · ${post.offered?.patternName || ""} (${post.offered?.summary || post.offered?.type || ""})`,
        time: "방금",
        createdAt: new Date().toISOString(),
      });
      showToast(`🔔 관심 스왑 등장 — ${s.label}`);
    });
    if (s.notified.length > 300) s.notified = s.notified.slice(-300);
  });
  if (changed) { saveState(); renderAlerts(); }
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

function isNativeCrewSwapApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function isNativeIosCrewSwapApp() {
  return isNativeCrewSwapApp() && window.Capacitor?.getPlatform?.() === 'ios';
}

let _nativePushDevice = null;
let _nativePushListenersReady = false;
let _nativePushWaiters = [];

function nativePushPlugin() {
  return window.Capacitor?.Plugins?.PushNotifications || null;
}

function settleNativePushWaiters(error, device = null) {
  const waiters = _nativePushWaiters;
  _nativePushWaiters = [];
  waiters.forEach(({ resolve, reject }) => error ? reject(error) : resolve(device));
}

async function handleNativePushRoute(data = {}) {
  const route = data.route === 'myPostsManager' ? 'myPostsManager' : 'find';
  if (route === 'myPostsManager') await openMyPostsManager();
  else {
    switchTab('find');
    await fetchPosts();
  }
  setAlertPanel(false);
}

async function initNativePushNotifications() {
  if (!isNativeIosCrewSwapApp()) return false;
  const PushNotifications = nativePushPlugin();
  if (!PushNotifications) return false;

  if (!_nativePushListenersReady) {
    _nativePushListenersReady = true;
    await PushNotifications.addListener('registration', async token => {
      _nativePushDevice = {
        token: token.value,
        platform: 'ios',
        environment: 'auto',
        bundleId: 'com.rufnekcrewswap.app',
      };
      localStorage.setItem('crewswap_premium_push_enabled', '1');
      settleNativePushWaiters(null, _nativePushDevice);
      if (isPremiumUser() && state.sessionToken) await syncPremiumAlertSettings(null, _nativePushDevice);
      renderSavedSearches();
    });
    await PushNotifications.addListener('registrationError', error => {
      const registrationError = new Error(error?.error || 'APNs 기기 등록 실패');
      settleNativePushWaiters(registrationError);
      console.warn('native push registration failed:', registrationError);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', action => {
      handleNativePushRoute(action?.notification?.data || {}).catch(console.warn);
    });
    await PushNotifications.addListener('pushNotificationReceived', notification => {
      const data = notification?.data || {};
      state.alerts.unshift({
        kind: 'match',
        goTo: data.route || 'find',
        postId: data.postId || '',
        title: notification?.title || '🔔 조건에 맞는 새 스왑',
        body: notification?.body || '저장한 조건에 맞는 스왑이 올라왔습니다.',
        createdAt: new Date().toISOString(),
      });
      saveState();
      renderAlerts();
    });
  }

  // 이미 허용한 사용자는 앱 실행 때마다 APNs에서 최신 토큰을 다시 받아 서버로 보낸다.
  const permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'granted') await PushNotifications.register();
  return true;
}

async function registerNativePushNotifications() {
  const PushNotifications = nativePushPlugin();
  if (!PushNotifications || !(await initNativePushNotifications())) {
    throw new Error('이 앱 빌드에서 iPhone 알림 기능을 찾을 수 없습니다.');
  }
  let permission = await PushNotifications.checkPermissions();
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== 'granted') throw new Error('iPhone 설정에서 CrewSwap 알림을 허용해주세요.');

  const registration = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('APNs 기기 등록 시간이 초과되었습니다.')), 15000);
    _nativePushWaiters.push({
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
  });
  await PushNotifications.register();
  return registration;
}

async function syncPremiumAlertSettings(subscription = null, nativeDevice = undefined) {
  if (!isPremiumUser() || !state.user.email) return { ok: false, skipped: true };
  try {
    const response = await apiFetch(`${API_BASE}/api/premium-alert-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: state.user.email,
        profile: state.user,
        searches: state.savedSearches || [],
        subscription: subscription ? subscription.toJSON() : null,
        nativeDevice: nativeDevice === undefined ? _nativePushDevice : nativeDevice,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'PRO 알림 동기화 실패');
    return data;
  } catch (error) {
    console.warn('premium alert sync failed:', error);
    return { ok: false, error: error.message };
  }
}

async function enablePremiumBackgroundAlerts() {
  if (!isPremiumUser()) { showToast('PRO 전용 기능입니다. 무료 이용권을 먼저 시작해주세요.'); return; }
  if (isNativeCrewSwapApp()) {
    if (!isNativeIosCrewSwapApp()) {
      showToast('Android 백그라운드 알림은 다음 배포 단계에서 연결됩니다.');
      return;
    }
    try {
      const configResponse = await apiFetch(`${API_BASE}/api/premium-alert-config`);
      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !config.nativePushEnabled) {
        throw new Error('APNs 서버 키가 아직 연결되지 않았습니다.');
      }
      const nativeDevice = await registerNativePushNotifications();
      const synced = await syncPremiumAlertSettings(null, nativeDevice);
      if (!synced.ok || !synced.nativePushEnabled) throw new Error(synced.error || '기기 토큰 서버 등록 실패');
      const testResponse = await apiFetch(`${API_BASE}/api/premium-alert-test`, { method: 'POST' });
      const testResult = await testResponse.json().catch(() => ({}));
      if (!testResponse.ok || !testResult.delivered) {
        throw new Error(testResult.error || '테스트 알림 전송 실패');
      }
      localStorage.setItem('crewswap_premium_push_enabled', '1');
      renderSavedSearches();
      showToast('iPhone 테스트 알림을 보냈습니다.');
    } catch (error) {
      console.warn('native premium push enable failed:', error);
      showToast(`iPhone 알림 설정 실패 — ${error.message}`);
    }
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    showToast('이 환경에서는 백그라운드 푸시를 지원하지 않습니다.');
    return;
  }

  try {
    const configResponse = await apiFetch(`${API_BASE}/api/premium-alert-config`);
    const config = await configResponse.json();
    if (!config.enabled || !config.vapidPublicKey) {
      showToast('푸시 서버 설정 준비 중입니다.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { showToast('알림 권한을 허용해야 받을 수 있습니다.'); return; }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
      });
    }
    const synced = await syncPremiumAlertSettings(subscription);
    if (!synced.ok) throw new Error(synced.error || '푸시 등록 실패');
    localStorage.setItem('crewswap_premium_push_enabled', '1');
    renderSavedSearches();
    showToast('백그라운드 스왑 알림을 켰습니다.');
  } catch (error) {
    console.warn('premium push enable failed:', error);
    showToast(`백그라운드 알림 설정 실패 — ${error.message}`);
  }
}

async function fetchPosts() {
  try {
    const res = await apiFetch(`${API_BASE}/api/posts-get`);
    // 예전에는 여기서 그냥 return 해서, 불러오기 실패와 "글이 0건"이 화면에서
    // 구분되지 않았다. 테스터마다 보이는 건수가 달라도 원인을 알 수 없던 이유다.
    if (!res.ok) { setPostsLoadError(`서버 응답 오류 (HTTP ${res.status})`); return; }
    const data = await res.json();
    const myIds = new Set(state.myPosts.map(p => p.id));
    const now = Date.now();
    const serverPosts = data.posts || [];
    // 내가 올린 글은 스왑 찾기에 띄우지 않는다. 몇 건을 뺐는지 남겨서
    // "다른 사람보다 왜 적게 보이지?"를 화면에서 바로 알 수 있게 한다.
    state.myPostsHiddenInFind = serverPosts.filter(p => myIds.has(p.id)).length;
    state.posts = serverPosts
      .filter(p => !myIds.has(p.id))
      .map(p => ({
        ...p,
        postedHoursAgo: p.registeredAt
          ? Math.max(0, Math.round((now - new Date(p.registeredAt).getTime()) / 3600000))
          : 0,
      }));
    state.postsLoadError = null;
    state.postsLoadedAt = Date.now();
    renderMatches();
    scanSavedSearches();
  } catch (e) {
    console.warn("fetchPosts error:", e);
    setPostsLoadError(e.message || "네트워크 오류");
  }
}

// 불러오기 실패를 화면에 남긴다. 직전에 받아둔 목록은 지우지 않는다 —
// 실패했다고 목록을 비우면 "글이 사라졌다"로 보인다.
function setPostsLoadError(reason) {
  state.postsLoadError = reason;
  renderMatches();
}

// 매칭 성사(상호 수락) 시 호출 — 월/연 스왑 횟수 카운팅
function recordSwapMatch() {
  state.user.monthlySwapUsed = (state.user.monthlySwapUsed || 0) + 1;
  if (state.user.crewType === "CABIN") {
    state.user.yearlySwapUsed = (state.user.yearlySwapUsed || 0) + 1;
  }
  saveState();
  renderMetrics();
}

// 선택된 내 근무를 요청용 offered(X) 객체로 요약

function validationRosterSnapshot() {
  window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(state.schedules);
  const mogijiProtectedDays = state.user.crewType === "PILOT"
    ? window.CrewSwapMogijiPolicy?.collectProtectedDays(state.schedules)
    : null;
  return state.schedules
    .filter(s => s && s.day && (s.month || state.currentMonth))
    .map(s => ({
      day: s.day,
      month: s.month || state.currentMonth,
      type: s.type,
      title: s.title,
      dep: s.dep || null,
      arr: s.arr || null,
      layoverAirport: s.layoverAirport || null,
      routeSummary: s.routeSummary || (s.dep && s.arr ? `${s.dep}-${s.arr}` : null),
      reportTime: s.reportTime || null,
      departureTime: s.departureTime || null,
      releaseTime: s.releaseTime || null,
      arrivalTime: s.arrivalTime || null,
      patternId: s.patternId || null,
      blockMinutes: Number.isFinite(s.blockMinutes) ? s.blockMinutes : null,
      aircraft: s.aircraft || null,
      requiresEdto: !!s.requiresEdto,
      requiresCat3: !!s.requiresCat3,
      mogijiRest: state.user.crewType === "PILOT"
        ? window.CrewSwapMogijiPolicy?.markerForEntry(s, mogijiProtectedDays)
        : null,
    }));
}

// 잠금(선택)한 날을 제외한 '해당 월 전체 로스터'를 상대에게 공개용으로 요약
function buildOpenRoster() {
  // 공개 대상은 현재 월 하나이므로 일자를 직접 비교한다. 화면 전환 중 월 기준이
  // 달라져도 사용자가 숨긴 날이 다시 공개 목록에 포함되지 않게 한다.
  const lockedDays = new Set([...state.selectedDays].map(key => parseDayKey(key).day));
  return validationRosterSnapshot()
    .filter(s => (s.month || state.currentMonth) === state.currentMonth)
    .filter(s => !lockedDays.has(Number(s.day)))
    .sort((a, b) => a.day - b.day)
    .map(s => ({
      ...s,
      aircraft: s.aircraft || null,
      requiresEdto: !!s.requiresEdto, requiresCat3: !!s.requiresCat3,
    }));
}

function exactMatchedOffer(post) {
  const entries = window.CrewSwapRequestDisclosure?.exactFlightEntries(
    post,
    validationRosterSnapshot(),
    state.currentMonth,
  );
  return entries?.length ? offeredFromRosterDays(entries) : null;
}

// 공개 로스터 항목 배열 → offered 요약 객체 (상대가 고른 날들로 만듦; 휴식/표시용)
function offeredFromRosterDays(rosterEntries) {
  const ss = [...rosterEntries].sort((a, b) => a.day - b.day);
  if (!ss.length) return null;
  const dLabel = ss.map(s => `${schedMonthNumFromEntry(s)}/${s.day}`).join(",");
  const routes = ss.map(s => s.routeSummary || s.type).join(" · ");
  return {
    patternName: `${dLabel} · ${ss[0].type} 패턴`,
    summary: routes,
    type: ss[0].type,
    days: ss.map(s => s.day),
    dateKeys: ss.map(s => dayKey(s.day, s.month || state.currentMonth)),
    daySchedules: ss.map(s => ({
      month: s.month || state.currentMonth,
      day: s.day,
      type: s.type,
      title: s.title || null,
      dep: s.dep || null,
      arr: s.arr || null,
      routeSummary: s.routeSummary || null,
      reportTime: s.reportTime || null,
      departureTime: s.departureTime || null,
      arrivalTime: s.arrivalTime || null,
      releaseTime: s.releaseTime || null,
    })),
    aircraft: ss[0].aircraft || null,
    reportTime: (ss.find(s => s.reportTime && /^\d/.test(s.reportTime)) || {}).reportTime || null,
    firstDepartureTime: (ss.find(s => s.departureTime && /^\d/.test(s.departureTime)) || {}).departureTime || null,
    firstDepAirport: (ss.find(s => s.dep) || {}).dep || null,
    releaseTime: ([...ss].reverse().find(s => s.releaseTime && /^\d/.test(s.releaseTime)) || {}).releaseTime || null,
    lastReport: (ss[ss.length - 1] && /^\d/.test(ss[ss.length - 1].reportTime || "")) ? ss[ss.length - 1].reportTime : null,
    lastArrival: (ss[ss.length - 1] && /^\d/.test(ss[ss.length - 1].arrivalTime || "")) ? ss[ss.length - 1].arrivalTime : null,
    lastArrAirport: (ss[ss.length - 1] && ss[ss.length - 1].arr) || null,
    hasLayover: ss.some(s => s.type === "LAYOV" || s.type === "ARRIVAL"),
  };
}
function schedMonthNumFromEntry(s) { return parseInt((s.month || state.currentMonth).split("-")[1], 10); }

// 요청하기 진입 — 내 스케줄 전체를 열고(잠금만 선택) 상대가 고르게 함
function requestSwap(postId) {
  if (!CREDIT_POLICY.canSpend(state, 1, isPremiumUser())) { showToast("크레딧이 부족합니다 — 다음 달 기본 크레딧 또는 PRO를 이용해주세요."); return; }
  if (!state.user.email) { showToast("이메일 인증 정보가 없어 요청을 보낼 수 없습니다. 다시 가입해주세요."); return; }
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  const directOffer = exactMatchedOffer(p);
  if (directOffer) {
    beginScheduleSelection("request", null);
    openRequestModal(postId, directOffer);
    return;
  }
  // 날짜가 정확히 일치하는 1:1 교환이 아니면 내 스케줄 전체를 열어야 함 — 왜 갑자기
  // 내 근무 화면으로 넘어가는지 사용자가 모를 수 있어 미리 안내하고 취소할 수 있게 함.
  if (!confirm("상대와 날짜가 정확히 일치하지 않아 1:1 교환이 불가능합니다.\n내 스케줄 전체를 상대에게 공개해 상대가 바꿀 날을 직접 고르게 됩니다.\n(다음 화면에서 보여주기 싫은 날짜는 숨길 수 있습니다)\n\n계속할까요?"))
    return;
  beginScheduleSelection("request", postId);
  // 바꿔줄 내 근무를 고르도록 항상 내 근무 화면으로 이동 — 여러 날을 고른 뒤 "다음"으로 직접 넘어가게 함
  // 상대 글의 월로 달력을 맞춰서 이동 (안 그러면 오늘 보고 있던 달이 그대로 남아 엉뚱한 달이 열림)
  state.currentMonth = postDeadlineMonth(p);
  switchTab("schedule", { preserveSelection: true });
  renderPendingBar();
}

// 양도 의향 묻기 진입 — 자유 텍스트 대신 내 스케줄을 선택해 관심을 표시 (일수 일치 불필요, 크레딧 없음)
function askAboutPost(postId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없어 의향을 보낼 수 없습니다. 다시 가입해주세요."); return; }
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  const directOffer = exactMatchedOffer(p);
  if (directOffer) {
    beginScheduleSelection("ask", null);
    openAskModal(postId, directOffer);
    return;
  }
  // 날짜가 정확히 일치하는 1:1 교환이 아니면 내 스케줄 전체를 열어야 함 — 왜 갑자기
  // 내 근무 화면으로 넘어가는지 사용자가 모를 수 있어 미리 안내하고 취소할 수 있게 함.
  if (!confirm("상대와 날짜가 정확히 일치하지 않아 1:1 교환이 불가능합니다.\n내 스케줄 전체를 상대에게 공개해 상대가 바꿀 날을 직접 고르게 됩니다.\n(다음 화면에서 보여주기 싫은 날짜는 숨길 수 있습니다)\n\n계속할까요?"))
    return;
  beginScheduleSelection("ask", postId);
  // 상대 글의 월로 달력을 맞춰서 이동 (안 그러면 오늘 보고 있던 달이 그대로 남아 엉뚱한 달이 열림)
  state.currentMonth = postDeadlineMonth(p);
  switchTab("schedule", { preserveSelection: true });
  renderPendingBar();
}

// 공개 로스터 요약 HTML (모달에서 '내가 여는 것' 표시)
function openRosterSummaryHtml(roster, lockedCount) {
  const n = roster.length;
  const preview = roster.slice(0, 6).map(s => `${schedMonthNumFromEntry(s)}/${s.day} ${s.type}`).join(" · ");
  return `<strong>📂 내 스케줄 공개 (${n}일)</strong>
    <div>${escapeHtml(preview)}${n > 6 ? " …" : ""}</div>
    <div class="hint" style="margin-top:4px;">${lockedCount > 0 ? `🙈 ${lockedCount}일 숨김 · ` : ""}상대가 바꿀 날을 직접 고릅니다</div>`;
}

function directOfferSummaryHtml(offered) {
  return `<strong>🎯 1:1 날짜 매칭 · 이 비행만 공개</strong>
    <div>${escapeHtml(offered.patternName || "비행 일정")}</div>
    <div class="hint" style="margin-top:4px;">${escapeHtml(offered.summary || offered.type || "")}</div>`;
}

function openAskModal(postId, directOffer = null) {
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  const roster = buildOpenRoster();
  const lockedCount = state.selectedDays.size;
  const askD = document.getElementById("askDialog");
  askD._postId = postId;
  askD._directOffer = directOffer;
  askD._requestId = `REQ-${crypto.randomUUID()}`;
  document.getElementById("askDialogTitle").textContent = `💬 ${p.ownerNick || "상대"} 님에게 의향 표시`;
  document.getElementById("askMine").innerHTML = directOffer
    ? directOfferSummaryHtml(directOffer)
    : openRosterSummaryHtml(roster, lockedCount);
  document.getElementById("askTheirs").innerHTML =
    `<strong>${p.offered.patternName}</strong><div>${p.offered.summary || p.offered.type}</div>`;
  const askHint = document.getElementById("askHint");
  askHint.textContent = window.CrewSwapRequestDisclosure.disclosureHint("ask", !!directOffer);
  askHint.style.color = "";
  document.getElementById("askSendButton").disabled = !directOffer && roster.length === 0;
  openGenericModal("askDialog", "askOverlay");
}

async function sendAskInterest() {
  const askD = document.getElementById("askDialog");
  const postId = askD._postId;
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  const directOffer = askD._directOffer || null;
  const roster = buildOpenRoster();
  if (!directOffer && roster.length === 0) { showToast("공개할 근무가 없습니다 (모두 숨김)."); return; }
  await sendOpenSwap(postId, "ask", directOffer ? null : roster, directOffer, askD._requestId);
  closeGenericModal("askDialog", "askOverlay");
}

// 요청/의향 공통 전송 — 공개 로스터를 첨부 (offered는 상대가 고른 뒤 확정)
async function sendOpenSwap(postId, type, roster, offered = null, requestId = null) {
  const lockedDays = [...state.selectedDays].map(k => parseDayKey(k).day);
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: requestId || `REQ-${crypto.randomUUID()}`, postId, type,
        fromEmail: state.user.email, fromNick: state.user.nickname,
        fromBase: state.user.base, fromRole: state.user.roleType,
        fromRealName: state.user.realName || "", fromEmployeeId: state.user.employeeId || "", fromPhone: state.user.phone || "",
        offered,
        openRoster: roster,
        lockedDays,
        validationRoster: validationRosterSnapshot(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.wallet) applyCreditWallet(data.wallet);
    if (!res.ok) { showToast(data.error || "전송 실패 — 다시 시도해주세요."); return false; }
  } catch (e) { showToast("전송 실패 — 네트워크 오류"); return false; }
  resetScheduleSelection();
  fetchRequests();
  showToast(type === "ask"
    ? (offered ? "의향을 보냈습니다 — 1:1 매칭 비행만 상대에게 전달했습니다." : "의향을 보냈습니다 — 숨긴 날을 제외한 내 스케줄이 상대에게 열렸습니다.")
    : (offered ? "요청을 보냈습니다 — 1:1 매칭 비행만 상대에게 전달했습니다." : "요청을 보냈습니다 — 숨긴 날을 제외한 내 스케줄이 상대에게 열렸습니다."));
  return true;
}

function openRequestModal(postId, directOffer = null) {
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  const roster = buildOpenRoster();
  const lockedCount = state.selectedDays.size;
  const reqD = document.getElementById("reqDialog");
  reqD._postId = postId;
  reqD._directOffer = directOffer;
  reqD._requestId = `REQ-${crypto.randomUUID()}`;
  document.getElementById("reqDialogTitle").textContent = `${p.ownerNick || "상대"} 님에게 스왑 요청`;
  document.getElementById("reqMine").innerHTML = directOffer
    ? directOfferSummaryHtml(directOffer)
    : openRosterSummaryHtml(roster, lockedCount);
  document.getElementById("reqTheirs").innerHTML =
    `<strong>${p.offered.patternName}</strong><div>${p.offered.summary || p.offered.type}</div>`;
  const hintEl = document.getElementById("reqHint");
  hintEl.textContent = window.CrewSwapRequestDisclosure.disclosureHint("request", !!directOffer);
  hintEl.style.color = "";
  const confirmButton = document.getElementById("reqConfirmButton");
  confirmButton.textContent = isPremiumUser() ? "요청 보내기 · PRO 무제한" : "요청 보내기 · 1크레딧";
  confirmButton.disabled = (!directOffer && roster.length === 0) || !CREDIT_POLICY.canSpend(state, 1, isPremiumUser());
  openGenericModal("reqDialog", "reqOverlay");
}

async function sendSwapRequest() {
  const reqD = document.getElementById("reqDialog");
  const postId = reqD._postId;
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  if (!CREDIT_POLICY.canSpend(state, 1, isPremiumUser())) { showToast("크레딧이 부족합니다 — 다음 달 기본 크레딧 또는 PRO를 이용해주세요."); return; }
  const directOffer = reqD._directOffer || null;
  const roster = buildOpenRoster();
  if (!directOffer && roster.length === 0) { showToast("공개할 근무가 없습니다 (모두 숨김)."); return; }
  const ok = await sendOpenSwap(postId, "request", directOffer ? null : roster, directOffer, reqD._requestId);
  if (ok) closeGenericModal("reqDialog", "reqOverlay");
}

// 방금 취소한 글 ID — KV 최종일관성으로 목록에 잠시 남아도 다시 안 불러오게 차단 (세션 한정)
const _deletedPostIds = new Set();

async function fetchMyPosts() {
  if (!state.user.email) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/posts-get-mine`);
    if (!res.ok) { processExpiredRefunds(); return; }
    const data = await res.json();
    // 방금 취소한 글은 서버 목록에 남아있어도 제외
    const serverPosts = (data.posts || []).filter(p => !_deletedPostIds.has(p.id));
    // 서버에 없는(구버전·ownerEmail 미포함) 로컬 전용 글은 보존, 같은 id는 서버 데이터로 갱신
    const localOnly = state.myPosts.filter(p => !serverPosts.some(sp => sp.id === p.id) && !_deletedPostIds.has(p.id));
    state.myPosts = [...serverPosts, ...localOnly];
    saveState();
    processExpiredRefunds();
    renderMyPosts();
  } catch (e) { console.warn("fetchMyPosts error:", e); processExpiredRefunds(); }
}

// 마감일이 지났는데 매칭되지 않은 내 스왑 글 → 사용 크레딧 50% 자동 환급
async function processExpiredRefunds() {
  let refundTotal = 0, count = 0, changed = false;
  const newlyExpired = [];
  for (const p of state.myPosts) {
    if (p.matched) continue;
    const dd = dDayInfo(p.deadlineDay, postDeadlineMonth(p));
    if (!dd.expired) continue;
    if (!p.refunded && p.status !== "expired") {
      if (!p.deleteToken) continue;
      let result;
      try {
        const response = await apiFetch(`${API_BASE}/api/posts-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: p.id, deleteToken: p.deleteToken, reason: "expired" }),
        });
        result = await response.json().catch(() => ({}));
        if (result.wallet) applyCreditWallet(result.wallet);
        if (!response.ok) continue;
      } catch (error) {
        console.warn("expired post 서버 처리 실패:", error);
        continue;
      }
      const refund = Number(result.refunded) || 0;
      p.refundGranted = refund;
      p.refunded = true;
      p.status = "expired";
      refundTotal += refund;
      count++;
      newlyExpired.push(p);
      changed = true;
    }
    if (!p.expiredAlerted && (p.refunded || p.status === "expired")) {
      const refund = Object.prototype.hasOwnProperty.call(p, "refundGranted")
        ? p.refundGranted
        : CREDIT_POLICY.recordedSpend(p) * 0.5;
      p.expiredAlerted = true;
      state.alerts.unshift({
        kind: "urgent",
        goTo: "myPostsManager",
        postId: p.id,
        title: refund > 0 ? "⏰ 스왑 마감 · 크레딧 환급" : "⏰ 스왑 마감",
        body: refund > 0
          ? `내가 올린 '${p.offered?.patternName || "스왑"}'이 매칭 없이 마감되어 ${refund}크레딧(50%)이 환급되었습니다.`
          : CREDIT_POLICY.recordedSpend(p) === 0
            ? `내가 올린 '${p.offered?.patternName || "스왑"}'이 매칭 없이 마감되었습니다. PRO 무제한으로 등록한 글이라 크레딧 변동은 없습니다.`
            : `내가 올린 '${p.offered?.patternName || "스왑"}'이 매칭 없이 마감되었습니다. 기본 크레딧이 이미 3개 이상이라 추가 환급은 없습니다.`,
        time: "방금",
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  if (changed) {
    saveState();
    renderCredits();
    renderMyPosts();
    renderAlerts();
    if (count > 0) {
      const allProPosts = newlyExpired.every(p => CREDIT_POLICY.recordedSpend(p) === 0);
      showToast(refundTotal > 0
        ? `마감된 미매칭 스왑 ${count}건 — 크레딧 ${refundTotal} 환급`
        : allProPosts
          ? `마감된 미매칭 스왑 ${count}건 — PRO 등록이라 크레딧 변동 없음`
          : `마감된 미매칭 스왑 ${count}건 — 기본 크레딧 상한(3개)이라 추가 환급 없음`);
    }
  }
}

// 이미 종 알림으로 띄운 요청 ID (localStorage 영속화 — 새로고침해도 중복 알림 방지)
function getAlertedReqIds() {
  try { return new Set(JSON.parse(localStorage.getItem("crewswap_alerted_reqs") || "[]")); }
  catch { return new Set(); }
}
function saveAlertedReqIds(set) {
  localStorage.setItem("crewswap_alerted_reqs", JSON.stringify([...set].slice(-200)));
}

// 내가 보낸 의향 문의가 상대에게 수락됐을 때 — 이미 알림 띄운 건 중복 방지
function getSeenAskAcceptedIds() {
  try { return new Set(JSON.parse(localStorage.getItem("crewswap_seen_ask_accepted") || "[]")); }
  catch { return new Set(); }
}
function saveSeenAskAcceptedIds(set) {
  localStorage.setItem("crewswap_seen_ask_accepted", JSON.stringify([...set].slice(-200)));
}

async function fetchRequests() {
  if (!state.user.email) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-get`);
    if (!res.ok) return;
    const data = await res.json();
    const ago = (iso) => {
      const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
      if (mins < 1) return "방금";
      if (mins < 60) return `${mins}분 전`;
      return `${Math.round(mins / 60)}시간 전`;
    };
    const normalizeRoster = r => {
      window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(r.openRoster);
      return r;
    };
    const received = (data.received || []).map(r => normalizeRoster({ ...r, sentAgo: ago(r.createdAt), nickname: r.fromNick, base: r.fromBase })).reverse();
    const sent = (data.sent || []).map(r => normalizeRoster({ ...r, sentAgo: ago(r.createdAt), nickname: r.toNick, base: r.base })).reverse();
    state.requests.sent = sent;
    // 받은 요청 중 아직 종 알림 안 띄운 것 → 종 알림 추가 (있던 것/새 것 모두 한 번씩)
    const alerted = getAlertedReqIds();
    let changed = false;
    received.forEach(r => {
      if (alerted.has(r.id)) return;
      alerted.add(r.id); changed = true;
      const isAsk = r.type === "ask";
      state.alerts.unshift({
        kind: "match",
        title: isAsk ? "💬 양도 의향 문의 도착" : "📩 스왑 요청 도착",
        body: `${r.fromNick || "상대"} 님 · ${r.postTitle || ""}${r.message ? ` — "${r.message}"` : ""}`,
        time: r.sentAgo || "방금",
        createdAt: r.createdAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "received",
      });
      // 토스트는 최근(2분 내) 도착분만 (오래된 것 무더기 토스트 방지)
      const mins = (Date.now() - new Date(r.createdAt).getTime()) / 60000;
      if (mins <= 2) showToast(`${isAsk ? "💬 의향 문의" : "📩 스왑 요청"} 도착 — ${r.fromNick || "상대"} 님`);
    });
    // 내가 보낸 의향 문의가 상대에게 수락됐을 때도 알려줌 (받은 쪽만 알림 가던 문제 보완)
    const seenAccepted = getSeenAskAcceptedIds();
    sent.forEach(r => {
      if (r.type !== "ask" || !r.askAccepted || seenAccepted.has(r.id)) return;
      seenAccepted.add(r.id); changed = true;
      state.alerts.unshift({
        kind: "match",
        title: "✓ 의향 수락됨",
        body: `${r.toNick || "상대"} 님이 관심을 수락했습니다 · ${r.postTitle || ""} — 정식 요청을 보내보세요`,
        time: r.sentAgo || "방금",
        createdAt: new Date().toISOString(),
        requestId: r.id,
        viewMode: "sent",
      });
      showToast(`✓ ${r.toNick || "상대"} 님이 의향을 수락했습니다`);
    });
    // 글작성자가 내 공개 로스터에서 날짜를 골랐을 때 — 요청자의 최종 승인 필요
    const seenPosterPick = new Set(JSON.parse(localStorage.getItem("crewswap_seen_poster_pick") || "[]"));
    sent.forEach(r => {
      if (!r.posterSelected || !r.offered || (r.stage || 1) !== 2 || seenPosterPick.has(r.id)) return;
      seenPosterPick.add(r.id); changed = true;
      state.alerts.unshift({
        kind: "match",
        title: "🔔 스왑 최종 승인 필요",
        body: `${r.toNick || "상대"} 님이 내 공개 스케줄에서 ${(r.offered.days || []).map(d => d + "일").join(", ")}을 선택했습니다 · 교환 내용을 확인해주세요`,
        time: "방금",
        createdAt: r.posterSelectedAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "sent",
      });
      showToast(`🔔 ${r.toNick || "상대"} 님의 일정 선택 — 최종 승인이 필요합니다`);
    });
    localStorage.setItem("crewswap_seen_poster_pick", JSON.stringify([...seenPosterPick].slice(-200)));
    // 내가 보낸 정식 요청이 상호 수락됐을 때 알림 (받은 쪽만 알림 가던 문제 보완)
    const seenReqAccepted = new Set(JSON.parse(localStorage.getItem("crewswap_seen_req_accepted") || "[]"));
    sent.forEach(r => {
      if ((r.stage || 1) < 3 || seenReqAccepted.has(r.id)) return;
      // 구버전 ask(offered 즉시)이면서 posterSelected 아닌 건 제외
      if (r.type === "ask" && !r.posterSelected && !r.offered) return;
      seenReqAccepted.add(r.id); changed = true;
      const picked = r.posterSelected && r.offered ? ` (${(r.offered.days || []).map(d => d + "일").join(", ")} 선택됨)` : "";
      state.alerts.unshift({
        kind: "match",
        title: "✓ 스왑 확정 (상호 수락)",
        body: `${r.toNick || "상대"} 님이 내 스케줄에서 바꿀 날을 골랐습니다${picked} · ${r.postTitle || ""} — 회사 상신 단계로 진행하세요`,
        time: "방금",
        createdAt: r.acceptedAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "sent",
      });
      showToast(`✓ ${r.toNick || "상대"} 님이 스왑을 확정했습니다`);
    });
    localStorage.setItem("crewswap_seen_req_accepted", JSON.stringify([...seenReqAccepted].slice(-200)));
    // 글작성자에게 요청자의 최종 승인 완료 알림 + 스왑 횟수 1회 반영
    const seenPosterAccepted = new Set(JSON.parse(localStorage.getItem("crewswap_seen_poster_accepted") || "[]"));
    received.forEach(r => {
      if (!r.posterSelected || (r.stage || 1) < 3 || seenPosterAccepted.has(r.id)) return;
      seenPosterAccepted.add(r.id); changed = true;
      recordSwapMatch();
      state.alerts.unshift({
        kind: "match",
        title: "✓ 상대가 스왑을 최종 승인했습니다",
        body: `${r.fromNick || "상대"} 님이 선택한 교환 일정을 승인했습니다 · ${r.postTitle || ""} — 회사 상신을 진행해주세요`,
        time: "방금",
        createdAt: r.acceptedAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "received",
      });
      showToast(`✓ ${r.fromNick || "상대"} 님이 스왑을 최종 승인했습니다`);
    });
    localStorage.setItem("crewswap_seen_poster_accepted", JSON.stringify([...seenPosterAccepted].slice(-200)));
    // 내가 보낸 요청이 거절됐을 때 알림
    const seenDeclined = new Set(JSON.parse(localStorage.getItem("crewswap_seen_declined") || "[]"));
    sent.forEach(r => {
      if (!r.declined || seenDeclined.has(r.id)) return;
      seenDeclined.add(r.id); changed = true;
      const isMogijiConflict = r.declineReason === "MOGIJI_REST_CONFLICT";
      state.alerts.unshift({
        kind: "match",
        title: isMogijiConflict ? "⚠️ 모기지 휴무 규정으로 요청 불가" : "💔 요청/의향 거절됨",
        body: `${r.toNick || "상대"} 님 · ${r.declineMsg || "개인적 사정으로 거절"}`,
        time: "방금",
        createdAt: r.declinedAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "sent",
      });
      showToast(isMogijiConflict
        ? "모기지 휴무 규정 불일치로 요청이 진행되지 않았습니다."
        : `💔 ${r.toNick || "상대"} 님이 요청을 거절했습니다`);
    });
    localStorage.setItem("crewswap_seen_declined", JSON.stringify([...seenDeclined].slice(-200)));
    // #4-a: 글작성자(received)에게 요청자의 회사 상신 독촉 알림
    const seenNudge = new Set(JSON.parse(localStorage.getItem("crewswap_seen_nudge") || "[]"));
    received.forEach(r => {
      if (!r.submitNudgeCount || r.submitted) return;
      const key = `${r.id}:${r.submitNudgeCount}`;
      if (seenNudge.has(key)) return;
      seenNudge.add(key); changed = true;
      state.alerts.unshift({
        kind: "match",
        title: "🔔 회사 상신 확인 요청 도착",
        body: `${r.fromNick || "상대"} 님이 회사 상신 여부를 확인하고 있습니다 · ${r.postTitle || ""} — '회사 상신 완료로 표시'를 눌러주세요`,
        time: "방금",
        createdAt: r.submitNudgedAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "received",
      });
      showToast(`🔔 ${r.fromNick || "상대"} 님이 회사 상신 여부를 확인했습니다`);
    });
    localStorage.setItem("crewswap_seen_nudge", JSON.stringify([...seenNudge].slice(-200)));
    // #4-b: 요청자(sent)에게 글작성자의 회사 상신 완료 알림
    const seenSubmitted = new Set(JSON.parse(localStorage.getItem("crewswap_seen_submitted") || "[]"));
    sent.forEach(r => {
      if (!r.submitted || seenSubmitted.has(r.id)) return;
      seenSubmitted.add(r.id); changed = true;
      state.alerts.unshift({
        kind: "match",
        title: "✅ 회사 상신 완료됨",
        body: `${r.toNick || "상대"} 님이 회사에 스왑을 상신했습니다 · ${r.postTitle || ""}`,
        time: "방금",
        createdAt: r.submittedAt || new Date().toISOString(),
        requestId: r.id,
        viewMode: "sent",
      });
      showToast(`✅ ${r.toNick || "상대"} 님이 회사 상신을 완료했습니다`);
    });
    localStorage.setItem("crewswap_seen_submitted", JSON.stringify([...seenSubmitted].slice(-200)));
    if (changed) { saveAlertedReqIds(alerted); saveSeenAskAcceptedIds(seenAccepted); saveState(); renderAlerts(); }
    state.requests.received = received;
    renderRequests();
    renderReqTabBadge();
  } catch (e) { console.warn("fetchRequests error:", e); }
}

// 앱 켜져 있는 동안 주기적으로 새 요청/글 확인 (가벼운 폴링)
let _pollTimer = null;
function startRequestPolling() {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    if (document.hidden || !state.user.email) return; // 백그라운드면 스킵
    fetchRequests();
    regenCredits(); // 크레딧 시간 재생 체크
  }, 25000);
}

// 받은 요청 중 아직 수락 안 한(대기) 건수를 요청함 탭에 배지로 표시
function renderReqTabBadge() {
  const badge = document.getElementById("reqTabBadge");
  if (!badge) return;
  const pendingReceived = (state.requests.received || []).filter(r => (r.stage || 1) < 3).length;
  const pendingSentApproval = (state.requests.sent || []).filter(r =>
    !!r.posterSelected && !!r.offered && (r.stage || 1) === 2).length;
  const pending = pendingReceived + pendingSentApproval;
  if (pending > 0) { badge.textContent = pending; badge.hidden = false; }
  else { badge.hidden = true; }
}

const SAVED_TYPE_OPTIONS = ["OFF", "국내선", "국제선", "LAYOV", "RSV", "STBY"];
function renderSavedSearches() {
  const listEl = document.getElementById("savedList");
  if (!listEl) return;
  const searches = state.savedSearches || [];
  const premium = isPremiumUser();
  const nativeApp = isNativeCrewSwapApp();
  const trialExpiry = formatProDate(state.user.proTrialExpiresAt);
  const accessBanner = state.user.proEntitlement === 'trial'
    ? `<div class="premium-access-state is-active"><strong>🎟️ PRO 30일 무료 이용권 사용 중</strong><span>${trialExpiry}까지 자동 알림·무제한 크레딧·편조구성원 미리보기를 사용할 수 있습니다. 자동 결제되지 않습니다.</span></div>`
    : state.user.proEntitlement === 'lifetime'
      ? `<div class="premium-access-state is-active"><strong>✓ PRO 영구 이용권</strong><span>만료 없이 자동 알림·무제한 크레딧·편조구성원 미리보기를 사용할 수 있습니다.</span></div>`
      : state.user.proEntitlement === 'sandbox'
        ? `<div class="premium-access-state is-active"><strong>🧪 TestFlight PRO 테스트 이용권</strong><span>${formatProDate(state.user.proExpiresAt)}까지 실제 과금 없이 PRO 기능을 테스트할 수 있습니다.</span></div>`
      : '';

  listEl.innerHTML = !premium
    ? state.user.proTrialAvailable
      ? `<div class="premium-lock"><strong>🎟️ PRO 30일 무료 이용권</strong><small>가입 즉시 시작되지 않습니다. 필요한 시점에 직접 시작하고 30일 동안 자동 알림·무제한 크레딧·편조구성원 미리보기를 사용해보세요. 결제정보가 필요 없고 자동 결제되지 않습니다.</small><button type="button" id="activateProTrialBtn" class="primary-button">원하는 날짜부터 30일 시작하기</button></div>${proPurchaseControlsHtml()}`
      : `<div class="premium-lock"><strong>PRO 무료 이용권 사용 완료</strong><small>저장한 조건은 그대로 보관되어 있습니다. PRO 영구 이용권을 구매하면 자동 알림을 다시 사용할 수 있습니다.</small></div>${proPurchaseControlsHtml()}`
    : accessBanner + (state.user.proEntitlement === 'trial' ? proPurchaseControlsHtml() : '') + (searches.length
    ? searches.map(s => `
        <div class="saved-item">
          <button class="saved-del" data-id="${s.id}" title="삭제">×</button>
          <strong>🔔 ${escapeHtml(s.label)}</strong>
          <span class="saved-meta">알림 ${(s.notified || []).length}건 받음</span>
        </div>
      `).join("")
    : `<span class="hint">저장한 알림 조건이 없습니다. 원하는 조건을 저장하면 PRO 알림 서버가 새 스왑 글을 확인합니다.</span>`);

  const addEl = document.getElementById("savedAddForm");
  if (addEl) {
    if (!premium) {
      addEl.innerHTML = '';
    } else {
      const pushEnabled = localStorage.getItem('crewswap_premium_push_enabled') === '1';
      addEl.innerHTML = `
        <div class="premium-push-state ${pushEnabled ? 'is-on' : ''}">
          <strong>${pushEnabled ? '✓ 백그라운드 알림 켜짐' : '앱을 열지 않아도 새 글 알림'}</strong>
          <span>${nativeApp ? 'iPhone에서 앱을 닫아도 조건에 맞는 새 스왑 알림을 받을 수 있습니다.' : '홈 화면에 설치한 웹앱/PWA에서 받을 수 있습니다.'}</span>
          <button type="button" id="premiumPushEnableBtn" class="secondary-button">${pushEnabled ? '알림 다시 확인' : '백그라운드 알림 켜기'}</button>
        </div>
        <input id="savedKeyword" placeholder="공항명·IATA·ICAO (예: 다낭, DAD, VVDN)" />
        <div class="saved-keyword-help">한글명·영문명·IATA·ICAO 중 편한 방식으로 입력하세요.</div>
        <div class="saved-field-label">스케줄 유형</div>
        <div class="chip-row" id="savedTypeChips">
          ${SAVED_TYPE_OPTIONS.map(t => `<button type="button" class="filter-chip" data-stype="${t}">${t}</button>`).join("")}
        </div>
        <div class="saved-field-label">박수 (LAYOV)</div>
        <div class="chip-row" id="savedNightChips">
          ${NIGHTS_OPTIONS.map(o => `<button type="button" class="filter-chip" data-snight="${o.v}">${o.label}</button>`).join("")}
        </div>
        <button type="button" id="savedAddBtn" class="primary-button" style="width:100%;">+ 이 조건으로 알림받기</button>`;
      let picked = new Set(), pickedNights = new Set();
      document.getElementById("savedTypeChips").querySelectorAll("[data-stype]").forEach(b => {
        b.onclick = () => { const t = b.dataset.stype; if (picked.has(t)) { picked.delete(t); b.classList.remove("is-active"); } else { picked.add(t); b.classList.add("is-active"); } };
      });
      document.getElementById("savedNightChips").querySelectorAll("[data-snight]").forEach(b => {
        b.onclick = () => { const t = b.dataset.snight; if (pickedNights.has(t)) { pickedNights.delete(t); b.classList.remove("is-active"); } else { pickedNights.add(t); b.classList.add("is-active"); } };
      });
      document.getElementById('premiumPushEnableBtn')?.addEventListener('click', enablePremiumBackgroundAlerts);
      document.getElementById("savedAddBtn").onclick = async () => {
        const kw = (document.getElementById("savedKeyword").value || "").trim();
        const types = [...picked];
        const nights = [...pickedNights];
        if (!kw && types.length === 0 && nights.length === 0) { showToast("목적지·유형·박수 중 하나 이상 지정해주세요."); return; }
        const nightLabels = nights.map(n => (NIGHTS_OPTIONS.find(o => o.v === n) || {}).label).filter(Boolean);
        const label = [kw, types.join("/"), nightLabels.join("/")].filter(Boolean).join(" · ");
        state.savedSearches.push({ id: "SS-" + Date.now(), label, keyword: kw, types, nights, notified: [], createdAt: new Date().toISOString() });
        saveState();
        const synced = await syncPremiumAlertSettings();
        renderSavedSearches();
        showToast(synced.ok
          ? `🔔 '${label}' PRO 알림 조건이 서버에 저장됐습니다.`
          : `조건은 기기에 저장됐습니다. 서버 동기화는 다시 시도됩니다.`);
      };
    }
  }
  document.getElementById('activateProTrialBtn')?.addEventListener('click', activateProTrialPass);
  document.getElementById('purchaseLifetimeProBtn')?.addEventListener('click', purchaseLifetimePro);
  document.getElementById('restoreLifetimeProBtn')?.addEventListener('click', restoreLifetimePro);
  loadProProductDisplay();

  listEl.querySelectorAll(".saved-del").forEach(b => b.onclick = async () => {
    state.savedSearches = state.savedSearches.filter(s => s.id !== b.dataset.id);
    saveState();
    await syncPremiumAlertSettings();
    renderSavedSearches();
  });
}

const _posterPick = {};
const _compareOwnInspect = {};

// 알림에서 특정 요청만 보고 있을 때, 지금 걸러 보는 중이라는 것과 전체로 돌아가는 길을 안내한다.
function renderRequestFocusBar(shownReqs) {
  const bar = document.getElementById("requestFocusBar");
  const label = document.getElementById("requestFocusLabel");
  if (!bar) return;
  const focusedReq = state.focusedRequestId ? shownReqs.find(r => r.id === state.focusedRequestId) : null;
  if (!focusedReq) { bar.hidden = true; return; }
  const total = (state.requests[state.reqViewMode] || []).length;
  if (label) {
    label.innerHTML = `🔔 알림에서 선택한 <strong>${escapeHtml(focusedReq.postTitle || "요청")}</strong> 1건만 보는 중`
      + (total > 1 ? ` <small>(전체 ${total}건)</small>` : "");
  }
  bar.hidden = false;
}

function renderRequests() {
  const all = state.requests[state.reqViewMode];
  // 알림에서 들어온 경우 그 요청 하나만 보여준다. 목록 전체를 띄우면 최신순 정렬 탓에
  // 다른 요청이 맨 위에 와서, 방금 누른 알림과 다른 내용을 보고 있다고 오해하기 쉽다.
  const focused = state.focusedRequestId
    ? all.filter(r => r.id === state.focusedRequestId)
    : null;
  const reqs = focused && focused.length ? focused : all;
  // 포커스한 요청이 목록에서 사라졌으면(삭제·거절 등) 포커스를 푼다.
  if (state.focusedRequestId && !(focused && focused.length)) state.focusedRequestId = null;
  renderRequestFocusBar(reqs);
  $("#requestList").innerHTML = reqs.length ? reqs.map(r => requestCard(r)).join("") : `<div class="empty-state">${state.reqViewMode==="sent"?"보낸":"받은"} 요청이 없습니다.</div>`;
  $$("#requestList .accept-req-btn").forEach(b => b.onclick = () => acceptRequest(b.dataset.reqId));
  $$("#requestList .ask-accept-btn").forEach(b => b.onclick = () => acceptAsk(b.dataset.reqId));
  $$("#requestList .decline-req-btn").forEach(b => b.onclick = () =>
    declineRequest(b.dataset.reqId, b.dataset.declineReason || null));
  $$("#requestList .delete-req-btn").forEach(b => b.onclick = () => deleteRequest(b.dataset.reqId));
  $$("#requestList .proceed-request-btn").forEach(b => b.onclick = () => proceedToRequestFromAsk(b.dataset.reqId));
  $$("#requestList .submit-nudge-btn").forEach(b => b.onclick = () => nudgeSubmit(b.dataset.reqId));
  $$("#requestList .submit-done-btn").forEach(b => b.onclick = () => markSubmitDone(b.dataset.reqId));
  // 내 달력 날짜는 교환 선택과 무관하게 세부 일정만 확인한다.
  $$("#requestList .cmp-own-cell.has-own").forEach(b => b.onclick = () => {
    const reqId = b.dataset.req, day = parseInt(b.dataset.day, 10);
    const isClosing = _compareOwnInspect[reqId] === day;
    _compareOwnInspect[reqId] = isClosing ? null : day;
    $$("#requestList .cmp-own-cell.has-own").forEach(cell => {
      if (cell.dataset.req === reqId) {
        const isInspected = !isClosing && Number(cell.dataset.day) === day;
        cell.classList.toggle("is-inspected", isInspected);
        cell.setAttribute("aria-pressed", String(isInspected));
      }
    });
    updateCompareOwnDetail(reqId);
  });
  // 열린 로스터 달력 날짜 선택 (글작성자가 바꿀 날 고르기 + 세부 일정 표시)
  $$("#requestList .cmp-cell.has-req:not(:disabled)").forEach(b => b.onclick = () => {
    const reqId = b.dataset.req, day = parseInt(b.dataset.day, 10);
    if (!_posterPick[reqId]) _posterPick[reqId] = new Set();
    const set = _posterPick[reqId];
    const isDeselecting = set.has(day);
    if (isDeselecting) set.delete(day);
    else set.add(day);
    b.classList.toggle("is-picked", !isDeselecting);
    b.setAttribute("aria-pressed", String(!isDeselecting));
    updateCompareRequestDetail(reqId);
    updatePosterPickMsg(reqId);
  });
  $$("#requestList .poster-select-btn").forEach(b => b.onclick = () => posterSelectDays(b.dataset.reqId));
  $$("#requestList .requester-approve-btn").forEach(b => b.onclick = () => approvePosterSelection(b.dataset.reqId));
  $$("#requestList .requester-repick-btn").forEach(b => b.onclick = () => rejectPosterSelection(b.dataset.reqId));
  // 25초 폴링으로 카드가 다시 그려져도 선택 조합과 규정 판정 문구를 복원한다.
  // 고정 모기지 충돌은 날짜를 고르기 전부터 안내해야 하므로 열린 요청은 모두 갱신한다.
  reqs.forEach(r => {
    if (document.getElementById(`rosterMsg-${r.id}`)) updatePosterPickMsg(r.id);
  });
}

function compareScheduleDetailHtml(schedule, month) {
  if (!schedule) return "";
  const monthNumber = parseInt((schedule.month || month || state.currentMonth).split("-")[1], 10);
  const title = schedule.title && schedule.title !== "-" ? schedule.title : schedule.type;
  let route = schedule.routeSummary || "";
  if (!route && schedule.type === "ARRIVAL" && schedule.arrivalAirport) route = `${schedule.arrivalAirport} 도착`;
  if (!route && schedule.layoverAirport) route = `${schedule.layoverAirport} 체류`;
  if (!route && schedule.dep && schedule.arr) route = `${schedule.dep} → ${schedule.arr}`;
  const times = [
    schedule.reportTime ? `<span><small>Check-in</small><b>${escapeHtml(schedule.reportTime)}</b></span>` : "",
    schedule.arrivalTime ? `<span><small>도착</small><b>${escapeHtml(schedule.arrivalTime)}</b></span>` : "",
    schedule.releaseTime ? `<span><small>Check-out</small><b>${escapeHtml(schedule.releaseTime)}</b></span>` : "",
  ].filter(Boolean).join("");
  return `<article class="cmp-detail-card">
    <div class="cmp-detail-head">
      <strong>${monthNumber}/${schedule.day} · ${escapeHtml(schedule.type || "일정")}</strong>
      <b>${escapeHtml(title || "일정")}</b>
    </div>
    ${route ? `<p>${escapeHtml(route)}</p>` : ""}
    ${times ? `<div class="cmp-detail-times">${times}</div>` : ""}
  </article>`;
}

function updateCompareOwnDetail(reqId) {
  const request = (state.requests.received || []).find(item => item.id === reqId);
  const panel = document.getElementById(`cmpOwnDetail-${reqId}`);
  if (!request || !panel) return;
  const month = (request.openRoster?.[0] && request.openRoster[0].month) || state.currentMonth;
  const day = _compareOwnInspect[reqId];
  const schedule = state.schedules.find(item =>
    item.day === day && (item.month || state.currentMonth) === month);
  panel.innerHTML = compareScheduleDetailHtml(schedule, month);
  panel.hidden = !schedule;
}

function updateCompareRequestDetail(reqId) {
  const request = (state.requests.received || []).find(item => item.id === reqId);
  const panel = document.getElementById(`cmpRequestDetail-${reqId}`);
  if (!request || !panel) return;
  const picked = _posterPick[reqId] || new Set();
  const schedules = (request.openRoster || [])
    .filter(item => picked.has(item.day))
    .sort((a, b) => a.day - b.day);
  panel.innerHTML = schedules.map(item => compareScheduleDetailHtml(item, item.month)).join("");
  panel.hidden = schedules.length === 0;
}

// 같은 달을 기준으로 내 로스터와 상대의 공개 로스터를 나란히 렌더한다.
function renderCompareCalendar(r) {
  const roster = r.openRoster || [];
  window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(roster);
  const month = (roster[0] && roster[0].month) || state.currentMonth;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 월=0
  const openByDay = {}; roster.forEach(s => { openByDay[s.day] = s; });
  const lockedDays = new Set(r.lockedDays || []);
  const picked = _posterPick[r.id] || new Set();
  const myPost = (state.myPosts || []).find(p => p.id === r.postId);
  const fixedMogijiViolation = requesterFixedMogijiViolation(r, myPost);
  if (fixedMogijiViolation && picked.size) picked.clear();
  const postedDays = new Set(myPost?.offered?.days || []);
  const inspectedOwnDay = _compareOwnInspect[r.id];
  const dutyShort = t => t === "OFF" ? "OFF" : t === "국내선" ? "국내" : t === "국제선" ? "국제" : t === "GND" ? "지상/훈련" : t;
  const weekday = `<div class="cmp-weekdays"><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span><span>일</span></div>`;
  let myCells = "";
  let requestCells = "";
  for (let i = 0; i < offset; i++) {
    myCells += `<div class="cmp-cell empty"></div>`;
    requestCells += `<div class="cmp-cell empty"></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const req = openByDay[d];
    const mine = state.schedules.find(s => s.day === d && (s.month || state.currentMonth) === month);
    const isPosted = postedDays.has(d);
    const ownClass = `${isPosted ? " is-posted" : ""}${inspectedOwnDay === d ? " is-inspected" : ""}`;
    myCells += mine ? `<button type="button" class="cmp-cell cmp-own-cell has-own${ownClass}" data-req="${r.id}" data-day="${d}" aria-pressed="${inspectedOwnDay === d}">
      <span class="cmp-day">${d}</span>
      <span class="cmp-own-duty">${escapeHtml(dutyShort(mine.type))}</span>
      ${mine.routeSummary ? `<em>${escapeHtml(mine.routeSummary)}</em>` : ""}
      ${mine.aircraft ? `<span class="cmp-ac">✈ ${aircraftLabel(mine.aircraft)}</span>` : ""}
      ${isPosted ? `<small>내가 내놓음</small>` : ""}
    </button>` : `<div class="cmp-cell cmp-own-cell"><span class="cmp-day">${d}</span></div>`;
    if (req) {
      const on = picked.has(d) ? " is-picked" : "";
      const route = req.routeSummary && req.routeSummary !== req.type ? `<em>${escapeHtml(req.routeSummary)}</em>` : "";
      requestCells += `<button type="button" class="cmp-cell cmp-request-cell has-req${on}${fixedMogijiViolation ? " is-swap-blocked" : ""}" data-req="${r.id}" data-day="${d}" aria-pressed="${picked.has(d)}"${fixedMogijiViolation ? ' disabled aria-disabled="true" title="내가 내놓은 근무가 상대방의 필수 모기지 휴무와 겹칩니다."' : ""}>
        <span class="cmp-day">${d}</span>
        <span class="cmp-take">${escapeHtml(dutyShort(req.type))}${route}</span>
        ${req.aircraft ? `<span class="cmp-ac">✈ ${aircraftLabel(req.aircraft)}</span>` : ""}
      </button>`;
    } else {
      const locked = lockedDays.has(d);
      requestCells += `<div class="cmp-cell cmp-request-cell is-closed${locked ? " is-locked" : ""}"><span class="cmp-day muted">${d}</span>${locked ? `<small>🔒 비공개</small>` : ""}</div>`;
    }
  }
  return `<div class="compare-month-head"><strong>${y}년 ${m}월</strong><span>두 달력은 같은 날짜 기준입니다</span></div>
  <div class="compare-calendars">
    <section class="cmp-cal cmp-own-cal">
      <h5><span class="cmp-owner-dot mine"></span> 내 스케줄</h5>
      <p>주황색은 내가 스왑 글에 올린 근무입니다.</p>
      ${weekday}
      <div class="cmp-grid">${myCells}</div>
      <div id="cmpOwnDetail-${r.id}" class="cmp-detail-panel" ${inspectedOwnDay ? "" : "hidden"}>
        ${compareScheduleDetailHtml(state.schedules.find(item => item.day === inspectedOwnDay && (item.month || state.currentMonth) === month), month)}
      </div>
    </section>
    <section class="cmp-cal cmp-request-cal">
      <h5><span class="cmp-owner-dot take"></span> 상대가 공개한 스케줄</h5>
      <p>${fixedMogijiViolation ? "내가 내놓은 근무가 상대방의 필수 휴무와 겹쳐 선택할 수 없습니다." : "교환받고 싶은 날짜를 누르세요."}</p>
      ${weekday}
      <div class="cmp-grid">${requestCells}</div>
      <div id="cmpRequestDetail-${r.id}" class="cmp-detail-panel" ${picked.size ? "" : "hidden"}>
        ${roster.filter(item => picked.has(item.day)).sort((a, b) => a.day - b.day).map(item => compareScheduleDetailHtml(item, month)).join("")}
      </div>
    </section>
  </div>`;
}

// 글작성자가 고른 날짜 → 휴식검증 미리보기 메세지
function schedulesOfferedByPost(post) {
  if (!post?.offered) return [];
  if (Array.isArray(post.offered.daySchedules) && post.offered.daySchedules.length) {
    return post.offered.daySchedules;
  }
  const keys = Array.isArray(post.offered.dateKeys) && post.offered.dateKeys.length
    ? post.offered.dateKeys
    : (post.offered.days || []).map(day =>
        dayKey(day, post.offered.startDate?.slice(0, 7) || post.deadlineMonth || state.currentMonth));
  return keys.map(key => {
    const { day, month } = parseDayKey(key);
    return state.schedules.find(schedule =>
      schedule.day === day && (schedule.month || state.currentMonth) === month);
  }).filter(Boolean);
}

function protectedMogijiIssueMessage(issue, ownerLabel) {
  if (!issue) return null;
  const restDate = issue.dayKey.split("-").slice(1).map(Number);
  const arrivalDate = issue.arrivalDate.split("-").slice(1).map(Number);
  return `❌ ${ownerLabel} ${restDate[0]}월 ${restDate[1]}일은 ${arrivalDate[0]}월 ${arrivalDate[1]}일 모기지 도착 후 필요한 휴식일입니다. 이 교환으로 근무가 들어가 규정에 맞지 않습니다.`;
}

function requesterFixedMogijiViolation(request, myPost) {
  const policy = window.CrewSwapMogijiPolicy;
  if (!policy || !request || state.user.crewType !== "PILOT") return null;
  const post = myPost || (state.myPosts || []).find(item => item.id === request.postId);
  if (post?.crewType === "CABIN") return null;
  return policy.findProtectedRestViolation(
    request.openRoster || [],
    schedulesOfferedByPost(post),
  );
}

function requesterFixedMogijiMessage(issue) {
  if (!issue) return null;
  const restDate = issue.dayKey.split("-").slice(1).map(Number);
  const arrivalDate = issue.arrivalDate.split("-").slice(1).map(Number);
  const incomingMonth = issue.incoming?.month || issue.dayKey.slice(0, 7);
  const incomingDate = issue.incoming
    ? `${parseInt(incomingMonth.split("-")[1], 10)}월 ${issue.incoming.day}일`
    : `${restDate[0]}월 ${restDate[1]}일`;
  const incomingDuty = issue.incoming?.title || issue.incoming?.type || "근무";
  return `❌ 상대방은 ${arrivalDate[0]}월 ${arrivalDate[1]}일 모기지 도착 후 ${restDate[0]}월 ${restDate[1]}일이 필수 휴무이지만, 내가 내놓은 ${incomingDate} ${escapeHtml(incomingDuty)} 근무를 받게 됩니다.<br><strong>따라서 상대 달력에서 다른 날짜를 선택해도 이 요청자와는 교환할 수 없습니다.</strong>`;
}

function cabinRestIssueMessage(issue, ownerLabel) {
  if (!issue) return null;
  return `❌ ${ownerLabel} 객실 휴식시간 부족 — ${issue.routeKey} 기준 실제 ${fmtDur(Math.max(0, issue.gapMinutes))} · 최소 ${fmtDur(issue.requiredMinutes)} 필요`;
}

function posterPickRestCheck(reqId) {
  const r = (state.requests.received || []).find(x => x.id === reqId);
  if (!r) return { offered: null, msg: null, fixed: false };
  const myPost = (state.myPosts || []).find(p => p.id === r.postId);
  const fixedViolation = requesterFixedMogijiViolation(r, myPost);
  if (fixedViolation) {
    return { offered: null, msg: requesterFixedMogijiMessage(fixedViolation), fixed: true };
  }
  const days = [...(_posterPick[reqId] || [])];
  if (!days.length) return { offered: null, msg: null, fixed: false };
  const entries = (r.openRoster || []).filter(s => days.includes(s.day));
  const offered = offeredFromRosterDays(entries);
  const givenDays = myPost ? (myPost.offered.days || []) : [];
  if (state.user.crewType === "CABIN") {
    const cabinPolicy = window.CrewSwapCabinPolicy;
    const myPostSchedules = schedulesOfferedByPost(myPost);
    const requesterViolation = cabinPolicy?.findRestViolation(
      r.openRoster || [],
      entries,
      myPostSchedules,
    );
    const posterViolation = cabinPolicy?.findRestViolation(
      state.schedules,
      myPostSchedules,
      entries,
    );
    return {
      offered,
      msg: cabinRestIssueMessage(requesterViolation, "상대 일정") ||
        cabinRestIssueMessage(posterViolation, "내 일정"),
      fixed: false,
    };
  }
  const policy = window.CrewSwapMogijiPolicy;
  const myIncomingViolation = policy?.findProtectedRestViolation(state.schedules, entries);
  const msg =
    protectedMogijiIssueMessage(myIncomingViolation, "내 일정에서") ||
    restIssueMessage(restCheckIncoming(offered, givenDays)) ||
    mogijiIssueMessage(mogijiRestCheckIncoming(offered, givenDays));
  return { offered, msg, fixed: false };
}
function updatePosterPickMsg(reqId) {
  const el = document.getElementById(`rosterMsg-${reqId}`);
  if (!el) return;
  const { offered, msg, fixed } = posterPickRestCheck(reqId);
  if (fixed) {
    if (_posterPick[reqId]) _posterPick[reqId].clear();
    el.classList.add("is-blocked");
    el.innerHTML = msg;
    return;
  }
  el.classList.remove("is-blocked");
  if (!offered) {
    el.innerHTML = `<span>상대 달력에서 받을 근무를 선택하면 교환 내용이 여기에 표시됩니다.</span>`;
    return;
  }
  const r = (state.requests.received || []).find(x => x.id === reqId);
  const myPost = (state.myPosts || []).find(p => p.id === r?.postId);
  const exchange = `<div class="compare-exchange-summary">
    <span><small>내가 줄 근무</small><strong>${escapeHtml(myPost?.offered?.patternName || r?.postTitle || "-")}</strong></span>
    <b>⇄</b>
    <span><small>상대에게 받을 근무</small><strong>${escapeHtml(offered.patternName || "-")}</strong></span>
  </div>`;
  if (msg) { el.innerHTML = `<span style="color:#c53030;">${msg}<br><small>선택한 날짜 조합이 휴식 기준에 맞지 않습니다. 다른 날을 고르세요.</small></span>`; }
  else { el.innerHTML = `${exchange}<span style="color:#1a7a3f;">✓ ${offered.days.map(d=>d+"일").join(", ")} 선택됨 — 휴식 기준 통과</span>`; }
}

async function posterSelectDays(reqId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  const r = (state.requests.received || []).find(x => x.id === reqId);
  if (!r) return;
  const { offered, msg, fixed } = posterPickRestCheck(reqId);
  if (fixed) { showToast("내가 내놓은 근무가 상대방의 필수 모기지 휴무와 겹쳐 이 요청자와는 교환할 수 없습니다."); return; }
  if (!offered) { showToast("바꿀 날을 하나 이상 선택하세요."); return; }
  if (msg) { showToast("휴식 기준 위반 — 다른 날을 선택하세요."); return; }
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-poster-select`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email, offered, realName: state.user.realName || "", employeeId: state.user.employeeId || "", phone: state.user.phone || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "확정 실패 — 다시 시도해주세요."); return; }
  } catch (e) { showToast("확정 실패 — 네트워크 오류"); return; }
  delete _posterPick[reqId];
  showToast("선택한 일정으로 최종 승인을 요청했습니다.");
  fetchRequests();
}

async function approvePosterSelection(reqId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  if (!confirm("상대가 선택한 일정으로 스왑을 최종 승인할까요? 승인 후 서로의 연락처가 공개됩니다.")) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-requester-accept`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reqId, email: state.user.email,
        realName: state.user.realName || "", employeeId: state.user.employeeId || "", phone: state.user.phone || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "최종 승인 실패 — 다시 시도해주세요."); return; }
  } catch (e) { showToast("최종 승인 실패 — 네트워크 오류"); return; }
  recordSwapMatch();
  showToast("상호 수락 완료 — 회사 상신 단계로 진행하세요.");
  fetchRequests();
}

async function rejectPosterSelection(reqId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  if (!confirm("이 조합은 거절하고 상대에게 다른 날짜를 골라달라고 할까요?")) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-requester-decline`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "처리 실패 — 다시 시도해주세요."); return; }
  } catch (e) { showToast("처리 실패 — 네트워크 오류"); return; }
  showToast("상대에게 다른 날짜를 선택해달라고 전달했습니다.");
  fetchRequests();
}

// 요청자 → 글작성자에게 회사 상신 확인 메세지
async function nudgeSubmit(reqId) {
  if (!state.user.email) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-submit-nudge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "전송 실패"); return; }
    showToast("🔔 상신 확인 메세지를 보냈습니다.");
    fetchRequests();
  } catch (e) { showToast("전송 실패 — 네트워크 오류"); }
}

// 글작성자가 회사 상신 완료 표시 → 상대에게 알림
async function markSubmitDone(reqId) {
  if (!state.user.email) return;
  if (!confirm("회사에 상신을 완료하셨나요? 완료로 표시하면 상대방에게 알림이 전송됩니다.")) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-submit-done`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "처리 실패"); return; }
    showToast("✅ 회사 상신 완료로 표시했습니다.");
    fetchRequests();
  } catch (e) { showToast("처리 실패 — 네트워크 오류"); }
}

// 상대가 내 양도 의향을 수락했을 때 — 다시 스케줄 고를 필요 없이 바로 정식 요청 모달로
async function proceedToRequestFromAsk(reqId) {
  const r = (state.requests.sent || []).find(x => x.id === reqId);
  if (!r || !r.offered) { showToast("의향 정보를 찾을 수 없습니다."); return; }
  if (!CREDIT_POLICY.canSpend(state, 1, isPremiumUser())) { showToast("크레딧이 부족합니다 — 다음 달 기본 크레딧 또는 PRO를 이용해주세요."); return; }
  let post = state.posts.find(p => p.id === r.postId);
  if (!post) { await fetchPosts(); post = state.posts.find(p => p.id === r.postId); }
  if (!post) { showToast("상대 글이 마감되었거나 삭제되었습니다."); return; }
  // 내가 의향 표시했던 근무를 로스터에서 다시 선택
  const days = r.offered.days || [];
  beginScheduleSelection("request");
  state.schedules.forEach(s => {
    if (days.includes(s.day) && scheduleInCurrentMonth(s)) state.selectedDays.add(dayKey(s.day, s.month));
  });
  if (state.selectedDays.size === 0) {
    showToast("의향 표시했던 근무를 현재 로스터에서 찾지 못했습니다. 요청하기에서 직접 선택해주세요.");
    switchTab("find");
    return;
  }
  renderCalendar();
  renderSelection();
  openRequestModal(r.postId, r.offered);
}

// 받은 의향 문의에 "관심 수락" — 자유 텍스트 답장 없이 구조화된 응답만 허용
async function acceptAsk(reqId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-ask-accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email, realName: state.user.realName || "", employeeId: state.user.employeeId || "", phone: state.user.phone || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "처리 실패 — 다시 시도해주세요."); return; }
  } catch (e) { showToast("처리 실패 — 네트워크 오류"); return; }
  fetchRequests();
  showToast("💬 관심을 수락했습니다 — 상대가 정식 요청을 보낼 수 있습니다.");
}

// 거절 — 일반 개인 사유와 서버가 검증한 휴식 규정 불일치를 구분해 상대에게 전달한다.
async function declineRequest(reqId, reason = null) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  const isMogijiConflict = reason === "MOGIJI_REST_CONFLICT";
  const confirmMessage = isMogijiConflict
    ? "모기지 휴무 규정 불일치로 거절할까요? 상대방에게 자동 판정 사유가 전달됩니다."
    : "거절할까요? 상대방에게 개인 사정으로 인한 양해 메세지가 전송됩니다.";
  if (!confirm(confirmMessage)) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-decline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "거절 처리 실패"); return; }
  } catch (e) { showToast("거절 실패 — 네트워크 오류"); return; }
  state.requests.received = state.requests.received.filter(r => r.id !== reqId);
  renderRequests();
  showToast(isMogijiConflict
    ? "규정 불일치로 거절했습니다. 상대방에게 자동 판정 사유가 전달되었습니다."
    : "거절했습니다. 상대방에게 양해 메세지가 전송되었습니다.");
}

async function deleteRequest(reqId, confirmMsg) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  if (!confirm(confirmMsg || "이 요청/의향을 삭제할까요? 상대방 화면에서도 사라집니다.")) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "삭제 실패"); return; }
  } catch (e) { showToast("삭제 실패 — 네트워크 오류"); return; }
  state.requests.sent = state.requests.sent.filter(r => r.id !== reqId);
  state.requests.received = state.requests.received.filter(r => r.id !== reqId);
  renderRequests();
  showToast("삭제했습니다.");
}

function requestCard(r) {
  const newStage = r.stage >= 4 ? 3 : r.stage >= 3 ? 2 : 1;
  const badgeCls = newStage >= 2 ? "accepted" : "";
  const accepted = newStage >= 2;
  const isAsk = r.type === "ask";
  const isSentV = state.reqViewMode === "sent";
  // 새 모델: 요청자가 로스터만 열고 offered 미확정 → 받는 사람(글작성자)이 날짜를 골라야 함
  const isOpenPending = !r.declined && state.reqViewMode === "received" && !r.offered && Array.isArray(r.openRoster) && r.openRoster.length > 0;
  const fixedMogijiViolation = isOpenPending ? requesterFixedMogijiViolation(r) : null;
  const isWaitingSent = !r.declined && isSentV && !r.offered && Array.isArray(r.openRoster) && r.openRoster.length > 0;
  const needsRequesterApproval = !r.declined && isSentV && !!r.posterSelected && !!r.offered && (r.stage || 1) < 3;
  const posterWaitingApproval = !r.declined && state.reqViewMode === "received" && !!r.posterSelected && !!r.offered && (r.stage || 1) < 3;
  // 구버전(offered 즉시 첨부) 수락 버튼 경로 — offered가 있을 때만
  const needsResponse = !r.declined && state.reqViewMode === "received" && !!r.offered && !r.posterSelected && (isAsk ? !r.askAccepted : !accepted);

  // 휴식시간(FOM) + 모기지 휴식일수(노조 협약) 검증 — 받은 정식 요청을 수락하면 내가 r.offered(요청자 근무)를 받게 됨.
  // 내가 내주는 날 = 내 포스트의 days. 상호수락(=내 로스터에 편입) 후 확인.
  let restMsgReceived = null;
  if (state.reqViewMode === "received" && !isAsk && needsResponse && r.offered) {
    const myPost = (state.myPosts || []).find(p => p.id === r.postId);
    const givenDays = myPost ? (myPost.offered.days || []) : [];
    const rc = restCheckIncoming(r.offered, givenDays);
    const mc = mogijiRestCheckIncoming(r.offered, givenDays);
    restMsgReceived = restIssueMessage(rc) || mogijiIssueMessage(mc);
  }

  // 상호 수락 후 공개할 상대방 연락처
  // received: 상대 = fromRealName/fromEmployeeId/fromPhone
  // sent: 상대 = toRealName/toEmployeeId/toPhone
  const isSent = state.reqViewMode === "sent";
  const otherName = accepted ? (isSent ? r.toRealName : r.fromRealName) : "";
  const otherEmpId = accepted ? (isSent ? r.toEmployeeId : r.fromEmployeeId) : "";
  const otherPhone = accepted ? (isSent ? r.toPhone : r.fromPhone) : "";
  const contactLine = accepted
    ? (otherName || otherEmpId || otherPhone
        ? `${otherName || "미입력"} · ${otherEmpId || "미입력"} · ${otherPhone || "미입력"}`
        : "상대방이 아직 연락처를 등록하지 않았습니다")
    : null;

  const targetPost = (state.myPosts || []).find(post => post.id === r.postId) ||
    (state.posts || []).find(post => post.id === r.postId);
  const targetOffer = r.postOffered || targetPost?.offered || null;
  const targetTitle = targetOffer?.patternName || r.postTitle || "-";
  const targetDetailRows = (() => {
    const schedules = Array.isArray(targetOffer?.daySchedules) ? targetOffer.daySchedules : [];
    const rows = schedules.map(schedule => {
      const title = schedule.title && schedule.title !== schedule.type ? schedule.title : "";
      const route = schedule.routeSummary || (schedule.dep && schedule.arr ? `${schedule.dep}→${schedule.arr}` : "");
      const times = [
        schedule.reportTime ? `Check-in ${schedule.reportTime}` : "",
        schedule.releaseTime ? `Check-out ${schedule.releaseTime}` : "",
      ].filter(Boolean).join(" · ");
      return [title, route, times].filter(Boolean).join(" · ");
    }).filter(Boolean);
    if (rows.length) return rows;
    return [targetOffer?.summary || targetOffer?.type || ""].filter(Boolean);
  })();
  const targetDetailsHtml = targetDetailRows
    .map(detail => `<small class="req-ex-duty">${escapeHtml(detail)}</small>`)
    .join("");

  return `
    <article class="request-card" data-req-card-id="${escapeHtml(r.id || "")}">
      <div class="card-head">
        <div>
          <h3>${r.postTitle}</h3>
          <p>${isSent?"내가 보냄":"내가 받음"} · ${r.sentAgo}</p>
        </div>
        <span class="badge ${badgeCls}">${r.status || (isOpenPending ? "바꿀 날 고르기" : isWaitingSent ? "상대가 고르는 중" : needsRequesterApproval ? "내 최종 승인 필요" : "진행 중")}</span>
      </div>
      ${!r.declined && r.message ? `<div class="notice" style="margin-bottom:10px;">💬 ${escapeHtml(r.message)}</div>` : ""}
      ${r.declined && r.declineMsg ? `<div class="notice" style="margin-bottom:10px;border-color:#e53e3e;background:#fff5f5;">${r.declineReason === "MOGIJI_REST_CONFLICT" ? "⚠️" : "💔"} ${escapeHtml(r.declineMsg)}</div>` : ""}
      ${!r.declined && r.offered ? `<div class="req-exchange">
        <div class="req-ex-side"><span>${!isSent?"상대가 줄 근무":"내가 줄 근무"}</span><strong>${r.offered.patternName}</strong><small>${r.offered.summary || r.offered.type || ""}</small></div>
        <div class="req-ex-arrow">⇄</div>
        <div class="req-ex-side"><span>${!isSent?"내가 줄 근무":"상대가 줄 근무"}</span><strong>${escapeHtml(targetTitle)}</strong>${targetDetailsHtml}</div>
      </div>` : ""}
      ${isOpenPending ? `
      <div class="open-roster-pick">
        <h4>📅 내 일정과 상대 일정을 같은 화면에서 비교하세요</h4>
        <p class="cmp-legend">왼쪽(모바일에서는 위)은 내 일정, 오른쪽(아래)은 상대가 공개한 일정입니다.</p>
        ${renderCompareCalendar(r)}
        <div class="roster-pick-msg" id="rosterMsg-${r.id}">상대 달력에서 받을 근무를 선택하면 교환 내용이 여기에 표시됩니다.</div>
      </div>` : ""}
      ${isWaitingSent ? `<div class="notice" style="margin-bottom:10px;">⏳ 내 스케줄을 열어 보냈습니다. 상대(글 작성자)가 바꿀 날을 고르는 중입니다.${(r.lockedDays && r.lockedDays.length) ? ` (🔒 ${r.lockedDays.length}일 잠금 제외)` : ""}</div>` : ""}
      ${needsRequesterApproval ? `<div class="approval-notice">🔔 글 작성자가 위 일정을 선택했습니다. 교환 내용을 확인하고 최종 승인해주세요.</div>` : ""}
      ${posterWaitingApproval ? `<div class="approval-notice waiting">⏳ 선택한 일정을 상대에게 보냈습니다. 상대의 최종 승인을 기다리는 중입니다.</div>` : ""}
      ${!r.declined ? `<div class="disclosed-info">
        <h4>공개 정보</h4>
        <div class="info-row"><span>직책/등급</span><strong>${(() => { const rc = r.postOwnerRole || r.requesterRole; return ROLE_LABELS[rc] || CABIN_ROLE_LABELS[rc] || rc || "-"; })()}</strong></div>
        <div class="info-row"><span>기종/자격</span><strong>${r.aircraft} / ${r.quals}</strong></div>
        <div class="info-row"><span>베이스</span><strong>${r.base && r.base !== "비공개" ? r.base : "GMP"}</strong></div>
        <div class="info-row"><span>닉네임</span><strong>${r.nickname && r.nickname !== "비공개" ? r.nickname : "(상대 닉네임)"}</strong></div>
        <div class="info-row"><span>실명/사번/연락처</span><strong class="${!accepted?"locked":""}">${accepted ? `✓ ${contactLine}` : "🔒 상호 수락 후 공개"}</strong></div>
        ${!isAsk ? `<div class="info-row"><span>편조구성원</span><strong class="${!accepted && !r.postCrewPublic?"locked":""}">${r.postCrewPublic ? `✓ ${escapeHtml(r.postCrewPublic)}` : (accepted ? "정보 없음" : "🔒 상호 수락 후 공개 (PRO는 스왑 목록에서 미리 확인 가능)")}</strong></div>` : ""}
      </div>` : ""}
      ${r.declined
        ? `<div class="decline-closed-note">${r.declineReason === "MOGIJI_REST_CONFLICT"
            ? "이 요청은 모기지 휴무 규정 불일치로 종료되었습니다."
            : "이 요청은 거절되어 종료되었습니다."}</div>`
        : accepted ? (() => {
        const rules = currentRules();
        const menu = rules.submitMenu || "회사 시스템 → 스케줄 변경 신청";
        const contact = rules.submitContact || "회사 운항편조팀";
        const deadline = rules.deadline
          ? `변경 시작일의 ${rules.deadline.businessDays}영업일 전 ${rules.deadline.hour || 17}시까지`
          : "회사 마감 시각까지";
        // 회사 상신 주체 = 글을 올린 사람(포스트 작성자). received 뷰 = 내가 작성자.
        const iAmPoster = !isSent;
        const myId = state.user.nickname || "나";
        const submitted = !!r.submitted;
        const submitterBanner = iAmPoster
          ? `<div class="submit-owner me">📮 회사 상신은 <strong>${escapeHtml(myId)}(글 작성자)</strong>님이 진행합니다.</div>`
          : `<div class="submit-owner other">📮 회사 상신은 <strong>글 작성자(${r.nickname && r.nickname !== "비공개" ? escapeHtml(r.nickname) : "상대"})</strong>가 진행합니다. 상대의 상신 완료를 기다려 주세요.</div>`;
        // 상신 진행 상태 + 독촉/완료 버튼
        let submitAction = "";
        if (submitted) {
          submitAction = iAmPoster
            ? `<div class="submit-status done">✅ 회사 상신 완료 표시함 — 상대에게 알림이 전송되었습니다.</div>`
            : `<div class="submit-status done">✅ 글 작성자가 회사 상신을 완료했습니다.</div>`;
        } else if (iAmPoster) {
          const nudged = r.submitNudgeCount ? `<div class="submit-status nudged">🔔 상대가 회사 상신 여부를 확인하고 있습니다 (${r.submitNudgeCount}회).</div>` : "";
          submitAction = `${nudged}<button class="primary-button submit-done-btn" data-req-id="${r.id}" style="width:100%;margin-top:8px;">✅ 회사 상신 완료로 표시</button>`;
        } else {
          submitAction = `<button class="secondary-button submit-nudge-btn" data-req-id="${r.id}" style="width:100%;margin-top:8px;">📩 상신 확인 메세지 보내기</button>`;
        }
        return `
        <div class="submit-guide">
          <h4>📋 회사 상신 방법 (${rules.label || "회사 시스템"})</h4>
          ${submitterBanner}
          <ol>
            <li><strong>${menu}</strong> 메뉴 접속</li>
            <li>본인과 상대방 정보, 변경 일자/패턴 입력</li>
            <li><strong>${deadline}</strong> 회사 근무교환 신청서 작성·제출</li>
            <li>승인/반려 여부는 회사 시스템 알림으로 확인</li>
          </ol>
          <p class="hint">📞 문의: ${contact}</p>
          ${submitAction}
        </div>`;
      })() : `
        <p class="hint">실제 SWAP 가능 여부는 상호 수락 후 회사 J-CREW 시스템 신청을 통해 최종 확정됩니다.</p>
      `}
      ${restMsgReceived ? `<div class="notice" style="margin-top:10px;border-color:#e53e3e;background:#fff5f5;color:#c53030;">${restMsgReceived}<br><small>수락 시 휴식시간 기준 위반 — 회사 신청이 반려될 수 있습니다.</small></div>` : ""}
      ${isOpenPending
        ? `<div class="req-respond-buttons">
             <button class="secondary-button decline-req-btn" data-req-id="${r.id}"${fixedMogijiViolation ? ' data-decline-reason="MOGIJI_REST_CONFLICT"' : ""}>${fixedMogijiViolation ? "규정 불일치로 거절" : "거절"}</button>
             <button class="primary-button poster-select-btn" data-req-id="${r.id}"${fixedMogijiViolation ? " disabled" : ""}>${fixedMogijiViolation ? "필수 휴무 충돌 · 교환 불가" : "이 일정으로 승인 요청"}</button>
           </div>`
        : ""}
      ${needsRequesterApproval
        ? `<div class="req-respond-buttons">
             <button class="secondary-button requester-repick-btn" data-req-id="${r.id}">다른 날짜 요청</button>
             <button class="primary-button requester-approve-btn" data-req-id="${r.id}">✓ 최종 승인</button>
           </div>`
        : ""}
      ${needsResponse
        ? `<div class="req-respond-buttons">
             <button class="secondary-button decline-req-btn" data-req-id="${r.id}">거절</button>
             <button class="primary-button ${isAsk ? "ask-accept-btn" : "accept-req-btn"}" data-req-id="${r.id}"${restMsgReceived ? " disabled" : ""}>${isAsk ? "✓ 관심 수락" : "✓ 상호 수락하기"}</button>
           </div>`
        : ""}
      ${isSent && isAsk && r.askAccepted ? `<button class="primary-button proceed-request-btn" data-req-id="${r.id}" style="width:100%;margin-top:10px;">➡ 바로 요청하기 (정식 스왑 요청)</button>` : ""}
      <button class="link-button danger delete-req-btn" data-req-id="${r.id}">🗑 삭제</button>
    </article>
  `;
}

async function acceptRequest(reqId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  try {
    const res = await apiFetch(`${API_BASE}/api/requests-accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email, realName: state.user.realName || "", employeeId: state.user.employeeId || "", phone: state.user.phone || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "수락 실패 — 다시 시도해주세요."); return; }
  } catch (e) { showToast("수락 실패 — 네트워크 오류"); return; }
  recordSwapMatch();
  showToast("상호 수락 완료 — 회사 상신 단계로 진행하세요.");
  fetchRequests();
}

function alertTimeAgo(a) {
  if (a.date) return `📅 ${a.date}`;   // 공지 등 게시 날짜가 명시된 경우 날짜 표시
  if (!a.createdAt) return a.time || "방금";
  const mins = Math.max(0, Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000));
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 1440) return `${Math.round(mins / 60)}시간 전`;
  return `${Math.round(mins / 1440)}일 전`;
}

// 앱 아이콘 배지 — 미확인 알림(공지 제외) 수를 iOS/Android 아이콘 숫자로 표시.
// 네이티브(Capacitor)에서만 동작하며, 앱이 실행/폴링 중일 때 갱신됨.
// 배지·벨에 표시할 미읽음 알림 수 (공지 제외). 클릭해서 전체 내용을 확인하면 read=true.
function appBadgeCount() {
  return (state.alerts || []).filter(a => a.kind !== "announce" && !a.read).length;
}

// 알림을 읽음 처리 (배지 숫자 감소). 이미 읽음이면 무시.
function markAlertRead(a) {
  if (!a || a.read) return;
  a.read = true;
  saveState();
  updateBellBadge();
  updateAppBadge();
}
// 벨을 열면 '확인'으로 간주 — 공지 제외 모든 알림을 읽음 처리해 배지를 지운다.
// (기존에는 개별 항목을 탭해야만 읽음 처리돼, 벨만 열면 배지가 안 사라졌음)
function markAllAlertsRead() {
  let changed = false;
  (state.alerts || []).forEach(a => {
    if (a.kind !== "announce" && !a.read) { a.read = true; changed = true; }
  });
  if (changed) saveState();
  updateBellBadge();
  updateAppBadge();
}
async function updateAppBadge() {
  try {
    const Badge = window.Capacitor?.Plugins?.Badge;
    if (!Badge) return; // 웹 프리뷰 등 미지원 환경 — 조용히 무시
    const count = appBadgeCount();
    if (count > 0) await Badge.set({ count });
    else await Badge.clear();
  } catch (e) { /* 권한 없음/미지원 — 무시 */ }
}
async function initAppBadge() {
  try {
    const Badge = window.Capacitor?.Plugins?.Badge;
    if (!Badge) return;
    const perm = await Badge.checkPermissions();
    if (perm.display !== "granted") await Badge.requestPermissions();
    await updateAppBadge();
  } catch (e) { /* 무시 */ }
  // 앱을 백그라운드로 보내거나 다시 열 때마다 배지를 현재 미읽음 수로 재설정.
  // (iOS는 백그라운드 진입 시점에 세팅해야 홈 화면에 안정적으로 표시됨)
  document.addEventListener("visibilitychange", () => { updateAppBadge(); });
}

function setAlertPanel(open) {
  const panel = document.getElementById("alertPanel");
  const backdrop = document.getElementById("alertBackdrop");
  if (panel) panel.hidden = !open;
  if (backdrop) backdrop.hidden = !open;
}

function alertActionLabel(a) {
  if (!a) return "";
  if (a.goTo === "myPostsManager" || (a.kind === "urgent" && a.title?.includes("스왑 마감"))) {
    return "내 스왑 관리로 이동";
  }
  if (a.goTo === "find") return "해당 스왑 확인";
  if (a.kind === "match") {
    return /확정|승인|완료|거절/.test(a.title || "") ? "매칭 결과 확인" : "요청 내용 확인";
  }
  return "";
}

async function openAlertDestination(a) {
  if (!a) return;
  if (a.goTo === "find") {
    switchTab("find");
    setAlertPanel(false);
    return;
  }
  if (a.goTo === "myPostsManager" || (a.kind === "urgent" && a.title?.includes("스왑 마감"))) {
    await openMyPostsManager();
    setAlertPanel(false);
    if (a.postId) {
      requestAnimationFrame(() => {
        const target = [...document.querySelectorAll("#myPostList .my-post-card")]
          .find(card => card.dataset.myPostId === String(a.postId));
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.add("is-alert-target");
        setTimeout(() => target.classList.remove("is-alert-target"), 1800);
      });
    }
    return;
  }
  if (a.kind === "match") {
    const mode = a.viewMode || "received";
    state.reqViewMode = mode;
    $$('[data-req-view]').forEach(x => x.classList.toggle("is-active", x.dataset.reqView === mode));
    switchTab("requests");
    setAlertPanel(false);
    // 알림이 가리키는 요청 한 건만 보여준다. switchTab이 안에서 fetchRequests()를
    // fire-and-forget으로 호출해 아직 목록이 없을 수 있으므로, 여기서 await로
    // 응답을 받은 뒤 대상 요청을 특정한다.
    await fetchRequests();
    let targetId = a.requestId;
    if (!targetId) {
      // requestId가 도입되기 전에 만들어진 알림 — 본문에 적힌 글 제목으로 요청을 찾는다.
      const match = (state.requests[mode] || []).find(r => r.postTitle && a.body?.includes(r.postTitle));
      targetId = match?.id || null;
    }
    state.focusedRequestId = targetId;
    renderRequests();
    if (targetId) {
      const target = document.querySelector(`#requestList .request-card[data-req-card-id="${CSS.escape(targetId)}"]`);
      if (target) {
        target.classList.add("is-alert-target");
        setTimeout(() => target.classList.remove("is-alert-target"), 2600);
      }
    }
  }
}

function renderAlerts() {
  const filter = state.alertFilter;
  const allIndexed = state.alerts.map((a, i) => ({ a, i }));
  const items = filter === "all"
    ? allIndexed.filter(x => !x.a.hiddenInAll)
    : allIndexed.filter(x => x.a.kind === filter);
  $("#alertList").innerHTML = items.length ? items.map(({ a, i }) => {
    const unread = a.kind !== "announce" && !a.read;
    const actionLabel = alertActionLabel(a);
    return `
    <div class="alert-item ${a.kind}${unread ? " is-unread" : ""}" data-alert-idx="${i}" role="button" tabindex="0" aria-expanded="false">
      <button class="alert-del-btn" data-alert-idx="${i}" title="알림 삭제" aria-label="알림 삭제">×</button>
      <strong>${unread ? '<span class="unread-dot"></span>' : ""}${escapeHtml(a.title)}</strong>
      <p class="alert-body">${escapeHtml(a.body)}</p>
      <span class="time">${alertTimeAgo(a)}</span>
      <span class="alert-expand-hint" hidden>내용 보기 ▾</span>
      ${actionLabel ? `<div class="alert-actions" hidden><button type="button" class="alert-action-button" data-alert-idx="${i}">${actionLabel}</button></div>` : ""}
    </div>`;
  }).join("") : `<div class="empty-state">알림이 없습니다.</div>`;
  $$("#alertList .alert-del-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.alertIdx, 10);
      if (state.alertFilter === "all") {
        // 전체 탭: 매칭/마감/공지 메뉴엔 그대로 남기고 '전체'에서만 숨김.
        // 재시작해도 다시 보이지 않도록 알림 자체에 표시해 저장한다.
        if (state.alerts[idx]) state.alerts[idx].hiddenInAll = true;
        saveState();
      } else {
        // 카테고리 탭(매칭/마감/공지): 영구 삭제
        state.alerts.splice(idx, 1);
        saveState();
      }
      renderAlerts();
    });
  });
  // 알림 카드는 내용만 펼치고, 실제 화면 이동은 펼친 뒤 나타나는 별도 버튼으로만 처리한다.
  $$("#alertList .alert-item").forEach(el => {
    const body = el.querySelector(".alert-body");
    const hint = el.querySelector(".alert-expand-hint");
    const action = el.querySelector(".alert-actions");
    const canExpand = Boolean(action) || (body && body.scrollHeight > body.clientHeight + 1);
    if (canExpand) {
      el.classList.add("is-collapsible");
      if (hint) hint.hidden = false;
    } else {
      el.classList.add("is-static");
      el.removeAttribute("role");
      el.removeAttribute("tabindex");
      el.removeAttribute("aria-expanded");
    }
    const toggleDetails = () => {
      if (!el.classList.contains("is-collapsible")) return;
      const a = state.alerts[parseInt(el.dataset.alertIdx, 10)];
      if (!a) return;
      markAlertRead(a);
      const expanded = el.classList.toggle("is-expanded");
      el.setAttribute("aria-expanded", String(expanded));
      el.classList.remove("is-unread");
      const dot = el.querySelector(".unread-dot"); if (dot) dot.remove();
      if (hint) hint.textContent = expanded ? "접기 ▴" : "내용 보기 ▾";
      if (action) action.hidden = !expanded;
    };
    el.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      toggleDetails();
    });
    el.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("button")) return;
      event.preventDefault();
      toggleDetails();
    });
  });
  $$("#alertList .alert-action-button").forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const a = state.alerts[parseInt(btn.dataset.alertIdx, 10)];
      if (!a) return;
      markAlertRead(a);
      await openAlertDestination(a);
    });
  });
  updateBellBadge();
  updateAppBadge();
}

// 벨 배지 = 미읽음 알림 수 (공지 제외)
function updateBellBadge() {
  const n = appBadgeCount();
  const el = $("#bellBadge");
  if (!el) return;
  el.textContent = n;
  el.style.display = n ? "grid" : "none";
}

/* ====== 9. 이벤트 ====== */
function switchTab(name, { preserveSelection = false } = {}) {
  const currentView = document.querySelector(".view.is-active")?.id;
  if (!preserveSelection && currentView && currentView !== name && state.selectionPurpose) {
    resetScheduleSelection(false);
  }
  state.managingMyPosts = name === "myPostsManager";
  // "스왑하기" 하나로 묶인 find/post는 같은 하단 탭(data-tab="find")을 함께 활성화
  const SWAP_VIEWS = ["swapGuide", "find", "post", "myPostsManager", "premiumAlerts"];
  const bottomActive = SWAP_VIEWS.includes(name) ? "swapGuide" : name;
  $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === bottomActive));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.id === name));
  // 사용자·크레딧 헤더는 모든 메뉴에서 숨기고 알림종만 화면에 고정한다.
  document.querySelector(".topbar")?.classList.add("is-compact");
  // 스왑하기 서브탭 상태 동기화
  $$(".swap-subtab").forEach(b => b.classList.toggle("is-active", b.dataset.swaptab === name));
  if (name === "find") fetchPosts();
  if (name === "premiumAlerts") renderSavedSearches();
  if (name === "myPostsManager") fetchMyPosts();
  // 하단 탭 등으로 요청함을 직접 열면 전체 목록을 보여준다.
  // (알림에서 들어오는 경로는 switchTab 이후에 focusedRequestId를 세팅한다.)
  if (name === "requests") { state.focusedRequestId = null; fetchRequests(); }
  if (name === "post") fetchMyPosts();
  if (name === "swapGuide") fetchMyPosts();
  renderFlowUi();
  history.replaceState(null, "", "#" + name);
  // 탭 전환 시 항상 맨 위에서 시작 (이전 탭 스크롤 위치 잔존 방지)
  const appEl = document.querySelector(".app");
  if (appEl) appEl.scrollTop = 0;
}

// 직군 변경 시 직책 옵션 교체 · 기종 선택 show/hide
const PILOT_ROLE_OPTIONS = [
  ["CAPTAIN_C","C등급 기장"],["CAPTAIN_B","B등급 기장"],["CAPTAIN_A","A등급 기장"],
  ["FO_C","C등급 부기장"],["FO_B","B등급 부기장"],["FO_A","A등급 부기장"],
];
const CABIN_ROLE_OPTIONS = [
  ["CC","일반 승무원 (CC)"],["AP","부사무장 (AP)"],["PS","사무장 (PS)"],
  ["SP","선임사무장 (SP)"],["CP","수석사무장 (CP)"],
];
function updateRoleSelectForCrewType(crewTypeId, roleSelectId, aircraftLabelId, currentRole) {
  const ct = document.getElementById(crewTypeId);
  const rs = document.getElementById(roleSelectId);
  const al = document.getElementById(aircraftLabelId);
  if (!ct || !rs) return;
  const isCabin = ct.value === "CABIN";
  const opts = isCabin ? CABIN_ROLE_OPTIONS : PILOT_ROLE_OPTIONS;
  const defaultVal = isCabin ? "CC" : "FO_B";
  // new Option() 방식 — innerHTML보다 브라우저 호환성 높음
  while (rs.options.length) rs.remove(0);
  opts.forEach(([v, t]) => rs.add(new Option(t, v)));
  const target = currentRole && opts.find(([v]) => v === currentRole) ? currentRole : defaultVal;
  rs.value = target;
  if (al) al.hidden = isCabin;

  // 조종사/객실 전용 자격 섹션 show/hide
  const isSignup = crewTypeId === "signupCrewType";
  const pilotDiv = document.getElementById(isSignup ? "signupPilotQuals" : "profilePilotQuals");
  const cabinDiv = document.getElementById(isSignup ? "signupCabinQuals" : "profileCabinQuals");
  if (pilotDiv) pilotDiv.hidden = isCabin;
  if (cabinDiv) cabinDiv.hidden = !isCabin;
}

// 당겨서 새로고침 — 현재 탭에 맞는 갱신 (목록 탭만)
const PULL_REFRESH_VIEWS = { find: fetchPosts, requests: fetchRequests, post: fetchMyPosts, schedule: renderAll };
function currentViewId() {
  const v = document.querySelector(".view.is-active");
  return v ? v.id : "schedule";
}
async function refreshCurrentTab() {
  const fn = PULL_REFRESH_VIEWS[currentViewId()];
  if (!fn) return;
  try { await fn(); } catch (e) { console.warn("pull-refresh error:", e); }
}

// 화면 맨 위에서 아래로 당겼다 놓으면 새로고침 (Capacitor WebView는 기본 새로고침 없음)
function initPullToRefresh() {
  const scroller = document.querySelector(".app");
  if (!scroller) return;
  const ind = document.getElementById("pullRefreshIndicator");
  const THRESHOLD = 70, MAX = 110;
  let startY = 0, pulling = false, dist = 0, refreshing = false;

  scroller.addEventListener("touchstart", e => {
    if (refreshing || scroller.scrollTop > 0 || !PULL_REFRESH_VIEWS[currentViewId()]) { pulling = false; return; }
    startY = e.touches[0].clientY; pulling = true; dist = 0;
  }, { passive: true });

  scroller.addEventListener("touchmove", e => {
    if (!pulling || refreshing) return;
    dist = e.touches[0].clientY - startY;
    if (dist <= 0) { if (ind) ind.style.height = "0px"; return; }
    const pull = Math.min(dist * 0.5, MAX);
    if (ind) {
      ind.style.height = pull + "px";
      ind.textContent = pull >= THRESHOLD ? "↑ 놓으면 새로고침" : "↓ 당겨서 새로고침";
    }
  }, { passive: true });

  const end = async () => {
    if (!pulling || refreshing) { pulling = false; return; }
    pulling = false;
    const trigger = dist * 0.5 >= THRESHOLD;
    if (trigger && ind) {
      refreshing = true;
      ind.style.height = "44px";
      ind.textContent = "⟳ 새로고침 중...";
      await refreshCurrentTab();
      refreshing = false;
    }
    if (ind) { ind.style.height = "0px"; }
    dist = 0;
  };
  scroller.addEventListener("touchend", end, { passive: true });
  scroller.addEventListener("touchcancel", end, { passive: true });
}

function bindEvents() {
  $$('[data-service-link]').forEach(link => link.addEventListener("click", event => {
    event.preventDefault();
    openServiceLink(link.dataset.serviceLink);
  }));
  $$(".tab").forEach(t => t.addEventListener("click", () => {
    const current = document.querySelector(".view.is-active")?.id;
    if (current !== t.dataset.tab) resetScheduleSelection(false);
    switchTab(t.dataset.tab);
  }));
  $("#watchAdButton")?.addEventListener("click", openRewardAd);
  $("#watchAdButtonProfile")?.addEventListener("click", openRewardAd);
  $("#rewardAdStartButton")?.addEventListener("click", startRewardAd);
  $("#rewardAdCancelButton")?.addEventListener("click", closeRewardAd);
  $("#rewardAdOverlay")?.addEventListener("click", closeRewardAd);
  $("#startPostFlow")?.addEventListener("click", startPostGuide);
  $("#startFindFlow")?.addEventListener("click", startFindGuide);
  $("#openMyPostsManager")?.addEventListener("click", openMyPostsManager);
  $("#openPremiumAlertManager")?.addEventListener("click", openPremiumAlertManager);
  $("#openProfilePro")?.addEventListener("click", openPremiumAlertManager);
  $("#openMainPro")?.addEventListener("click", openPremiumAlertManager);
  $("#premiumAlertBack")?.addEventListener("click", () => exitGuideFlow("swapGuide"));
  $("#closeMyPostsManager")?.addEventListener("click", () => {
    state.managingMyPosts = false;
    renderMyPosts();
    switchTab("swapGuide");
  });
  $("#openSwapMenuFromSchedule")?.addEventListener("click", () => exitGuideFlow("swapGuide"));
  $$(".flow-exit-btn").forEach(button => button.addEventListener("click", () => exitGuideFlow("swapGuide")));
  $$(".find-guide-cancel").forEach(button => button.addEventListener("click", () => exitGuideFlow("swapGuide")));
  $$("#guideTypeChips [data-guide-type]").forEach(button => button.addEventListener("click", () => {
    const type = button.dataset.guideType;
    const index = state.filters.types.indexOf(type);
    if (index >= 0) state.filters.types.splice(index, 1);
    else state.filters.types.push(type);
    syncGuideTypeChips();
  }));
  $("#findGuideNext1")?.addEventListener("click", () => setFindGuideStep(2));
  $("#findGuideShowAll")?.addEventListener("click", () => {
    state.filters = {
      direction: "all",
      types: [],
      date: "all",
      time: "all",
      arrTime: "all",
      region: "all",
      layover: "all",
      airports: [],
    };
    syncGuideTypeChips();
    syncMainFilterControls();
    setFindGuideStep(3);
  });
  $("#findGuideBack1")?.addEventListener("click", () => setFindGuideStep(1));
  $("#findGuideEdit")?.addEventListener("click", () => setFindGuideStep(2));
  $("#findGuideNext2")?.addEventListener("click", () => {
    state.filters.date = $("#guideDate")?.value || "all";
    state.filters.time = $("#guideTime")?.value || "all";
    state.filters.region = $("#guideRegion")?.value || "all";
    state.filters.airports = parseAirportList($("#guideAirports")?.value || "");
    syncMainFilterControls();
    setFindGuideStep(3);
  });
  // 스왑하기 서브탭 (바꿀 근무 찾기 / 스왑 요청 올리기)
  $$(".swap-subtab").forEach(b => b.addEventListener("click", () => {
    resetScheduleSelection(false);
    state.managingMyPosts = false;
    switchTab(b.dataset.swaptab);
  }));
  // 스왑 찾기 새로고침
  $("#refreshFindBtn")?.addEventListener("click", () => { fetchPosts(); showToast("최신 글을 불러왔습니다."); });
  // 직군 변경 → 직책 옵션 동적 전환 (가입 팝업 + 프로필 탭)
  const signupCT = $("#signupCrewType");
  if (signupCT) {
    updateRoleSelectForCrewType("signupCrewType", "signupRole", "signupAircraftLabel");
    signupCT.addEventListener("change", () =>
      updateRoleSelectForCrewType("signupCrewType", "signupRole", "signupAircraftLabel"));
  }
  const profileCT = $("#crewTypeInput");
  if (profileCT) {
    updateRoleSelectForCrewType("crewTypeInput", "roleTypeInput", "aircraftInputLabel", state.user.roleType);
    profileCT.addEventListener("change", () =>
      updateRoleSelectForCrewType("crewTypeInput", "roleTypeInput", "aircraftInputLabel"));
  }

  // 월 전환
  const prevBtn = document.getElementById("prevMonthBtn");
  const nextBtn = document.getElementById("nextMonthBtn");
  if (prevBtn) prevBtn.addEventListener("click", () => changeMonth(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => changeMonth(+1));

  // ── 이메일 인증 ──────────────────────────────────────────────
  let _verifyToken = null;   // send-verify 에서 받은 토큰
  let _verifyEmail = null;   // 인증 완료된 이메일 (null = 미완료)
  let _verifyCode  = null;   // 인증 완료된 코드 (user-signup 서버 재검증용)
  let _verifyCooldown = null; // 재발송 쿨다운 타이머 ID

  function setVerifyStatus(msg, type) {
    // type: "ok" | "err" | "hint"
    const el = $("#verifyStatus");
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === "ok" ? "var(--c-pass)" : type === "err" ? "var(--c-fail)" : "var(--muted)";
  }

  // 인증 UI 초기화 (탈퇴/재가입 시 "이미 인증 완료" 잔존 방지)
  function resetVerifyUI() {
    _verifyEmail = null;
    if (_verifyCooldown) { clearInterval(_verifyCooldown); _verifyCooldown = null; }
    const emailEl = $("#signupEmail");
    if (emailEl) { emailEl.value = ""; emailEl.readOnly = false; emailEl.disabled = false; }
    const codeRow = $("#verifyCodeRow"); if (codeRow) codeRow.hidden = true;
    const codeInput = $("#verifyCodeInput"); if (codeInput) codeInput.value = "";
    const sendBtn = $("#sendVerifyBtn"); if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = "코드 발송"; }
    setVerifyStatus("", "hint");
  }
  window.__resetVerifyUI = resetVerifyUI; // 다른 핸들러에서 호출용

  function startCooldown(btn, seconds) {
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `재발송 (${remaining}초)`;
    _verifyCooldown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(_verifyCooldown);
        _verifyCooldown = null;
        btn.disabled = false;
        btn.textContent = "재발송";
      } else {
        btn.textContent = `재발송 (${remaining}초)`;
      }
    }, 1000);
  }

  $("#sendVerifyBtn").addEventListener("click", async () => {
    const email = ($("#signupEmail").value || "").trim();
    const btn = $("#sendVerifyBtn");
    if (!email) { setVerifyStatus("이메일을 입력해주세요.", "err"); return; }
    if (!email.endsWith("@jejuair.net")) {
      setVerifyStatus("제주항공 이메일(@jejuair.net)을 입력해주세요.", "err");
      return;
    }
    btn.disabled = true;
    btn.textContent = "발송 중…";
    setVerifyStatus("인증 코드를 발송하고 있습니다…", "hint");
    try {
      const res = await apiFetch(`${API_BASE}/api/send-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyStatus(data.error || "발송 실패. 다시 시도해주세요.", "err");
        btn.disabled = false;
        btn.textContent = "코드 발송";
        return;
      }
      _verifyToken = data.token;
      _verifyEmail = null;
      $("#verifyCodeRow").hidden = false;
      $("#verifyCodeInput").value = "";
      $("#verifyCodeInput").focus();
      setVerifyStatus(`${email} 으로 코드를 발송했습니다. 10분 이내 입력해주세요.`, "hint");
      startCooldown(btn, 60);
    } catch (e) {
      setVerifyStatus("네트워크 오류. 잠시 후 다시 시도해주세요.", "err");
      btn.disabled = false;
      btn.textContent = "코드 발송";
    }
  });

  $("#checkVerifyBtn").addEventListener("click", async () => {
    const email = ($("#signupEmail").value || "").trim().toLowerCase();
    const code  = ($("#verifyCodeInput").value || "").trim();
    const btn   = $("#checkVerifyBtn");
    if (!code || code.length !== 6) {
      setVerifyStatus("6자리 코드를 입력해주세요.", "err");
      return;
    }
    if (!_verifyToken) {
      setVerifyStatus("먼저 코드를 발송해주세요.", "err");
      return;
    }
    btn.disabled = true;
    btn.textContent = "확인 중…";
    try {
      const res = await apiFetch(`${API_BASE}/api/check-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, token: _verifyToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyStatus(data.error || "인증 실패.", "err");
        btn.disabled = false;
        btn.textContent = "인증 확인";
        return;
      }
      _verifyEmail = email;
      _verifyCode = code;
      if (data.registered) {
        setVerifyStatus("이미 가입된 이메일입니다 — 로그인해주세요.", "err");
        openLoginModal(email);
        return;
      }
      setVerifyStatus("✓ 이메일 인증 완료!", "ok");
      $("#verifyCodeRow").hidden = true;
      if (_verifyCooldown) { clearInterval(_verifyCooldown); _verifyCooldown = null; }
      const sendBtn = $("#sendVerifyBtn");
      sendBtn.disabled = true;
      sendBtn.textContent = "인증 완료 ✓";
      btn.textContent = "인증 확인";
    } catch (e) {
      setVerifyStatus("네트워크 오류. 잠시 후 다시 시도해주세요.", "err");
      btn.disabled = false;
      btn.textContent = "인증 확인";
    }
  });

  // ── 가입 폼 제출 (서버 계정 생성) ──────────────────────────────
  $("#signupForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!_verifyEmail) {
      setVerifyStatus("회사 이메일 인증을 완료해주세요.", "err");
      $("#signupEmail").focus();
      return;
    }
    const username = ($("#signupNickname").value || "").trim();
    const pw  = $("#signupPassword").value || "";
    const pw2 = $("#signupPassword2").value || "";
    const policyAgreed = $("#signupPolicyAgree")?.checked;
    if (!username) { setVerifyStatus("아이디(표시 이름)를 입력해주세요.", "err"); $("#signupNickname").focus(); return; }
    if (pw.length < 6) { setVerifyStatus("비밀번호는 6자 이상이어야 합니다.", "err"); $("#signupPassword").focus(); return; }
    if (pw !== pw2) { setVerifyStatus("비밀번호가 일치하지 않습니다.", "err"); $("#signupPassword2").focus(); return; }
    if (!policyAgreed) { setVerifyStatus("이용약관과 개인정보처리방침에 동의해주세요.", "err"); $("#signupPolicyAgree")?.focus(); return; }

    // 프로필 값 수집
    const crewType = $("#signupCrewType").value;
    const profile = {
      airline: $("#signupAirline").value, crewType,
      nickname: username,
      roleType: $("#signupRole").value,
      aircraft: $("#signupAircraft").value,
      base: $("#signupBase").value,
      edto: $("#signupEdto").checked, cat2: $("#signupCat2").checked, cat3: $("#signupCat3").checked,
      realName: $("#signupRealName").value.trim(),
      employeeId: $("#signupEmployeeId").value.trim(),
      phone: $("#signupPhone").value.trim(),
    };
    if (crewType === "CABIN") {
      profile.gender = $("#signupGender").value;
      profile.hasBroadcastRating = $("#signupBroadcast")?.checked || false;
      profile.languages = ["Japanese","Chinese","Ann_JA","Ann_CA"]
        .filter(k => document.getElementById(`signup${k === "Japanese" ? "LangJP" : k === "Chinese" ? "LangCN" : k === "Ann_JA" ? "AnnJA" : "AnnCA"}`)?.checked);
    }

    const btn = e.submitter || $("#signupForm button[type=submit]");
    if (btn) btn.disabled = true;
    setVerifyStatus("계정을 생성하는 중…", "hint");
    try {
      const res = await apiFetch(`${API_BASE}/api/user-signup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: _verifyEmail, code: _verifyCode, token: _verifyToken, username, password: pw, profile,
          policyConsent: { privacyVersion: POLICY_VERSION, termsVersion: POLICY_VERSION },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setVerifyStatus("❌ " + (data.error || "가입 실패"), "err");
        if (res.status === 409) openLoginModal(_verifyEmail); // 이미 가입 → 로그인 유도
        return;
      }
      state.sessionToken = data.sessionToken || null;
      state.sessionExpiresAt = data.sessionExpiresAt || null;
      applyLoggedInProfile(_verifyEmail, data.profile || profile, data.premium, data.wallet);
      saveState();
      renderCredits();
      closeSignupModal();
      showToast("가입 완료 · 이번 달 기본 크레딧 3개 지급! '📥 CrewConnex 불러오기'로 내 스케줄을 가져오세요.");
    } catch (err) {
      setVerifyStatus("네트워크 오류 — 잠시 후 다시 시도해주세요.", "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // ── 로그인 ────────────────────────────────────────────────────
  $("#loginForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const email = ($("#loginEmail").value || "").trim().toLowerCase();
    const pw = $("#loginPassword").value || "";
    const st = $("#loginStatus");
    const setSt = (m, ok) => { if (st) { st.textContent = m; st.style.color = ok ? "var(--c-pass)" : "var(--c-fail)"; } };
    if (!email || !pw) { setSt("이메일과 비밀번호를 입력해주세요.", false); return; }
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    setSt("로그인 중…", true);
    if (st) st.style.color = "var(--muted)";
    try {
      const res = await apiFetch(`${API_BASE}/api/user-login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setSt("❌ " + (data.error || "로그인 실패"), false); return; }
      $("#loginPassword").value = "";
      state.sessionToken = data.sessionToken || null;
      state.sessionExpiresAt = data.sessionExpiresAt || null;
      applyLoggedInProfile(data.email || email, data.profile, data.premium, data.wallet);
      closeLoginModal();
      showToast(`${data.username || "님"} 로그인 완료`);
    } catch (err) {
      setSt("네트워크 오류 — 잠시 후 다시 시도해주세요.", false);
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $("#goToLoginBtn")?.addEventListener("click", () => openLoginModal($("#signupEmail")?.value || ""));
  $("#goToSignupBtn")?.addEventListener("click", () => { closeLoginModal(); openSignupModal(); });
  $("#goToResetBtn")?.addEventListener("click", () => openResetModal());
  $("#resetBackBtn")?.addEventListener("click", () => { closeResetModal(); openLoginModal(); });

  // ── 비밀번호 재설정 ───────────────────────────────────────────
  let _resetToken = null, _resetVerified = null, _resetCode = null;
  const setResetStatus = (m, type) => {
    const el = $("#resetStatus"); if (!el) return;
    el.textContent = m;
    el.style.color = type === "ok" ? "var(--c-pass)" : type === "err" ? "var(--c-fail)" : "var(--muted)";
  };
  $("#resetSendBtn")?.addEventListener("click", async () => {
    const email = ($("#resetEmail").value || "").trim().toLowerCase();
    const btn = $("#resetSendBtn");
    if (!email.endsWith("@jejuair.net")) { setResetStatus("제주항공 이메일(@jejuair.net)을 입력해주세요.", "err"); return; }
    btn.disabled = true; btn.textContent = "발송 중…";
    try {
      const res = await apiFetch(`${API_BASE}/api/send-verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setResetStatus(data.error || "발송 실패", "err"); btn.disabled = false; btn.textContent = "코드 발송"; return; }
      _resetToken = data.token; _resetVerified = null;
      $("#resetCodeRow").hidden = false;
      $("#resetCodeInput").value = "";
      $("#resetCodeInput").focus();
      setResetStatus(`${email} 으로 코드를 발송했습니다.`, "hint");
      btn.textContent = "재발송";
      setTimeout(() => { btn.disabled = false; }, 3000);
    } catch (e) { setResetStatus("네트워크 오류", "err"); btn.disabled = false; btn.textContent = "코드 발송"; }
  });
  $("#resetCheckBtn")?.addEventListener("click", async () => {
    const email = ($("#resetEmail").value || "").trim().toLowerCase();
    const code = ($("#resetCodeInput").value || "").trim();
    if (!_resetToken) { setResetStatus("먼저 코드를 발송해주세요.", "err"); return; }
    try {
      const res = await apiFetch(`${API_BASE}/api/check-verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code, token: _resetToken }),
      });
      const data = await res.json();
      if (!res.ok) { setResetStatus(data.error || "인증 실패", "err"); return; }
      if (!data.registered) { setResetStatus("가입되지 않은 이메일입니다. 회원가입을 진행해주세요.", "err"); return; }
      _resetVerified = email; _resetCode = code;
      setResetStatus("✓ 인증 완료 — 새 비밀번호를 설정하세요.", "ok");
      $("#resetCodeRow").hidden = true;
    } catch (e) { setResetStatus("네트워크 오류", "err"); }
  });
  $("#resetForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    if (!_resetVerified) { setResetStatus("이메일 인증을 완료해주세요.", "err"); return; }
    const pw = $("#resetPassword").value || "", pw2 = $("#resetPassword2").value || "";
    if (pw.length < 6) { setResetStatus("비밀번호는 6자 이상이어야 합니다.", "err"); return; }
    if (pw !== pw2) { setResetStatus("비밀번호가 일치하지 않습니다.", "err"); return; }
    const btn = e.submitter; if (btn) btn.disabled = true;
    try {
      const res = await apiFetch(`${API_BASE}/api/user-reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: _resetVerified, code: _resetCode, token: _resetToken, password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setResetStatus("❌ " + (data.error || "재설정 실패"), "err"); return; }
      showToast("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.");
      closeResetModal(); openLoginModal(_resetVerified);
    } catch (err) { setResetStatus("네트워크 오류", "err"); }
    finally { if (btn) btn.disabled = false; }
  });

  // ── 로그아웃 ──────────────────────────────────────────────────
  $("#logoutButton")?.addEventListener("click", () => logout());

  $("#importScheduleButton").addEventListener("click", openImportDialog);

  $("#crewCloseButton")?.addEventListener("click", () => closeGenericModal("crewDialog", "crewOverlay"));

  // (import-tab 전환 핸들러 제거 — 단일 모드 사용)

  // Enter 키로 로그인 트리거 (form method="dialog" 가 Enter 로 닫히는 문제 방지)
  ["ccUsername", "ccPassword"].forEach(id => {
    const el = $("#" + id);
    if (el) el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); $("#ccLoginButton").click(); }
    });
  });

  // 🚀 자동 로그인 (Netlify Function)
  $("#ccLoginButton").addEventListener("click", async () => {
    const username = ($("#ccUsername").value || "").trim();
    const password = $("#ccPassword").value || "";
    const userName = username; // CrewConnex ID = 본인 이름 (편조 자기 제외용)
    const status = $("#ccLoginStatus");
    if (!username || !password) {
      status.style.color = "var(--c-fail)";
      status.textContent = "⚠ 아이디/비밀번호를 입력하세요";
      return;
    }
    status.style.color = "var(--muted)";
    status.textContent = "⏳ CrewConnex 로그인 중... (10~20초)";
    $("#ccLoginButton").disabled = true;
    try {
      const resp = await apiFetch(`${API_BASE}/api/crewconnex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, userName }),
      });
      const data = await resp.json();
      window.__lastCrewconnex = data; // 디버그용 — 마지막 응답 저장
      console.log("%c📡 Netlify 함수 응답", "background:#7a4fcf;color:#fff;padding:3px 8px;border-radius:4px;", data);
      if (!resp.ok || data.error) {
        status.style.color = "var(--c-fail)";
        status.textContent = "❌ " + (data.error || "로그인 실패");
        return;
      }
      const schedules = data.schedules || [];
      if (schedules.length === 0) {
        status.style.color = "var(--c-warn)";
        status.textContent = "⚠ 로그인 성공했으나 스케줄을 찾지 못함";
        return;
      }
      status.style.color = "var(--c-pass)";
      const months = data.months || [];
      const metaArr = Array.isArray(data.meta) ? data.meta : [data.meta || {}];
      const totalBLH = metaArr.map(m => m.totalBLH || "-").join(" + ");
      status.innerHTML = `✅ ${schedules.length}건 (월: <strong>${months.join(", ") || "단일"}</strong>, BLH ${totalBLH})`;
      // 디버그 로그 콘솔 출력
      if (data.debug && Array.isArray(data.debug)) {
        console.group("%c🔍 CrewConnex 파싱 디버그", "background:#2e6fd6;color:#fff;padding:3px 8px;border-radius:4px;");
        data.debug.forEach(line => console.log(line));
        console.groupEnd();
      }
      // 비밀번호 즉시 폐기
      $("#ccPassword").value = "";
      showPreview(schedules);
    } catch (err) {
      status.style.color = "var(--c-fail)";
      if (!navigator.onLine || /load failed|network|fetch/i.test(err.message || "")) {
        status.textContent = "📶 인터넷 연결을 확인하고 다시 시도해주세요.";
      } else {
        status.textContent = "❌ 연결 오류: " + err.message;
      }
    } finally {
      $("#ccLoginButton").disabled = false;
    }
  });

  // (텍스트 붙여넣기 / JSON / 샘플 복원 핸들러 제거 — 자동 로그인만 지원)

  // 행 추가
  $("#addRowButton").addEventListener("click", () => {
    const maxDay = previewSchedules.reduce((m, s) => Math.max(m, s.day), 0);
    previewSchedules.push({ day: Math.min(30, maxDay + 1), patternId: null, type: "OFF", title: "OFF", crewComposition: "편조 없음" });
    previewSchedules.sort((a,b) => a.day - b.day);
    renderPreviewTable();
  });

  // 다시 입력
  $("#reparseButton").addEventListener("click", () => {
    $("#parsePreview").hidden = true;
    $("#defaultDialogActions").hidden = false;
    const active = $$(".import-tab").find(t => t.classList.contains("is-active"));
    if (active) $$(".import-mode").forEach(el => el.hidden = el.id !== active.dataset.mode + "Mode");
  });

  // 메인 적용
  $("#confirmImportButton").addEventListener("click", () => {
    const finalSchedules = collectPreviewEdits();
    if (finalSchedules.length === 0) { showToast("저장할 항목이 없습니다."); return; }
    window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(finalSchedules);
    state.schedules = finalSchedules;
    state.selectedDays.clear();
    // 현재 월에 데이터가 있는지 확인, 없으면 데이터가 있는 첫 월로 자동 전환
    const monthsAvail = [...new Set(finalSchedules.map(s => s.month).filter(Boolean))].sort();
    if (monthsAvail.length > 0 && !monthsAvail.includes(state.currentMonth)) {
      state.currentMonth = monthsAvail[0];
    }
    saveState();
    syncSchedulesToServer();
    closeGenericModal("crewDialog", "crewOverlay");
    renderAll();
    if (state.guideFlow === "post") switchTab("schedule", { preserveSelection: true });
    const monthInfo = monthsAvail.length > 1 ? ` (${monthsAvail.length}개월: ${monthsAvail.join(", ")})` : "";
    const navHint = monthsAvail.length > 1 ? " 상단 월 칩으로 빠른 전환 가능." : " ‹ › 버튼으로 월 이동.";
    showToast(`스케줄 ${finalSchedules.length}건 적용${monthInfo}.${navHint}`);
  });

  document.getElementById("withdrawButton")?.addEventListener("click", () => {
    const password = document.getElementById("withdrawPassword");
    const status = document.getElementById("withdrawStatus");
    if (password) password.value = "";
    if (status) { status.textContent = ""; status.style.color = "var(--muted)"; }
    openGenericModal("withdrawDialog", "withdrawOverlay");
    setTimeout(() => password?.focus(), 50);
  });
  document.getElementById("withdrawCancelButton")?.addEventListener("click", () =>
    closeGenericModal("withdrawDialog", "withdrawOverlay"));
  document.getElementById("withdrawForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const password = document.getElementById("withdrawPassword")?.value || "";
    const status = document.getElementById("withdrawStatus");
    const button = document.getElementById("withdrawConfirmButton");
    const setStatus = (message, error = false) => {
      if (!status) return;
      status.textContent = message;
      status.style.color = error ? "var(--c-fail)" : "var(--muted)";
    };
    if (!state.user.email || !state.user.serverAuthed) { setStatus("로그인된 계정을 확인할 수 없습니다.", true); return; }
    if (!password) { setStatus("현재 비밀번호를 입력해주세요.", true); return; }
    if (!confirm("계정과 연결된 모든 정보를 삭제합니다. 이 작업은 되돌릴 수 없습니다.\n정말 탈퇴하시겠습니까?")) return;

    if (button) button.disabled = true;
    setStatus("서버와 기기에서 계정 정보를 삭제하고 있습니다…");
    try {
      const response = await apiFetch(`${API_BASE}/api/user-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: state.user.email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setStatus(data.error || "탈퇴 처리에 실패했습니다.", true); return; }

      const crewSwapKeys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === STORAGE_KEY || key === "jjswap_lang" || key?.startsWith("crewswap_")) crewSwapKeys.push(key);
      }
      crewSwapKeys.forEach(key => localStorage.removeItem(key));
      closeGenericModal("withdrawDialog", "withdrawOverlay");
      alert("회원 탈퇴가 완료되었습니다. 서버와 이 기기의 CrewSwap 정보가 삭제되었습니다.");
      location.reload();
    } catch (error) {
      setStatus("네트워크 오류로 탈퇴를 완료하지 못했습니다. 다시 시도해주세요.", true);
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("#clearSelectionButton").addEventListener("click", () => {
    state.selectedDays.clear();
    renderCalendar(); renderSelection(); renderRuleCheck(); syncOfferedSlot();
  });
  $("#registerSelectionButton").addEventListener("click", () => {
    // 의향묻기/요청하기로 진입한 상태면 진행, 아니면 스왑 올리기 화면으로
    if (state.pendingRequestPostId) confirmPendingAction();
    else switchTab("post", { preserveSelection: true });
  });

  // 필터 접기/펼치기
  $("#filterToggle").addEventListener("click", () => {
    const body = $("#filterBody");
    const collapsed = body.classList.toggle("is-collapsed");
    $("#filterToggleLabel").textContent = collapsed ? "필터 펼치기" : "필터 접기";
    $("#filterToggleArrow").textContent = collapsed ? "▼" : "▲";
  });

  // 방향 변환 칩
  $$("#directionChips .filter-chip").forEach(c => c.onclick = () => {
    $$("#directionChips .filter-chip").forEach(x => x.classList.remove("is-active"));
    c.classList.add("is-active");
    state.filters.direction = c.dataset.dir;
    renderMatches();
  });
  // 유형 칩 (복수선택)
  $$("#typeFilters .filter-chip").forEach(c => c.onclick = () => {
    const val = c.dataset.filter;
    if (val === "all") {
      state.filters.types = [];
      $$("#typeFilters .filter-chip").forEach(x => x.classList.remove("is-active"));
      c.classList.add("is-active");
    } else {
      const idx = state.filters.types.indexOf(val);
      if (idx === -1) state.filters.types.push(val);
      else state.filters.types.splice(idx, 1);
      const allChip = document.querySelector("#typeFilters [data-filter='all']");
      if (state.filters.types.length === 0) {
        $$("#typeFilters .filter-chip").forEach(x => x.classList.remove("is-active"));
        if (allChip) allChip.classList.add("is-active");
      } else {
        if (allChip) allChip.classList.remove("is-active");
        $$("#typeFilters .filter-chip").forEach(x => {
          x.classList.toggle("is-active", state.filters.types.includes(x.dataset.filter));
        });
      }
    }
    renderMatches();
  });
  // select 필터
  ["dateFilter","timeFilter","arrTimeFilter","regionFilter","layoverFilter","sortSelect"].forEach(id => {
    const el = $("#"+id);
    if (!el) return;
    el.addEventListener("change", () => {
      const key = id === "sortSelect" ? "sortBy" : id.replace("Filter","");
      if (id === "sortSelect") state.sortBy = el.value;
      else state.filters[key] = el.value;
      renderMatches();
    });
  });

  // 공항 입력칸 — 스페이스 누르면 자동으로 ", " 변환 + 대문자
  function wireAirportInput(id, onChange) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", e => {
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        const v = el.value;
        const start = el.selectionStart ?? v.length;
        // 직전 문자가 비었거나 이미 쉼표/공백이면 중복 구분자 방지
        const prev = v.slice(0, start).trimEnd();
        if (!prev || prev.endsWith(",")) return;
        const before = v.slice(0, start).replace(/\s*$/, "");
        const after = v.slice(start);
        el.value = before + ", " + after.replace(/^\s*/, "");
        const pos = before.length + 2;
        el.setSelectionRange(pos, pos);
        el.dispatchEvent(new Event("input"));
      }
    });
    el.addEventListener("input", () => {
      const pos = el.selectionStart;
      const upper = el.value.toUpperCase();
      if (upper !== el.value) { el.value = upper; el.setSelectionRange(pos, pos); }
      if (onChange) onChange();
    });
  }
  wireAirportInput("includedAirports");
  wireAirportInput("excludedAirports");
  wireAirportInput("airportSearchFilter", () => {
    const el = document.getElementById("airportSearchFilter");
    state.filters.airports = parseAirportList(el.value);
    renderMatches();
  });

  // 실제 등록 실행 (WARN 확인 후 or 바로)
  async function doSubmitPost() {
    // 선택된 날짜를 연속 그룹으로 분리 (비연속 = 독립 패턴 = 각 1크레딧)
    if (state.selectedDays.size === 0) return;
    const groups = groupConsecutiveDayKeys([...state.selectedDays]);

    const needed = groups.length;
    const unlimitedCredits = isPremiumUser();
    if (!CREDIT_POLICY.canSpend(state, needed, unlimitedCredits)) {
      showToast(`크레딧 부족 (필요: ${needed}개, 보유: ${state.credits}개)`);
      return;
    }

    const wanted = { memo: ($("#postMemo").value || "").trim() };
    let createdCount = 0;

    for (const keyGroup of groups) {
      const ss = keyGroup.map(key => {
        const { day, month } = parseDayKey(key);
        return state.schedules.find(s => s.day === day && (s.month || state.currentMonth) === month);
      }).filter(Boolean);
      if (ss.length === 0) continue;
      const firstParsed = parseDayKey(keyGroup[0]);
      const mogijiProtectedDays = state.user.crewType === "PILOT"
        ? window.CrewSwapMogijiPolicy?.collectProtectedDays(state.schedules)
        : null;

      const firstFlight = ss.find(s => s.reportTime && /^\d/.test(s.reportTime));
      const lastFlight = [...ss].reverse().find(s => s.releaseTime && /^\d/.test(s.releaseTime));
      const firstCrew = ss.find(s => s.crewComposition && s.crewComposition !== "편조 없음");
      const region = (() => {
        for (const s of ss) {
          for (const ap of [s.arr, s.dep, s.layoverAirport].filter(Boolean)) {
            const r = AIRPORT_REGION[ap];
            if (r && r !== "DOMESTIC") return r;
          }
        }
        return ss.some(s => s.type === "국내선") ? "DOMESTIC" : null;
      })();

      const newPost = {
        id: "POST-" + Date.now() + "-" + firstParsed.day,
        deleteToken: crypto.randomUUID(),
        registeredAt: new Date().toISOString(),
        airline: state.user.airline,
        crewType: state.user.crewType,
        ownerRole: state.user.roleType,
        ownerNick: state.user.nickname,
        ownerEmail: state.user.email,
        ownerRating: state.user.rating || 4.5,
        ownerBase: state.user.base || "GMP",
        ownerValidationRoster: validationRosterSnapshot(),
        deadlineDay: ss[0].day,
        deadlineMonth: ss[0].month || state.currentMonth,
        watchers: 0,
        offered: {
          patternName: patternTitleFor(ss),
          dateKeys: keyGroup,
          startDate: keyGroup[0],
          endDate: keyGroup[keyGroup.length - 1],
          days: keyGroup.map(k => parseDayKey(k).day),
          daySchedules: ss.map(s => ({
            month: s.month || state.currentMonth,
            day: s.day,
            type: s.type,
            title: s.title,
            dep: s.dep || null,
            arr: s.arr || null,
            routeSummary: s.routeSummary || null,
            reportTime: s.reportTime || null,
            departureTime: s.departureTime || null,
            releaseTime: s.releaseTime || null,
            arrivalTime: s.arrivalTime || null,
            blockMinutes: Number.isFinite(s.blockMinutes) ? s.blockMinutes : null,
          })),
          summary: ss.map(s => s.routeSummary || (s.dep&&s.arr?`${s.dep}-${s.arr}`:s.type)).join(" · "),
          type: ss[0].type,
          aircraft: ss[0].aircraft || null,
          edto: ss.some(s=>s.requiresEdto),
          cat3: ss.some(s=>s.requiresCat3),
          flightMinutes: ss.reduce((sum,s)=>sum+flightMinutesOf(s),0),
          region,
          reportTime: firstFlight ? firstFlight.reportTime : null,
          firstDepartureTime: firstFlight?.departureTime || null,
          firstDepAirport: firstFlight?.dep || null,
          releaseTime: lastFlight ? lastFlight.releaseTime : null,
          lastReport: (ss[ss.length - 1] && /^\d/.test(ss[ss.length - 1].reportTime || "")) ? ss[ss.length - 1].reportTime : null,
          lastArrival: (ss[ss.length - 1] && /^\d/.test(ss[ss.length - 1].arrivalTime || "")) ? ss[ss.length - 1].arrivalTime : null,
          lastArrAirport: (ss[ss.length - 1] && ss[ss.length - 1].arr) || null,
          hasLayover: ss.some(s => s.type === "LAYOV" || s.type === "ARRIVAL"),
          mogijiProtectedDays: state.user.crewType === "PILOT"
            ? [...(mogijiProtectedDays?.values() || [])]
              .filter(info => info.dayKey.startsWith(firstParsed.month))
            : [],
          crewPublic: firstCrew ? buildCrewPublic(firstCrew.crewComposition, state.user.roleType) : null,
        },
        wanted,
        creditSpent: unlimitedCredits ? 0 : 1,
        status: "active",
      };

      let created = false;
      try {
        const res = await apiFetch(`${API_BASE}/api/posts-create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newPost),
        });
        const data = await res.json().catch(() => ({}));
        if (data.wallet) applyCreditWallet(data.wallet);
        if (!res.ok) {
          showToast(data.error || "스왑 등록 실패 — 다시 시도해주세요.");
          break;
        }
        newPost.creditSpent = Number(data.creditSpent) || 0;
        created = true;
      } catch (e) {
        showToast("스왑 등록 실패 — 네트워크를 확인해주세요.");
        break;
      }

      if (created) {
        state.myPosts.unshift(newPost);
        createdCount++;
      }
      // 스왑 횟수(월/연)는 실제 매칭 성사(상호 수락) 시점에 카운팅 — 등록 시 증가 안 함
    }

    if (createdCount === 0) return;
    state.postDraft = null;
    resetScheduleSelection(false);
    saveState();
    renderAll();
    showToast(unlimitedCredits
      ? `스왑 글 ${createdCount}건 등록 완료 — PRO 크레딧 차감 없음`
      : createdCount > 1
        ? `스왑 글 ${createdCount}건 등록 완료 — ${createdCount}크레딧 차감됨`
        : "스왑 글 등록 완료 — 스왑 등록 탭에서 확인하고 취소할 수 있습니다.");
    if (state.guideFlow === "post") {
      state.guideFlow = null;
      switchTab("swapGuide");
    }
  }

  // 기존 글의 희망 조건만 수정 (오퍼/크레딧 변경 없음)
  async function doUpdatePost() {
    const post = state.myPosts.find(p => p.id === state.editingPostId);
    if (!post) { exitEditPostMode(); return; }
    const wanted = { memo: ($("#postMemo").value || "").trim() };
    try {
      const res = await apiFetch(`${API_BASE}/api/posts-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, deleteToken: post.deleteToken, wanted }),
      });
      if (!res.ok) { showToast("수정 실패 — 다시 시도해주세요."); return; }
    } catch (e) { showToast("수정 실패 — 네트워크 오류"); return; }
    post.wanted = wanted;
    saveState();
    exitEditPostMode();
    renderAll();
    showToast("희망 조건 수정 완료");
  }

  // 등록 버튼 — WARN 항목 있으면 확인 팝업, 없으면 바로 등록
  $("#submitPostButton").addEventListener("click", () => {
    if (state.editingPostId) { doUpdatePost(); return; }
    if (!CREDIT_POLICY.canSpend(state, 1, isPremiumUser())) { showToast("크레딧 부족"); return; }
    // 중복 등록 방지: 일(day) 숫자가 아닌 YYYY-MM-DD 전체 날짜로 활성 글만 비교한다.
    // 구버전 글은 patternName(예: 7/23~7/25)에서 날짜를 복원한다.
    const dupPost = window.CrewSwapPostDates.findDuplicatePost(state.myPosts, [...state.selectedDays]);
    if (dupPost) {
      showToast(`이미 같은 날짜로 등록된 글이 있습니다 (${dupPost.offered.patternName})`);
      return;
    }
    const checks = checkRulesForSelection();
    const warnItems = checks.filter(c => c.status === "WARN");
    if (warnItems.length > 0) {
      const list = $("#warnConfirmList");
      list.innerHTML = warnItems.map(c => `
        <li class="warn-confirm-item">
          <span class="warn-confirm-label">⚠ ${c.label}</span>
          <span class="warn-confirm-detail">${c.detail}</span>
        </li>
      `).join("");
      $("#warnConfirmDialog").showModal();
    } else {
      doSubmitPost();
    }
  });

  // WARN 확인 팝업 — 확인 후 등록
  $("#warnConfirmOk").addEventListener("click", () => {
    $("#warnConfirmDialog").close();
    doSubmitPost();
  });
  $("#warnConfirmCancel").addEventListener("click", () => {
    $("#warnConfirmDialog").close();
  });

  // 임시 저장
  $("#saveDraftButton").addEventListener("click", () => {
    const ss = selectedSchedules();
    if (ss.length === 0) { showToast("먼저 달력에서 패턴을 선택해주세요."); return; }
    state.postDraft = {
      selectedDays: [...state.selectedDays],
      wantedTypes: [...state.wantedTypes],
      wantedTimes: [...state.wantedTimes],
      dateFlex: $("#wantedDateFlex").value,
      includedAirports: $("#includedAirports").value || "",
      excludedAirports: $("#excludedAirports").value || "",
      memo: $("#postMemo").value || "",
      savedAt: new Date().toISOString(),
    };
    saveState();
    showToast("임시 저장 완료 — 나중에 이어서 등록할 수 있습니다.");
  });
  // 요청함 토글
  $$("[data-req-view]").forEach(b => b.onclick = () => {
    $$("[data-req-view]").forEach(x => x.classList.remove("is-active"));
    b.classList.add("is-active");
    state.reqViewMode = b.dataset.reqView;
    state.focusedRequestId = null;   // 받은/보낸 전환 시 알림 필터 해제
    renderRequests();
  });

  // 알림에서 한 건만 보고 있을 때 전체 목록으로 돌아가기
  $("#requestFocusClear")?.addEventListener("click", () => {
    state.focusedRequestId = null;
    renderRequests();
  });

  // 프로필 저장
  $("#profileForm").addEventListener("submit", e => {
    e.preventDefault();
    state.user.airline = $("#airlineInput").value;
    state.user.crewType = $("#crewTypeInput").value;
    state.user.nickname = $("#nicknameInput").value;
    state.user.roleType = $("#roleTypeInput").value;
    state.user.aircraft = $("#aircraftInput").value;
    state.user.base     = $("#baseInput").value;
    state.user.edto        = $("#edtoInput").checked;
    state.user.cat2        = $("#cat2Input").checked;
    state.user.cat3        = $("#cat3Input").checked;
    state.user.realName    = $("#realNameInput").value.trim();
    state.user.employeeId  = $("#employeeIdInput").value.trim();
    state.user.phone       = $("#phoneInput").value.trim();
    if (state.user.crewType === "CABIN") {
      state.user.gender = $("#genderInput").value;
      state.user.hasBroadcastRating = $("#broadcastInput")?.checked || false;
      state.user.languages = ["Japanese","Chinese","Ann_JA","Ann_CA"]
        .filter(k => document.getElementById(k === "Japanese" ? "langJPInput" : k === "Chinese" ? "langCNInput" : k === "Ann_JA" ? "annJAInput" : "annCAInput")?.checked);
    }
    saveState();
    renderAll();
    showToast("내 정보 저장 — 검색 결과가 새 조건으로 갱신됩니다.");
    // 서버 계정에도 반영 (다른 기기 로그인 시 동기화)
    syncProfileToServer();
  });

  // 알림
  // 양도 의향 묻기 dialog
  $("#askCancelButton").addEventListener("click", () => {
    closeGenericModal("askDialog", "askOverlay");
    resetScheduleSelection();
  });
  $("#askSendButton").addEventListener("click", () => sendAskInterest());
  // 스왑 요청 확인 모달
  $("#reqCancelButton")?.addEventListener("click", () => {
    closeGenericModal("reqDialog", "reqOverlay");
    resetScheduleSelection();
  });
  $("#reqConfirmButton")?.addEventListener("click", () => sendSwapRequest());
  // 줄 근무 선택 중 하단 진행 바
  $("#pendingActionCancel")?.addEventListener("click", () => cancelPendingAction());
  $("#pendingActionNext")?.addEventListener("click", () => confirmPendingAction());

  $("#bellButton").addEventListener("click", () => {
    setAlertPanel(true);
    renderAlerts();      // 현재 미읽음 표시(점)를 보여준 뒤
    markAllAlertsRead(); // 확인한 것으로 처리해 배지를 지운다
  });
  $("#releaseNoticeConfirm")?.addEventListener("click", acknowledgeReleaseNotice);
  $("#betaNoticeConfirm")?.addEventListener("click", acknowledgeBetaNotice);
  // 알림창 좌측 배경(backdrop) 클릭 시 닫힘 (우측 상단 X 대체)
  $("#alertBackdrop")?.addEventListener("click", () => setAlertPanel(false));
  document.getElementById("clearAllAlerts")?.addEventListener("click", () => {
    if (!state.alerts.length) return;
    // 공지(사용 안내)는 모두 삭제에서 제외 — 매칭/마감 알림만 비움
    state.alerts = state.alerts.filter(a => a.kind === "announce");
    saveState();
    renderAlerts();
  });
  $$(".alert-filters button").forEach(b => b.onclick = () => {
    $$(".alert-filters button").forEach(x => x.classList.remove("is-active"));
    b.classList.add("is-active");
    state.alertFilter = b.dataset.alert;
    renderAlerts();
  });

  // 뷰 토글 (월/주/리스트) — month/list 구현
  $$("[data-view]").forEach(b => b.onclick = () => {
    $$("[data-view]").forEach(x => x.classList.remove("is-active"));
    b.classList.add("is-active");
    const v = b.dataset.view;
    if (v === "list") renderListView();
    else { renderCalendar(); $("#calendarGrid").style.display = ""; $("#listView")?.remove(); }
  });
}

function renderListView() {
  $("#calendarGrid").style.display = "none";
  let list = document.getElementById("listView");
  if (!list) {
    list = document.createElement("div");
    list.id = "listView";
    list.style.padding = "12px";
    list.style.display = "grid";
    list.style.gap = "8px";
    $("#calendarGrid").after(list);
  }
  list.innerHTML = currentMonthSchedules().map(s => {
    const tod = parseTimeOfDay(s.reportTime);
    return `
      <div style="display:grid;grid-template-columns:60px 80px 1fr auto;gap:12px;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff;align-items:center;">
        <strong>${schedMonthNum(s)}/${s.day} ${isWeekend(s.day)?"(주말)":""}</strong>
        <span class="lg lg-${s.type==="OFF"?"off":s.type==="국내선"?"dom":s.type==="국제선"?"intl":s.type==="LAYOV"?"lay":s.type==="RSV"?"rsv":"stby"}">${s.type}</span>
        <div>
          <strong>${s.title}</strong>
          <span style="margin-left:8px;color:var(--muted);font-size:12px;">${s.dep?`${s.dep}-${s.arr}`:s.layoverAirport||""} ${s.reportTime?`· ${s.reportTime}`:""}</span>
          <div style="font-size:11px;color:var(--muted);">${s.crewComposition||""}</div>
        </div>
        ${tod?`<span class="pill-time-position" style="position:static;">${tod}</span>`:""}
      </div>
    `;
  }).join("") || `<div class="empty-state">스케줄 없음</div>`;
}

/* ====== 10. 초기화 ====== */
state.schedules = createMockSchedules();
state.posts = [];
state.requests = { sent: [], received: [] };
state.alerts = createMockAlerts();
state.savedSearches = createMockSavedSearches();

/* ====== localStorage 영속화 ====== */
const STORAGE_KEY = "jjswap_v1";

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: 4,
      savedAt: new Date().toISOString(),
      sessionToken: state.sessionToken,
      sessionExpiresAt: state.sessionExpiresAt,
      schedules: state.schedules,
      user: state.user,
      credits: state.credits,
      creditMonth: state.creditMonth,
      adCreditsThisMonth: state.adCreditsThisMonth,
      requests: state.requests,
      savedSearches: state.savedSearches,
      currentMonth: state.currentMonth,
      myPosts: state.myPosts,
      postDraft: state.postDraft,
      alerts: state.alerts,
    }));
  } catch (e) { console.warn("저장 실패:", e); }
}

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.v !== 4) return null;  // v3 이하는 서버 계정 도입 전 로컬-only 세션 — 무효화(재로그인 유도)
    if (Array.isArray(d.schedules) && d.schedules.length) state.schedules = d.schedules;
    state.sessionToken = typeof d.sessionToken === "string" ? d.sessionToken : null;
    state.sessionExpiresAt = Number.isFinite(d.sessionExpiresAt) ? d.sessionExpiresAt : null;
    if (!state.sessionToken || (state.sessionExpiresAt && state.sessionExpiresAt <= Date.now())) {
      state.sessionToken = null;
      state.sessionExpiresAt = null;
      if (d.user) d.user.serverAuthed = false;
    }
    const continuityFixes = window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(state.schedules) || 0;
    if (d.user) Object.assign(state.user, d.user);
    // 과거 전원 PRO 베타값은 신뢰하지 않고, 서버가 발급한 이용권 캐시만 임시 인정한다.
    const cachedTrialExpiry = Date.parse(state.user.proExpiresAt || state.user.proTrialExpiresAt || '');
    state.user.isPremium = state.user.proEntitlement === 'lifetime'
      || (['trial', 'legacy'].includes(state.user.proEntitlement) && Number.isFinite(cachedTrialExpiry) && cachedTrialExpiry > Date.now());
    state.user.proTrialAvailable = state.user.proTrialAvailable !== false;
    if (typeof d.credits === "number") state.credits = d.credits;
    if (typeof d.creditMonth === "string") state.creditMonth = d.creditMonth;
    if (typeof d.adCreditsThisMonth === "number") state.adCreditsThisMonth = d.adCreditsThisMonth;
    // 이전 일 단위 충전 데이터는 이번 월 단위 마이그레이션에서 폐기한다.
    if (typeof d.lastCreditAt === "number") state.lastCreditAt = d.lastCreditAt;
    if (d.requests) state.requests = d.requests;
    if (d.savedSearches) state.savedSearches = d.savedSearches;
    if (d.currentMonth) state.currentMonth = d.currentMonth;
    if (Array.isArray(d.myPosts)) state.myPosts = d.myPosts;
    if (d.postDraft) state.postDraft = d.postDraft;
    if (Array.isArray(d.alerts)) {
      state.alerts = d.alerts;
      // 구버전 목업 알림이면 새 공지로 교체
      if (state.alerts.some(a => a.title === "🎯 매칭 후보 등장" || a.title === "⏰ 마감 임박")) {
        state.alerts = createMockAlerts();
      }
      // 공지 안내문 갱신 — 사용 안내·Q&A는 유지하고 업데이트 공지는 최신 1건만 남긴다.
      // 레거시 마이그레이션: id 없던 시절(공지 1개뿐)의 저장분은 "guide"로 간주
      const legacyAnnounces = state.alerts.filter(a => a.kind === "announce" && !a.id);
      if (legacyAnnounces.length === 1) legacyAnnounces[0].id = "guide";
      createMockAlerts().filter(latest => !window.CrewSwapReleaseNotice?.isReleaseAnnouncement(latest)).forEach(latest => {
        const idx = state.alerts.findIndex(a => a.kind === "announce" && a.id === latest.id);
        if (idx >= 0) state.alerts[idx] = { ...state.alerts[idx], ...latest };
        else state.alerts.push(latest);
      });
      state.alerts = window.CrewSwapReleaseNotice?.keepLatestAnnouncement(state.alerts) || state.alerts;
    }

    // 복원된 currentMonth에 데이터가 없으면, 데이터 있는 월 중
    // ① 오늘 날짜 월이 있으면 그쪽, ② 없으면 가장 가까운 미래 월, ③ 그것도 없으면 첫 월
    const monthsWithData = [...new Set(
      state.schedules.map(s => s.month).filter(Boolean)
    )].sort();
    const currentHasData = state.schedules.some(s =>
      (s.month || state.currentMonth) === state.currentMonth
    );
    if (!currentHasData && monthsWithData.length > 0) {
      const todayD = new Date();
      const todayYm = `${todayD.getFullYear()}-${String(todayD.getMonth() + 1).padStart(2, "0")}`;
      const pick = monthsWithData.includes(todayYm)
        ? todayYm
        : (monthsWithData.find(m => m >= todayYm) || monthsWithData[0]);
      console.log(`%c📅 ${state.currentMonth}에 데이터 없음 → ${pick}로 자동 전환 (사용 가능: ${monthsWithData.join(", ")})`,
        "background:#b96c00;color:#fff;padding:3px 8px;border-radius:4px;");
      state.currentMonth = pick;
    }
    if (continuityFixes > 0) saveState();
    return d.savedAt;
  } catch (e) { console.warn("복원 실패:", e); return null; }
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

// 초기 복원 (renderAll 전에 실행)
const restoredAt = loadStateFromStorage();
if (restoredAt) {
  const ago = Math.round((Date.now() - new Date(restoredAt).getTime()) / 60000);
  console.log(`%c💾 이전 세션 복원 (${state.schedules.length}건, ${ago}분 전, 가입:${state.user.hasSignedUp?"O":"X"})`, "background:#157a4a;color:#fff;padding:3px 8px;border-radius:4px;");
  setTimeout(() => { syncFormsFromState(); }, 0);
}
// 가입 안 됐으면 모달 자동 표시
function openGenericModal(dialogId, overlayId) {
  const d = document.getElementById(dialogId);
  const ov = document.getElementById(overlayId);
  if (!d) return;
  d.hidden = false;
  if (ov) ov.hidden = false;
  document.body.classList.add("no-scroll");
}

function closeGenericModal(dialogId, overlayId) {
  const d = document.getElementById(dialogId);
  const ov = document.getElementById(overlayId);
  if (d) d.hidden = true;
  if (ov) ov.hidden = true;
  document.body.classList.remove("no-scroll");
}

function showReleaseNoticeIfNeeded() {
  const api = window.CrewSwapReleaseNotice;
  if (!state.user.hasSignedUp || !state.user.serverAuthed || !api?.shouldShow(localStorage)) return;
  const release = api.current;
  const version = document.getElementById("releaseNoticeVersion");
  const date = document.getElementById("releaseNoticeDate");
  const summary = document.getElementById("releaseNoticeSummary");
  const changes = document.getElementById("releaseNoticeChanges");
  if (version) version.textContent = `v${release.version}`;
  if (date) date.textContent = release.date;
  if (summary) summary.textContent = release.summary;
  if (changes) {
    changes.replaceChildren(...release.changes.map(change => {
      const item = document.createElement("li");
      item.textContent = change;
      return item;
    }));
  }
  openGenericModal("releaseNoticeDialog", "releaseNoticeOverlay");
}

function acknowledgeReleaseNotice() {
  window.CrewSwapReleaseNotice?.markSeen(localStorage);
  closeGenericModal("releaseNoticeDialog", "releaseNoticeOverlay");
}

function queueReleaseNotice() {
  setTimeout(showReleaseNoticeIfNeeded, 450);
}

/* ── 베타 테스트 안내 ────────────────────────────────────────────
   앱에서 스왑이 성사돼도 실제 근무는 교환되지 않는다는 점을 로그인 후
   첫 화면에서 확실히 알린다. '오늘 하루 보지 않기'로 접어둘 수 있고,
   날짜가 바뀌면 다시 뜬다. 정식 출시 때 BETA_NOTICE_ACTIVE만 false로 두면 된다. */
const BETA_NOTICE_ACTIVE = true;
const BETA_NOTICE_KEY = "crewswap_beta_notice_hidden_until";

function showBetaNoticeIfNeeded() {
  if (!BETA_NOTICE_ACTIVE) return;
  if (!state.user.hasSignedUp || !state.user.serverAuthed) return;
  // 업데이트 공지가 떠 있으면 겹치지 않게 그 뒤로 미룬다.
  if (!document.getElementById("releaseNoticeDialog")?.hidden) { setTimeout(showBetaNoticeIfNeeded, 800); return; }
  let hiddenUntil = "";
  try { hiddenUntil = localStorage.getItem(BETA_NOTICE_KEY) || ""; } catch { /* 저장 불가 환경은 매번 표시 */ }
  if (hiddenUntil === todayKeyLocal()) return;
  const check = document.getElementById("betaNoticeHideToday");
  if (check) check.checked = false;
  openGenericModal("betaNoticeDialog", "betaNoticeOverlay");
}

function todayKeyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function acknowledgeBetaNotice() {
  const check = document.getElementById("betaNoticeHideToday");
  if (check?.checked) {
    try { localStorage.setItem(BETA_NOTICE_KEY, todayKeyLocal()); } catch { /* 무시 */ }
  }
  closeGenericModal("betaNoticeDialog", "betaNoticeOverlay");
}

function queueBetaNotice() {
  setTimeout(showBetaNoticeIfNeeded, 700);
}

function openSignupModal() {
  const sp = document.getElementById("signupPanel");
  const ov = document.getElementById("signupOverlay");
  if (!sp || state.user.serverAuthed) return; // 이미 서버 로그인된 사용자만 차단 (마이그레이션 중엔 허용)
  closeLoginModal();
  closeResetModal();
  sp.hidden = false;
  if (ov) ov.hidden = false;
  document.body.classList.add("no-scroll");
}

function closeSignupModal() {
  const sp = document.getElementById("signupPanel");
  const ov = document.getElementById("signupOverlay");
  if (sp) sp.hidden = true;
  if (ov) ov.hidden = true;
  document.body.classList.remove("no-scroll");
}

// 로그인/재설정 모달 표시 헬퍼
function toggleModal(panelId, overlayId, show) {
  const p = document.getElementById(panelId), o = document.getElementById(overlayId);
  if (p) p.hidden = !show;
  if (o) o.hidden = !show;
  document.body.classList.toggle("no-scroll", show);
}
function openLoginModal(prefillEmail) {
  closeSignupModal();
  toggleModal("resetPanel", "resetOverlay", false);
  if (prefillEmail) { const el = document.getElementById("loginEmail"); if (el) el.value = prefillEmail; }
  // 이전에 실패했던 로그인 시도의 빨간 오류 메시지가 남아있다가, 비밀번호
  // 재설정 완료 후 이 창이 다시 열릴 때 "서버 오류"처럼 보이는 문제 방지.
  const st = document.getElementById("loginStatus");
  if (st) { st.textContent = ""; st.style.color = ""; }
  toggleModal("loginPanel", "loginOverlay", true);
}
function closeLoginModal() { toggleModal("loginPanel", "loginOverlay", false); }
function openResetModal() {
  closeLoginModal();
  const st = document.getElementById("resetStatus");
  if (st) { st.textContent = ""; st.style.color = ""; }
  toggleModal("resetPanel", "resetOverlay", true);
}
function closeResetModal() { toggleModal("resetPanel", "resetOverlay", false); }

// 서버 프로필을 state.user에 반영하고 로그인 상태로 전환 (가입/로그인 공통)
function applyLoggedInProfile(email, profile, premiumStatus = null, wallet = null) {
  const p = profile || {};
  const previousEmail = state.user.email || null;
  Object.assign(state.user, {
    email,
    hasSignedUp: true,
    serverAuthed: true,   // 서버 계정으로 인증됨 (구버전 로컬-only 세션과 구분)
    nickname: p.nickname || p.username || state.user.nickname,
    airline: p.airline || state.user.airline,
    crewType: p.crewType || state.user.crewType,
    roleType: p.roleType || state.user.roleType,
    aircraft: p.aircraft || state.user.aircraft,
    base: p.base || state.user.base,
    edto: p.edto ?? state.user.edto,
    cat2: p.cat2 ?? state.user.cat2,
    cat3: p.cat3 ?? state.user.cat3,
    gender: p.gender ?? state.user.gender,
    languages: p.languages ?? state.user.languages,
    hasBroadcastRating: p.hasBroadcastRating ?? state.user.hasBroadcastRating,
    realName: p.realName ?? state.user.realName,
    employeeId: p.employeeId ?? state.user.employeeId,
    phone: p.phone ?? state.user.phone,
  });
  if (premiumStatus) applyPremiumStatus(premiumStatus, false);
  if (wallet) applyCreditWallet(wallet, false);
  // 이 계정으로 이 기기에서 이미 CrewConnex를 불러온 적이 있으면(=같은 이메일로
  // 계속 로그인 상태) 그 스케줄을 유지한다. 그 외(새 기기 첫 로그인, 다른 계정으로
  // 전환)에는 초기 로딩용 데모 스케줄이나 이전 계정 데이터가 남아있지 않도록 비운다.
  if (previousEmail !== email) state.schedules = [];
  resetScheduleSelection(false);
  syncFormsFromState();
  saveState();
  renderAll();
  fetchRequests();
  syncPremiumAlertSettings();
  refreshNativeStoreEntitlement();
  queueReleaseNotice();
  queueBetaNotice();
  pullSchedulesFromServer();
}

// 내 정보 변경을 서버 계정에 반영 (실패해도 로컬은 이미 저장됨)
function syncProfileToServer() {
  if (!state.user.email || !state.user.serverAuthed) return;
  const u = state.user;
  const profile = {
    nickname: u.nickname, airline: u.airline, crewType: u.crewType, roleType: u.roleType,
    aircraft: u.aircraft, base: u.base, edto: u.edto, cat2: u.cat2, cat3: u.cat3,
    gender: u.gender, languages: u.languages, hasBroadcastRating: u.hasBroadcastRating,
    realName: u.realName, employeeId: u.employeeId, phone: u.phone,
  };
  apiFetch(`${API_BASE}/api/user-update`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, profile }),
  }).catch(e => console.warn("프로필 서버 동기화 실패:", e));
}

// ── 내 근무 스케줄 서버 동기화 ────────────────────────────────────
// CrewConnex 불러오기 결과는 기기 로컬에도 저장하지만, 서버(D1)에도 올려서
// 다른 기기·브라우저에서 같은 계정으로 로그인해도 동일하게 보이게 한다.
function syncSchedulesToServer() {
  if (!state.user.email || !state.user.serverAuthed) return;
  apiFetch(`${API_BASE}/api/schedules-sync`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schedules: state.schedules }),
  }).catch(e => console.warn("스케줄 서버 동기화 실패:", e));
}

// 로그인 직후 서버 스케줄을 가져온다. 이 기기에 이미 스케줄이 있으면(같은 계정으로
// 계속 쓰던 기기) 그대로 두고, 없으면(새 기기 첫 로그인) 서버 것으로 채운다.
// 반대로 이 기기에만 있고 서버엔 없으면(이 기능 이전부터 쓰던 기기) 서버로 올려둔다.
async function pullSchedulesFromServer() {
  if (!state.user.email || !state.user.serverAuthed) return;
  try {
    const res = await apiFetch(`${API_BASE}/api/schedules-get`);
    if (!res.ok) return;
    const data = await res.json();
    const serverSchedules = Array.isArray(data.schedules) ? data.schedules : [];
    if (serverSchedules.length > 0 && state.schedules.length === 0) {
      state.schedules = serverSchedules;
      saveState();
      renderAll();
    } else if (serverSchedules.length === 0 && state.schedules.length > 0) {
      syncSchedulesToServer();
    }
  } catch (e) { console.warn("스케줄 서버 조회 실패:", e); }
}

// 로그아웃 — 이 기기 로컬 세션만 종료 (서버 계정·정보는 유지)
function logout() {
  if (!confirm("로그아웃할까요? 이 기기에서만 로그아웃되며 계정 정보는 유지됩니다.")) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  location.reload();
}

function maybeAutoShowSignup() {
  // 서버 계정 인증 안 된 상태면 로그인 화면부터 (구버전 로컬-only 세션은 재로그인 유도)
  if (!state.user.hasSignedUp || !state.user.serverAuthed) openLoginModal(state.user.email || "");
}

// 모든 dialog 닫힐 때 스크롤 잠금 해제

// 스플래시 화면이 있으면 스플래시 종료 후 표시, 없으면 바로 표시
if (!document.getElementById("splashScreen")) {
  setTimeout(maybeAutoShowSignup, 150);
  if (state.user.hasSignedUp && state.user.serverAuthed) { queueReleaseNotice(); queueBetaNotice(); }
}

/* ====== 스플래시 화면 (영상 + 로그인/회원가입) ====== */
(function initSplash() {
  const splash = document.getElementById("splashScreen");
  if (!splash) return;
  const video = splash.querySelector(".splash-video");

  function hideSplash(afterAction) {
    if (splash.dataset.dismissed === "1") { if (afterAction) afterAction(); return; }
    splash.dataset.dismissed = "1";
    splash.classList.add("is-hiding");
    setTimeout(() => {
      splash.remove();
      if (afterAction) afterAction();
    }, 400);
  }

  // 이미 로그인된 사용자에게는 로그인·회원가입 버튼이 필요 없으므로 숨긴다.
  // 다만 앱을 새로 켰을 때는 인트로 영상을 잠깐 보여주고 자동으로 넘어간다.
  // (백그라운드에서 돌아온 경우는 이 스크립트가 다시 실행되지 않으므로 자연히 생략된다.)
  if (state.user.hasSignedUp && state.user.serverAuthed) {
    const buttons = splash.querySelector(".splash-buttons");
    if (buttons) buttons.hidden = true;
    splash.classList.add("is-intro");
    const done = () => hideSplash(() => { queueReleaseNotice(); queueBetaNotice(); });
    // 영상이 짧으면 끝나는 시점에, 길면 INTRO_MS 후에 넘어간다. 재생 실패해도 멈추지 않도록 타이머를 둔다.
    const INTRO_MS = 2200;
    const timer = setTimeout(done, INTRO_MS);
    // 기다리기 싫으면 아무 데나 눌러 바로 넘어갈 수 있게 한다.
    splash.addEventListener("click", () => { clearTimeout(timer); done(); }, { once: true });
    if (video) {
      video.loop = false;
      video.addEventListener("ended", () => { clearTimeout(timer); done(); }, { once: true });
      video.play?.().catch(() => { clearTimeout(timer); done(); });
    }
    return;
  }

  const loginBtn = document.getElementById("splashLoginBtn");
  if (loginBtn) loginBtn.addEventListener("click", () => {
    hideSplash(() => openLoginModal(state.user.email || ""));
  });

  const signupBtn = document.getElementById("splashSignupBtn");
  if (signupBtn) signupBtn.addEventListener("click", () => {
    hideSplash(() => openSignupModal());
  });
})();

// state.user → DOM 폼 동기화 (새로고침 후에도 본인 정보가 폼에 표시되도록)
function syncFormsFromState() {
  const u = state.user;
  const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
  const check = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  // 회원가입 폼
  set("signupNickname", u.nickname);
  set("signupAirline", u.airline);
  set("signupCrewType", u.crewType);
  updateRoleSelectForCrewType("signupCrewType", "signupRole", "signupAircraftLabel", u.roleType);
  set("signupRole", u.roleType);
  set("signupAircraft", u.aircraft);
  set("signupBase", u.base);
  check("signupEdto", u.edto);
  check("signupCat2", u.cat2);
  check("signupCat3", u.cat3);
  // 내 정보 폼
  set("nicknameInput", u.nickname);
  set("airlineInput", u.airline);
  set("crewTypeInput", u.crewType);
  updateRoleSelectForCrewType("crewTypeInput", "roleTypeInput", "aircraftInputLabel", u.roleType);
  set("roleTypeInput", u.roleType);
  set("aircraftInput", u.aircraft);
  set("baseInput", u.base);
  check("edtoInput", u.edto);
  check("cat2Input", u.cat2);
  check("cat3Input", u.cat3);
  // 객실 전용 자격 복원
  if (u.crewType === "CABIN") {
    set("signupGender", u.gender || "F");
    set("genderInput",  u.gender || "F");
    check("signupBroadcast", !!u.hasBroadcastRating);
    check("broadcastInput",  !!u.hasBroadcastRating);
    const langMap = { Japanese:"signupLangJP", Chinese:"signupLangCN", Ann_JA:"signupAnnJA", Ann_CA:"signupAnnCA" };
    const langMapP = { Japanese:"langJPInput", Chinese:"langCNInput", Ann_JA:"annJAInput", Ann_CA:"annCAInput" };
    const langs = u.languages || [];
    Object.entries(langMap).forEach(([k, id]) => check(id, langs.includes(k)));
    Object.entries(langMapP).forEach(([k, id]) => check(id, langs.includes(k)));
  }
  // 개인 연락처 복원
  set("signupRealName",  u.realName   || "");
  set("signupEmployeeId",u.employeeId || "");
  set("signupPhone",     u.phone      || "");
  set("realNameInput",   u.realName   || "");
  set("employeeIdInput", u.employeeId || "");
  set("phoneInput",      u.phone      || "");
}

/* ====== 언어 토글 (KO ↔ EN) — 핵심 라벨만 ====== */
const I18N = {
  KO: {
    "탭.스케줄":"📅 내 근무","탭.찾기":"🔄 스왑하기","탭.등록":"➕ 스왑하기","탭.요청함":"📨 요청","탭.정보":"👤 내 정보",
    "버튼.불러오기":"📥 CrewConnex 불러오기","버튼.삭제":"데이터 삭제",
    "월":"월","주":"주","리스트":"리스트","제목.내스케줄":"내 근무","제목.스왑찾기":"가능한 스왑 보기","제목.스왑등록":"내 스왑 올리기","제목.요청함":"받은/보낸 요청","제목.내정보":"내 정보",
  },
  EN: {
    "탭.스케줄":"📅 My Roster","탭.찾기":"🔄 Swap","탭.등록":"➕ Swap","탭.요청함":"📨 Requests","탭.정보":"👤 Profile",
    "버튼.불러오기":"📥 Import from CrewConnex","버튼.삭제":"Clear data",
    "월":"Month","주":"Week","리스트":"List","제목.내스케줄":"My Roster","제목.스왑찾기":"Available swaps","제목.스왑등록":"Post my swap","제목.요청함":"Requests","제목.내정보":"Profile",
  }
};
state.lang = localStorage.getItem("jjswap_lang") || "KO";

function applyLang() {
  const t = I18N[state.lang] || I18N.KO;
  // 하단 탭 라벨
  const tabMap = { schedule:"탭.스케줄", swapGuide:"탭.찾기", find:"탭.찾기", myPostsManager:"탭.찾기", premiumAlerts:"탭.찾기", post:"탭.등록", requests:"탭.요청함", profile:"탭.정보" };
  document.querySelectorAll(".tab[data-tab]").forEach(b => {
    const k = tabMap[b.dataset.tab];
    if (k && t[k]) b.textContent = t[k];
  });
  // h2 제목들
  const h2Map = { schedule:"제목.내스케줄", find:"제목.스왑찾기", post:"제목.스왑등록", requests:"제목.요청함", profile:"제목.내정보" };
  Object.entries(h2Map).forEach(([id, k]) => {
    const sec = document.getElementById(id);
    const h2 = sec?.querySelector("h2");
    if (h2 && t[k]) h2.textContent = t[k];
  });
  // 헤더 import/삭제 버튼
  const btnImport = document.getElementById("importScheduleButton");
  if (btnImport) btnImport.textContent = t["버튼.불러오기"];
  // view-toggle 월/주/리스트
  document.querySelectorAll("[data-view]").forEach(b => {
    if (b.dataset.view === "month") b.textContent = t["월"];
    if (b.dataset.view === "week") b.textContent = t["주"];
    if (b.dataset.view === "list") b.textContent = t["리스트"];
  });
  // 토글 라벨
  const lbl = document.getElementById("langLabel");
  if (lbl) lbl.textContent = state.lang === "KO" ? "한 / EN" : "EN / 한";
}

renderAll();
bindEvents();
initPullToRefresh();
applyLang();
// '내 정보' 맨 아래 버전 표기 (문의 대응 + 새 빌드 반영 확인용)
(() => {
  const el = document.getElementById("buildStamp");
  if (el) el.textContent = `CrewSwap ${APP_VERSION} · ${APP_RELEASE_DATE}`;
})();
fetchPosts(); // 스왑 찾기 탭 진입 전 포스트 미리 로드
fetchRequests(); // 받은 요청 배지 표시용 미리 로드
refreshPremiumStatus().then(async () => {
  await refreshNativeStoreEntitlement();
  await syncPremiumAlertSettings();
}); // 서버 권한·App Store 구매 확인 후 저장조건 동기화
initNativePushNotifications().catch(error => console.warn('native push init failed:', error));
if (state.user.serverAuthed) pullSchedulesFromServer(); // 이 기기에 스케줄이 없으면 서버(다른 기기에서 불러온 것)에서 채움
startRequestPolling(); // 앱 켜진 동안 새 요청 자동 감지
regenCredits();          // 월 변경·구버전 크레딧 정책 마이그레이션
processExpiredRefunds(); // 마감된 미매칭 글 크레딧 50% 환급 체크
initAppBadge();          // 앱 아이콘 배지 권한 요청 + 초기 표시

// URL 해시 기반 탭 복원 (F5 새로고침 시 현재 탭 유지)
const _hashTab = location.hash.replace("#", "");
const _validTabs = ["schedule", "swapGuide", "find", "myPostsManager", "premiumAlerts", "post", "requests", "profile"];
if (_validTabs.includes(_hashTab)) switchTab(_hashTab);

document.getElementById("langToggle")?.addEventListener("click", () => {
  state.lang = state.lang === "KO" ? "EN" : "KO";
  localStorage.setItem("jjswap_lang", state.lang);
  applyLang();
  renderAll();
});

// 클립보드 즉시 로드 버튼 동작
const quickBtn = document.getElementById("quickClipboardImport");
if (quickBtn) {
  quickBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) { showToast("클립보드가 비어있습니다. CrewConnex에서 v7 먼저 실행하세요."); return; }
      let arr;
      try { arr = JSON.parse(text); }
      catch { showToast("클립보드 내용이 JSON이 아닙니다."); return; }
      if (!Array.isArray(arr) || arr.length === 0) { showToast("스케줄 배열이 아닙니다."); return; }
      if (!arr[0].day || !arr[0].type) { showToast("스케줄 형식이 아닙니다 (day/type 필수)."); return; }
      window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(arr);
      state.schedules = arr;
      resetScheduleSelection(false);
      const monthsAvail = [...new Set(arr.map(s => s.month).filter(Boolean))].sort();
      if (monthsAvail.length > 0 && !monthsAvail.includes(state.currentMonth)) {
        state.currentMonth = monthsAvail[0];
      }
      saveState();
      renderAll();
      const minfo = monthsAvail.length > 1 ? ` (${monthsAvail.length}개월)` : "";
      showToast(`✅ 클립보드에서 ${arr.length}건${minfo} 로드 + 저장. 새로고침해도 유지.`);
    } catch (e) {
      showToast("클립보드 읽기 실패: 브라우저 권한 필요 — F12 콘솔에서 loadRoster() 사용");
      console.error(e);
    }
  });
}

/* ====== 콘솔 헬퍼 (F12 디버그/빠른 로드) ====== */
window.loadRoster = function(json) {
  try {
    const arr = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(arr)) throw new Error("최상위는 배열이어야 함");
    window.CrewSwapScheduleContinuity?.normalizeScheduleContinuity(arr);
    state.schedules = arr;
    resetScheduleSelection(false);
    const monthsAvail = [...new Set(arr.map(s => s.month).filter(Boolean))].sort();
    if (monthsAvail.length > 0 && !monthsAvail.includes(state.currentMonth)) {
      state.currentMonth = monthsAvail[0];
    }
    saveState();
    renderAll();
    console.log(`✅ ${arr.length}건 로드 (월: ${monthsAvail.join(", ") || "단일/미지정"}) + localStorage 저장.`);
    return arr.length;
  } catch (e) {
    console.error('❌ 로드 실패:', e.message);
    console.log('사용법: loadRoster(`[{"day":1,"type":"국내선",...},...]`)');
  }
};

window.dumpRoster = function() {
  const json = JSON.stringify(state.schedules, null, 2);
  console.log(json);
  if (navigator.clipboard) navigator.clipboard.writeText(json).then(() => console.log('📋 클립보드 복사됨'));
  return state.schedules;
};

window.JJ = {
  state, renderAll,
  load: window.loadRoster,
  dump: window.dumpRoster,
  clear: () => { state.schedules = []; resetScheduleSelection(false); renderAll(); console.log('🗑️ 스케줄 삭제됨'); },
  showProfile: () => console.log(state.user),
};

console.log('%c🛠️ CrewSwap 콘솔 헬퍼 활성화', 'background:#F07820;color:#fff;padding:4px 8px;border-radius:4px;font-weight:700;');
console.log('• loadRoster(json)  — JSON 문자열/배열로 스케줄 즉시 로드');
console.log('• dumpRoster()      — 현재 스케줄 JSON 출력 + 클립보드 복사');
console.log('• JJ.clear()        — 스케줄 전체 삭제');
console.log('• JJ.showProfile()  — 내 정보 출력');
console.log('• JJ.state          — 전체 상태 (state.schedules, state.posts, state.user 등)');
