/* ============================================================
   CrewSwap · 기획 프로토타입 v2
   - 양방향 등록, 패턴 띠, 매칭 점수, 룰 자동 계산
   ============================================================ */

/* ====== 1. 상수 ====== */
// 네이티브 앱(Capacitor)에서는 capacitor://localhost 등에서 로드되므로
// Netlify Functions를 절대경로로 호출해야 함. 웹(Netlify 배포)에서는 상대경로로 동작.
// Workers 배포 후 실제 URL로 교체: npx wrangler deploy 실행 후 출력된 URL
const API_BASE = "https://crewswap-api.tae26001.workers.dev";
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

const PILL_CLASS = {
  "OFF":"pill-off", "국내선":"pill-dom", "국제선":"pill-intl",
  "LAYOV":"pill-lay", "RSV":"pill-rsv", "STBY":"pill-stby", "PICK UP":"pill-pickup",
  "ARRIVAL":"pill-arrival",
};
const BAND_CLASS = { "국내선":"dom", "국제선":"", "LAYOV":"lay", "ARRIVAL":"lay" };

const WANTED_TYPE_OPTIONS = ["OFF","국내선","국제선","LAYOV","RSV","STBY","비행(전체)","아무거나"];
// 표시용 라벨 (내부 값은 유지, 화면 텍스트만 명확하게)
const WANTED_TYPE_LABELS = { "비행(전체)": "모든 비행", "아무거나": "전부 (휴무 포함)" };
const wantedTypeLabel = t => WANTED_TYPE_LABELS[t] || t;
// 연속근무 계산 제외 유형 (휴무/휴가)
const NON_DUTY_TYPES = new Set(["OFF","VAC","VAC_A","VAC_P"]);

/* ====== 회사·직군별 룰 (확장 대비) ======
   사용자는 가입 시 airline + crewType 1회 선택 → 본인 룰 자동 적용.
   현재 베타: JEJU_PILOT만 활성. 객실/타사는 추후 추가.
================================================== */
const AIRLINE_LABELS = {
  JEJU: "제주항공", KOREAN: "대한항공", ASIANA: "아시아나",
  TWAY: "티웨이항공", AIRBUSAN: "에어부산", JINAIR: "진에어"
};
const CREWTYPE_LABELS = { PILOT: "조종사", CABIN: "객실 승무원" };

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
  credits: 5,
  currentMonth: (() => {
    const d = new Date(); // 실시간 현재월
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })(),
  selectedDays: new Set(),
  schedules: [],
  posts: [],
  myPosts: [],      // 내가 등록한 글
  postDraft: null,  // 임시 저장된 등록 폼
  editingPostId: null, // 수정 중인 내 글 id (희망 조건만 수정)
  requests: { sent: [], received: [] },
  reqViewMode: "sent",
  alerts: [],
  alertFilter: "all",
  savedSearches: [],
  filters: { direction:"all", types:[], date:"all", time:"all", arrTime:"all", region:"all", layover:"all", airports:[] },
  sortBy: "score",
  wantedTypes: new Set(["OFF"]),
  wantedTimes: new Set(),
  user: {
    hasSignedUp: false,     // 가입 완료 여부 (이 값으로 가입 패널 숨김 결정)
    airline: "JEJU",        // JEJU | KOREAN | ASIANA | TWAY | AIRBUSAN | JINAIR
    crewType: "PILOT",      // PILOT | CABIN
    nickname:"OrangeFlight",
    roleType:"FO_B",
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
  return [
    { kind:"announce", title:"📢 CrewSwap 사용 안내",
      body:"① 내 스케줄 탭에서 스왑할 패턴 선택 → ② 스왑 등록 탭에서 희망 조건 입력 후 등록(1크레딧) → ③ 스왑 찾기 탭에서 상대방 글 확인 · 요청. 가입 시 5크레딧 지급. 비연속 패턴은 각각 1크레딧 차감됩니다.",
      time:"공지" },
  ];
}

function createMockSavedSearches() {
  return [
    { id:"S1", title:"6/13 7C1551 → OFF", meta:"활성 · 알림 1회 받음" },
    { id:"S2", title:"주말 LAYOV → 평일 국내선", meta:"활성 · 알림 0회" },
    { id:"S3", title:"RSV → OFF (날짜 무관)", meta:"활성 · 알림 2회 받음" },
  ];
}

/* ====== 4. 유틸 ====== */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// iOS 핀치 줌 차단 (확대 시 하단 고정바가 떠버리는 문제 방지)
// 더블탭 줌은 CSS touch-action: manipulation 으로 처리 — JS touchend 차단은
// 빠른 연속 탭의 클릭까지 취소해 칩 선택이 씹히므로 사용하지 않음
["gesturestart", "gesturechange", "gestureend"].forEach(evt =>
  document.addEventListener(evt, e => e.preventDefault(), { passive: false })
);

// 공항 코드 입력 — 쉼표/공백 어느 쪽으로 구분해도 인식 (예: "CXR BKI" 또는 "CXR, BKI")
function parseAirportList(str) {
  return (str || "").split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove("is-visible"), 2800);
}

function dayToDate(day) {
  return new Date(`${state.currentMonth}-${String(day).padStart(2,"0")}T00:00:00`);
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
function areConsecCalendarDays(k1, k2) {
  return (new Date(k2) - new Date(k1)) === 86400000;
}

// 월 경계를 넘는 패턴도 포함한 연결 일자 — {day, month}[] 반환
function connectedPatternDaysAllMonths(pid, anchorDay, anchorMonth) {
  const am = anchorMonth || state.currentMonth;
  const anchorSched = state.schedules.find(s => s.day === anchorDay && s.patternId === pid && (s.month || state.currentMonth) === am);
  if (!anchorSched || anchorSched.type === "OFF") return [{ day: anchorDay, month: am }];

  const pidSched = state.schedules
    .filter(s => s.patternId === pid)
    .map(s => ({ ...s, effectiveMonth: s.month || state.currentMonth }))
    .sort((a, b) => a.effectiveMonth < b.effectiveMonth ? -1 : a.effectiveMonth > b.effectiveMonth ? 1 : a.day - b.day);

  const anchorIdx = pidSched.findIndex(s => s.day === anchorDay && s.effectiveMonth === am);
  if (anchorIdx < 0) return [{ day: anchorDay, month: am }];

  let start = anchorIdx, end = anchorIdx;
  while (end < pidSched.length - 1) {
    if (pidSched[end].type === "ARRIVAL") break;
    if (pidSched[end + 1].type === "OFF") break;
    if (!areConsecCalendarDays(dayKey(pidSched[end].day, pidSched[end].effectiveMonth), dayKey(pidSched[end + 1].day, pidSched[end + 1].effectiveMonth))) break;
    end++;
  }
  while (start > 0) {
    if (pidSched[start - 1].type === "ARRIVAL") break;
    if (pidSched[start - 1].type === "OFF") break;
    if (!areConsecCalendarDays(dayKey(pidSched[start - 1].day, pidSched[start - 1].effectiveMonth), dayKey(pidSched[start].day, pidSched[start].effectiveMonth))) break;
    start--;
  }
  return pidSched.slice(start, end + 1).map(s => ({ day: s.day, month: s.effectiveMonth }));
}

function selectPattern(day) {
  const s = getSchedule(day);
  if (!s) return;
  if (s.lockReason) {
    showToast(`이 비행은 SWAP할 수 없습니다 — ${s.lockReason}`);
    return;
  }

  if (s.patternId) {
    const patternKeys = connectedPatternDaysAllMonths(s.patternId, day, state.currentMonth)
      .map(({ day: d, month: m }) => dayKey(d, m));
    const allSelected = patternKeys.every(k => state.selectedDays.has(k));
    if (allSelected) {
      patternKeys.forEach(k => state.selectedDays.delete(k));
    } else {
      patternKeys.forEach(k => state.selectedDays.add(k));
    }
  } else {
    const key = dayKey(day);
    if (state.selectedDays.has(key)) {
      state.selectedDays.delete(key);
    } else {
      state.selectedDays.add(key);
    }
  }

  renderCalendar();
  renderSelection();
  renderRuleCheck();
  syncOfferedSlot();
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

const TYPE_OPTIONS = ["OFF","국내선","국제선","LAYOV","RSV","STBY","PICK UP","ARRIVAL","UNKNOWN"];
const GRADE_OPTIONS = ["","A","B","C"];

function openImportDialog() {
  $("#parsePreview").hidden = true;
  $("#defaultDialogActions").hidden = false;
  $$(".import-mode").forEach(el => { el.hidden = el.id !== "autoMode"; });
  $$(".import-tab").forEach(t => t.classList.toggle("is-active", t.dataset.mode === "auto"));
  openGenericModal("crewDialog", "crewOverlay");
}

function showPreview(schedules) {
  // 월 → 일 순으로 정렬 (다중 월 시 같은 일자가 섞이지 않도록)
  previewSchedules = schedules.slice().sort((a, b) => {
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

function dDayInfo(day) {
  // 마감: 패턴 시작일 기준 영업일 역산 (조종사 D-2 17시 / 객실 D-3)
  const rules = currentRules();
  const bDays = (rules.deadline && rules.deadline.businessDays) || 2;
  const deadlineHour = (rules.deadline && rules.deadline.hour) || 17;
  const start = dayToDate(day);
  const deadline = addBusinessDays(start, -bDays);
  deadline.setHours(deadlineHour, 0, 0, 0);
  const diffMs = deadline - today();
  if (diffMs < 0) return { expired: true, deadlineDate: deadline };
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  return { expired: false, days, hours, deadlineDate: deadline };
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
  const dd = dDayInfo(firstDay);
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

  const deadlineLabel = `신청 마감 (D-${rules.deadline.businessDays} 영업일)`;

  // 방송등급 미보유 → RSV/STBY 불가
  const noBroadcast = !state.user.hasBroadcastRating;
  const rsvStbySelected = ss.some(s => s.type === "RSV" || s.type === "STBY");
  const broadcastFail = noBroadcast && rsvStbySelected;

  // 월/연 스왑 횟수
  const monthlyLimit = rules.swapLimitMonthly || 2;
  const yearlyLimit  = rules.swapLimitYearly  || 12;
  const monthlyUsed  = state.user.monthlySwapUsed || 0;
  const yearlyUsed   = state.user.yearlySwapUsed  || 0;
  const monthlyFail  = monthlyUsed >= monthlyLimit;
  const yearlyFail   = yearlyUsed  >= yearlyLimit;

  // 노선 언어/성별 자격 안내
  const langs = state.user.languages || [];
  const gender = state.user.gender || "F";
  const langLabels = { Japanese:"일본어 전공", Chinese:"중국어 전공", Ann_JA:"일본어 방송", Ann_CA:"중국어 방송" };
  const langStr = langs.length ? langs.map(k => langLabels[k] || k).join(", ") : "없음";
  const genderStr = gender === "M" ? "남성" : "여성";

  return [
    { label: deadlineLabel,
      status: dd.expired ? "FAIL" : dd.days < 1 ? "WARN" : "PASS",
      detail: dd.expired ? "이미 마감 — 등록 불가" : `D-${dd.days} ${dd.hours}h 남음 (${dd.deadlineDate.getMonth()+1}/${dd.deadlineDate.getDate()})`,
      ref: "Swap Guide p.47 — 스왑 신청은 변경 시작일 기준 D-3 영업일 이내에 신청해야 합니다. (예: 수요일 변경일 → 전전주 금요일까지)" },
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
    { label:"잠금 비행",
      status: hasLocked ? "FAIL" : "PASS",
      detail: hasLocked ? "잠금된 비행 포함 — SWAP 불가" : "해당 없음",
      ref: "회사 편조팀 지정 잠금 비행(예: 특별편, 의전, 훈련 비행 등)은 스왑 대상에서 제외됩니다." },
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
    { label:`월 스왑 횟수 (월 ${monthlyLimit}회)`,
      status: monthlyFail ? "FAIL" : (monthlyUsed >= monthlyLimit - 1 ? "WARN" : "PASS"),
      detail: `이번 달 ${monthlyUsed}/${monthlyLimit}회 사용`,
      ref: "Swap Guide p.47 — 스왑은 월 2회, 연 12회를 초과할 수 없습니다. 카운트는 스왑이 실제 성사(상호 수락)된 경우에만 증가합니다." },
    { label:`연 스왑 횟수 (연 ${yearlyLimit}회)`,
      status: yearlyFail ? "FAIL" : (yearlyUsed >= yearlyLimit - 2 ? "WARN" : "PASS"),
      detail: `올해 ${yearlyUsed}/${yearlyLimit}회 사용`,
      ref: "Swap Guide p.47 — 연간 스왑 총 횟수는 12회 한도. 월 한도(2회)와 별도로 적용됩니다." },
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
  const dd = dDayInfo(firstDay);

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
    { label:"신청 마감 (D-2 17시)", status: dd.expired ? "FAIL" : dd.days < 1 ? "WARN" : "PASS",
      detail: dd.expired ? "이미 마감 — 등록 불가" : `D-${dd.days} ${dd.hours}h 남음 (${dd.deadlineDate.getMonth()+1}/${dd.deadlineDate.getDate()} 17시)`,
      ref: "조종사 스왑 신청 마감 — 변경 시작일 기준 2영업일 전(D-2) 17:00까지. 예: 수요일 비행 → 전주 월요일 17시까지. 마감 이후 접수 불가." },
    { label:"월 승무시간 (90h 미만)", status: monthAfter >= 90 ? "FAIL" : monthAfter >= 80 ? "WARN" : "PASS",
      detail:`현재 ${monthAfter.toFixed(1)}h / 90h`,
      ref: "항공법 제46조 및 운항기술기준 — 승무원 월 최대 비행 시간 90시간. 스왑 후 월 승무시간이 90시간을 초과하면 편조 불가. 80시간 이상 시 WARN 처리됩니다." },
    { label:"연속 근무일 (5일 미만)", status: cum.maxConsec >= 6 ? "FAIL" : cum.maxConsec >= 5 ? "WARN" : "PASS",
      detail:`최대 ${cum.maxConsec}일`,
      ref: "항공법 승무기준 — 조종사 연속 근무 한도 5일(OFF 제외). 5일째 WARN, 6일 이상 FAIL. OFF·VAC는 연속 근무일 계산에서 제외됩니다." },
    { label:"특수공항 자격 갱신 비행", status: hasLocked ? "FAIL" : "PASS",
      detail: hasLocked ? "잠금된 비행 포함 — SWAP 불가" : "해당 없음",
      ref: "특수공항 자격 갱신 비행 — TAG(삼성 비공개 공항), HKG(홍콩) 등 특수공항 자격 유지를 위한 정기 비행은 편조팀이 잠금 설정. 잠금된 비행은 스왑 불가." },
    { label:"공휴일/연휴 SWAP 제한", status: blockedHoliday ? "WARN" : "PASS",
      detail: blockedHoliday ? "공휴일 포함 — 회사 정책 추가 확인" : "해당 없음",
      ref: "공휴일·연휴 편조 정책 — 설날·추석 연휴 등 특별 기간은 회사 별도 편조 정책 적용. 스왑 가능 여부를 편조팀에 사전 문의 필요 (070-7420-1756)." },
    { label:"RSV/STBY 부분 SWAP 차단", status: partialRsvStby ? "FAIL" : "PASS",
      detail: partialRsvStby ? "부분 선택 불가 — 패턴 단위" : "해당 없음",
      ref: "RSV·STBY 연속 패턴 단위 스왑 — 연속된 RSV/STBY는 개별 분리 스왑 불가. 인접 RSV/STBY가 있으면 모두 함께 선택해야 합니다." },
  ];
}

/* ====== 7. 매칭 / 점수 ====== */
function matchScore(post) {
  // 필수 통과: 동일 회사 + 동일 직군
  if ((post.airline || "JEJU") !== state.user.airline) return null;
  if ((post.crewType || "PILOT") !== state.user.crewType) return null;

  // 객실: 포지션 무관 매칭 (직책 규정은 룰 체크에서 안내)
  if (state.user.crewType === "CABIN") {
    const dd = dDayInfo(post.deadlineDay);
    const breakdown = {
      roleMatch: 30,
      aircraftMatch: 20,
      qualMatch: 15,
      baseBonus: post.ownerBase === state.user.base ? 10 : 0,
      timeMatch: state.filters.direction === "all" ? 5 : (matchesDirection(post, state.filters.direction) ? 10 : 0),
      deadlineUrgency: !dd.expired ? (dd.days <= 1 ? 10 : dd.days <= 3 ? 6 : 3) : 0,
      ratingBonus: post.ownerRating >= 4.5 ? 5 : 0,
    };
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { total: Math.min(100, total), breakdown, dDay: dd };
  }

  // 조종사: 동일 포지션(기장↔기장, 부기장↔부기장) 필수
  const myPos = state.user.roleType.startsWith("CAPTAIN") ? "CAPTAIN" : "FO";
  const postPos = (post.ownerRole || "").startsWith("CAPTAIN") ? "CAPTAIN" : "FO";
  if (myPos !== postPos) return null;
  // 기종 호환
  let aircraftOK = !post.offered.aircraft || state.user.aircraft === "NG_MAX" || post.offered.aircraft === state.user.aircraft;
  if (!aircraftOK) return null;
  // 자격
  if (post.offered.edto && !state.user.edto) return null;
  if (post.offered.cat3 && !state.user.cat3) return null;

  // 점수 계산 (100 만점)
  const breakdown = {
    roleMatch: 30,           // 동일 등급
    aircraftMatch: aircraftOK ? 20 : 0,
    qualMatch: 15,           // 자격 통과
    baseBonus: post.ownerBase === state.user.base ? 10 : 0,
    timeMatch: 0,            // 시간대 (방향 변환 일치 시)
    deadlineUrgency: 0,
    ratingBonus: post.ownerRating >= 4.5 ? 5 : 0,
  };
  // 마감 임박 시 가중치
  const dd = dDayInfo(post.deadlineDay);
  if (!dd.expired) {
    if (dd.days <= 1) breakdown.deadlineUrgency = 10;
    else if (dd.days <= 3) breakdown.deadlineUrgency = 6;
    else breakdown.deadlineUrgency = 3;
  }
  // 방향 변환 일치
  const dir = state.filters.direction;
  if (dir === "all") breakdown.timeMatch = 5;
  else if (matchesDirection(post, dir)) breakdown.timeMatch = 10;

  const total = Object.values(breakdown).reduce((a,b)=>a+b, 0);
  return { total, breakdown, dDay: dd };
}

function matchesDirection(post, dir) {
  // 내가 원하는 변환 방향과 post.offered ↔ post.wanted 가 부합하는가
  const o = post.offered.type;
  const w = post.wanted.types;
  switch (dir) {
    case "AM_TO_PM": return post.offered && post.wanted.time?.includes("PM");
    case "PM_TO_AM": return post.offered && post.wanted.time?.includes("AM");
    case "FLY_TO_OFF": return ["국내선","국제선","LAYOV"].includes(o) && w.includes("OFF");
    case "OFF_TO_FLY": return o === "OFF" && (w.includes("국내선") || w.includes("국제선") || w.includes("비행(전체)"));
    case "RSV_TO_OFF": return o === "RSV" && w.includes("OFF");
    case "OFF_TO_RSV": return o === "OFF" && w.includes("RSV");
    case "LAY_TO_DOM": return o === "LAYOV" && w.includes("국내선");
    case "INTL_TO_DOM": return o === "국제선" && w.includes("국내선");
    default: return false;
  }
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
    const typeOK = p.wanted.types.includes(myType)
      || p.wanted.types.includes("아무거나")
      || (isFlight && p.wanted.types.includes("비행(전체)"));
    return roleOK && typeOK;
  }).length;
}

/* ====== 8. 렌더링 ====== */
function renderAll() {
  updateBadges();
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
}

function renderCredits() {
  const display = Number.isInteger(state.credits) ? String(state.credits) : state.credits.toFixed(1);
  $("#creditCount").textContent = display;
  if ($("#profileCredits")) $("#profileCredits").textContent = display;
}

function renderMetrics() {
  const c = calcCumulative();
  const hPct = Math.min(100, (c.totalHours / 90) * 100);
  $("#hoursBar").style.width = hPct + "%";
  $("#hoursBar").className = "metric-fill" + (hPct >= 95 ? " danger" : hPct >= 80 ? " warn" : "");
  $("#hoursText").textContent = `${formatHM(c.totalHours * 60)} / 90:00`;

  const isCabinUser = state.user.crewType === "CABIN";
  const rules = currentRules();
  const consecLimit = rules.dutyConsecLimit || (isCabinUser ? 7 : 5);
  const cPct = Math.min(100, (c.maxConsec / consecLimit) * 100);
  $("#consecBar").style.width = cPct + "%";
  $("#consecBar").className = "metric-fill" + (c.maxConsec >= consecLimit ? " danger" : c.maxConsec >= consecLimit - 1 ? " warn" : "");
  $("#consecText").textContent = `${c.maxConsec} / ${consecLimit}일`;

  if (isCabinUser) {
    const monthlyLimit = rules.swapLimitMonthly || 2;
    const yearlyLimit  = rules.swapLimitYearly  || 12;
    const monthlyUsed  = state.user.monthlySwapUsed || 0;
    const yearlyUsed   = state.user.yearlySwapUsed  || 0;
    const sPct = Math.min(100, (monthlyUsed / monthlyLimit) * 100);
    $("#swapBar").style.width = sPct + "%";
    $("#swapBar").className = "metric-fill" + (sPct >= 100 ? " danger" : sPct >= 50 ? " warn" : "");
    const swapLabelEl = document.querySelector(".metric-label[data-swap]");
    if (swapLabelEl) swapLabelEl.textContent = "월 SWAP 횟수";
    $("#swapText").textContent = `${monthlyUsed}/${monthlyLimit}회 · 연 ${yearlyUsed}/${yearlyLimit}`;
  } else {
    const sPct = (state.user.monthlySwapUsed / state.user.monthlySwapLimit) * 100;
    $("#swapBar").style.width = sPct + "%";
    $("#swapBar").className = "metric-fill" + (sPct >= 100 ? " danger" : sPct >= 67 ? " warn" : "");
    $("#swapText").textContent = `${state.user.monthlySwapUsed} / ${state.user.monthlySwapLimit}회`;
  }

  // 다음 마감 (이번 주 내 가장 가까운 패턴 시작일)
  const upcoming = state.schedules.filter(s => s.type !== "OFF" && !s.lockReason)
    .map(s => ({ day:s.day, dd:dDayInfo(s.day) }))
    .filter(x => !x.dd.expired && x.dd.days <= 7)
    .sort((a,b) => a.dd.days - b.dd.days)[0];
  if (upcoming) {
    const monthNum = parseInt(state.currentMonth.split("-")[1]);
    $("#nextDeadline").textContent = `${monthNum}/${upcoming.day} 마감 D-${upcoming.dd.days} ${upcoming.dd.hours}h`;
    $("#nextDeadline").className = "deadline-text" + (upcoming.dd.days >= 3 ? " calm" : "");
  } else {
    $("#nextDeadline").textContent = "임박 마감 없음";
    $("#nextDeadline").className = "deadline-text calm";
  }
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
    if (cum.warnDays.has(day)) cell.classList.add("is-warn-consec");
    if (s?.lockReason) cell.classList.add("is-locked");

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
      pill.className = `schedule-pill ${PILL_CLASS[s.type] || ""} ${s.lockReason?"pill-locked":""}`;
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
  $("#registerSelectionButton").disabled = !has || hasFail;
  $("#registerSelectionButton").title = hasFail
    ? `등록 불가: ${failItems.map(c => c.label).join(", ")}`
    : "";
  $("#clearSelectionButton").disabled = !has;
  if (!has) {
    $("#selectedSummary").className = "empty-state";
    $("#selectedSummary").textContent = "달력에서 패턴을 드래그하거나 클릭하세요.";
    $("#ruleCheck").innerHTML = "";
    return;
  }
  const totalBlockMin = ss.reduce((sum, s) => sum + flightMinutesOf(s), 0);
  const totalDutyMin = ss.reduce((sum, s) => sum + dutyMinutesOf(s), 0);
  const dd = dDayInfo(ss[0].day);
  const ddText = dd.expired ? "마감 지남" : `D-${dd.days} ${dd.hours}h`;

  $("#selectedSummary").className = "";
  $("#selectedSummary").innerHTML = `
    <div class="pattern-summary">
      <strong>${parseInt(state.currentMonth.split("-")[1])}/${ss[0].day}~${parseInt(state.currentMonth.split("-")[1])}/${ss.at(-1).day} · ${ss[0].type} 패턴</strong>
      <div class="meta">
        <span>승무(BLH) <b>${formatHM(totalBlockMin)}</b></span>
        <span>근무 <b>${formatHM(totalDutyMin)}</b></span>
        <span>일수 <b>${ss.length}일</b></span>
        <span>마감 <b>${ddText}</b></span>
      </div>
    </div>
    <div class="selected-list">
      ${ss.map(s => {
        const pair = crewPairingCheck(s);
        return `
        <div class="selected-item">
          <strong>${parseInt(state.currentMonth.split("-")[1])}/${s.day} · ${s.title}</strong>
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
    $("#goToCalendar").onclick = () => switchTab("schedule");
  } else {
    const totalBlock = ss.reduce((sum, s) => sum + flightMinutesOf(s), 0);
    slot.className = "slot-card filled";
    const routes = ss.map(s => s.routeSummary || (s.dep&&s.arr ? `${s.dep}-${s.arr}` : s.layoverAirport ? `LAYOV ${s.layoverAirport}` : s.type)).join(" · ");
    const totalLegs = ss.reduce((sum, s) => sum + (s.legs || (s.dep && s.arr ? 1 : 0)), 0);
    slot.innerHTML = `
      <strong>${parseInt(state.currentMonth.split("-")[1])}/${ss[0].day}~${parseInt(state.currentMonth.split("-")[1])}/${ss.at(-1).day} · ${ss[0].type} 패턴</strong>
      <div>${ss.map(s => s.title).join(" · ")}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">${routes}</div>
      <div class="slot-meta">
        ${ss[0].aircraft ? `<span>${ss[0].aircraft}</span>` : ""}
        ${ss.some(s=>s.requiresEdto) ? `<span>EDTO</span>` : ""}
        ${ss.some(s=>s.requiresCat3) ? `<span>CAT III</span>` : ""}
        <span>승무 ${formatHM(totalBlock)}</span>
        <span>${ss.length}일${totalLegs>ss.length?` · ${totalLegs}leg`:""}</span>
      </div>
    `;
  }
  renderPostFooter();
}

function renderMyPosts() {
  const el = $("#myPostList");
  if (!el) return;
  if (state.myPosts.length === 0) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = state.myPosts.map(p => {
    const rd = p.registeredAt;
    const rdDisplay = (rd && rd.includes('T'))
      ? (() => { const d = new Date(rd); return `${d.getMonth()+1}/${d.getDate()} 등록`; })()
      : (rd || '');
    const statusHtml = p.status === "expired"
      ? `<span class="my-post-status expired">마감됨${p.refunded ? ` · ${(p.creditSpent||1)*0.5}크레딧 환급` : ""}</span>`
      : `<span class="my-post-status done">등록 완료</span>`;
    return `
    <div class="my-post-card">
      <div class="my-post-head">
        <strong>${p.offered.patternName}</strong>
        ${statusHtml}
      </div>
      <div class="my-post-meta">
        <span>${p.offered.type} · ${p.offered.summary || ""}</span>
        <span>희망: ${p.wanted.types.map(wantedTypeLabel).join(" / ")}</span>
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
          <div><dt>희망 조건</dt><dd>${p.wanted.types.map(wantedTypeLabel).join(" / ")}${p.wanted.time?.length ? ` · ${p.wanted.time.join(", ")}` : ""}${p.wanted.excludedAirports?.length ? ` · ${p.wanted.excludedAirports.join("/")} 제외` : ""}</dd></div>
          ${p.wanted.memo ? `<div><dt>메모</dt><dd>${p.wanted.memo}</dd></div>` : ""}
        </dl>
      </details>
      <div class="my-post-btn-row">
        <button class="secondary-button edit-post-button" data-my-post-id="${p.id}">희망 조건 수정</button>
        <button class="cancel-post-button" data-my-post-id="${p.id}">등록 취소 · 크레딧 즉시 환급</button>
      </div>
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
      if (!confirm(`"${post.offered.patternName}" 등록을 취소하고 ${post.creditSpent}크레딧을 환급받겠습니까?`)) return;
      if (post.deleteToken) {
        try {
          await fetch(`${API_BASE}/api/posts-delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: pid, deleteToken: post.deleteToken }),
          });
        } catch (e) { console.warn("posts-delete failed:", e); }
      }
      state.myPosts = state.myPosts.filter(x => x.id !== pid);
      state.credits += post.creditSpent;
      saveState();
      renderMyPosts();
      renderCredits();
      showToast(`등록 취소 완료 — ${post.creditSpent}크레딧 환급됨`);
    };
  });
}

function enterEditPostMode(postId) {
  const post = state.myPosts.find(p => p.id === postId);
  if (!post) return;
  state.editingPostId = postId;
  state.wantedTypes = new Set(post.wanted.types || []);
  state.wantedTimes = new Set(post.wanted.time || []);
  switchTab("post");
  renderWantedChips();
  syncOfferedSlot();
  const dateFlexEl = document.getElementById("wantedDateFlex");
  if (dateFlexEl) dateFlexEl.value = post.wanted.dateFlex || "any";
  const inc = document.getElementById("includedAirports");
  if (inc) inc.value = (post.wanted.includedAirports || []).join(", ");
  const exc = document.getElementById("excludedAirports");
  if (exc) exc.value = (post.wanted.excludedAirports || []).join(", ");
  const memo = document.getElementById("postMemo");
  if (memo) memo.value = post.wanted.memo || "";
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
  const wantedTypeCount = state.wantedTypes.size;
  $("#exposureCount").textContent = exposureCount();
  $("#candidateCount").textContent = candidateCountForOffered();

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
    submitBtn.textContent = "등록하기 · 1크레딧";
    if (existingBanner) existingBanner.remove();
  }

  if (!hasOffered) {
    $("#postRuleCheck").innerHTML = `<h4>회사 룰 사전 체크</h4><p class="hint">달력에서 패턴을 선택하면 룰 체크가 표시됩니다.</p>`;
    submitBtn.disabled = true;
    $("#saveDraftButton").disabled = !hasOffered;
    return;
  }
  if (editing) {
    submitBtn.disabled = wantedTypeCount === 0;
    $("#saveDraftButton").disabled = true;
    $("#postRuleCheck").innerHTML = `<p class="hint">희망 조건 수정 중에는 회사 룰 재검사를 하지 않습니다.</p>`;
    return;
  }
  const checks = checkRulesForSelection();
  const hasFail = checks.some(c => c.status === "FAIL");
  const hasWarn = checks.some(c => c.status === "WARN");
  const canSubmit = hasOffered && wantedTypeCount > 0 && !hasFail;
  submitBtn.disabled = !canSubmit || state.credits < 1;
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

function renderMatches() {
  const list = $("#matchList");
  const items = visiblePosts();
  const airlineLbl = AIRLINE_LABELS[state.user.airline] || state.user.airline;
  const crewLbl = CREWTYPE_LABELS[state.user.crewType] || state.user.crewType;
  const roleLabel = ROLE_LABELS[state.user.roleType] || CABIN_ROLE_LABELS[state.user.roleType] || state.user.roleType;
  const pilotQualStr = state.user.crewType !== "CABIN"
    ? ` · ${state.user.aircraft==="NG_MAX"?"NG+MAX":"NG"}${state.user.edto?" · EDTO":""}${state.user.cat3?" · CAT III":""}` : "";
  $("#matchSummary").textContent = items.length
    ? `${items.length}건의 매칭 가능 글 · 자동 필터: ${airlineLbl} · ${crewLbl} · ${roleLabel}${pilotQualStr}`
    : `현재 조건으로 매칭 가능한 글이 없습니다. (다른 회사·직군·등급/직책 글은 자동 제외)`;
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state">조건을 완화하거나 저장 검색에 등록하면 새 글이 올라올 때 알림을 받을 수 있습니다.</div>`;
    return;
  }
  list.innerHTML = items.map(({post, score}) => {
    const dd = score.dDay;
    const tone = score.total >= 80 ? "" : score.total >= 60 ? "mid" : "low";
    return `
    <article class="match-card">
      <div class="card-head">
        <div>
          <h3>${post.offered.patternName}</h3>
          <p>${post.offered.summary}${post.offered.flightMinutes ? ` · ${(post.offered.flightMinutes/60).toFixed(1)}h` : ""}</p>
          <div class="badges">
            <span class="badge ${post.offered.type==="OFF"?"off":post.offered.type==="국내선"?"dom":post.offered.type==="RSV"?"rsv":""}">${post.offered.type}</span>
            <span class="badge badge-position">Position: ${positionLabel(post.ownerRole)}</span>
            ${post.offered.aircraft ? `<span class="badge">${post.offered.aircraft}</span>` : ""}
            ${post.offered.edto ? `<span class="badge">EDTO</span>` : ""}
            ${post.offered.cat3 ? `<span class="badge">CAT III</span>` : ""}
          </div>
        </div>
        <div class="score-block">
          <div class="score-num ${tone}">${score.total}</div>
          <div class="score-bar"><div class="${tone}" style="width:${Math.min(100,score.total)}%"></div></div>
          <span style="font-size:10px;color:var(--muted);">매칭 점수</span>
        </div>
      </div>

      <div class="bidirectional-display">
        <details class="give-expand">
          <summary>
            <div class="give-summary-row">
              <strong>상대가 내놓음</strong>
              <span class="give-name">${post.offered.patternName}</span>
              <span class="expand-caret">▾</span>
            </div>
          </summary>
          <dl class="offered-detail-dl">
            <div><dt>유형</dt><dd>${post.offered.type}${post.offered.summary ? ` · ${post.offered.summary}` : ""}${post.offered.flightMinutes ? ` · ${(post.offered.flightMinutes/60).toFixed(1)}h` : ""}</dd></div>
            ${post.offered.reportTime ? `<div><dt>check in</dt><dd>${post.offered.reportTime}</dd></div>` : ""}
            ${post.offered.releaseTime ? `<div><dt>check out</dt><dd>${post.offered.releaseTime}</dd></div>` : ""}
            ${post.offered.crewPublic ? `<div><dt>편조</dt><dd>${post.offered.crewPublic}</dd></div>` : ""}
            ${post.offered.aircraft ? `<div><dt>기종</dt><dd>${post.offered.aircraft}${post.offered.edto ? " · EDTO" : ""}${post.offered.cat3 ? " · CAT III" : ""}</dd></div>` : ""}
          </dl>
        </details>
        <div class="arrow">⇄</div>
        <div class="get">
          <strong>상대가 원함</strong>
          ${post.wanted.types.map(wantedTypeLabel).join(" / ")}${post.wanted.time.length ? ` · ${post.wanted.time.join(",")}` : ""}${post.wanted.excludedAirports.length ? ` · ${post.wanted.excludedAirports.join("/")} 제외` : ""}
        </div>
      </div>

      <details class="score-breakdown">
        <summary>매칭 근거 보기 (${score.total}점)</summary>
        <div class="br-grid">
          <div><span>등급 일치</span><b>+${score.breakdown.roleMatch}</b></div>
          <div><span>기종 호환</span><b>+${score.breakdown.aircraftMatch}</b></div>
          <div><span>자격 통과</span><b>+${score.breakdown.qualMatch}</b></div>
          <div><span>같은 베이스</span><b>+${score.breakdown.baseBonus}</b></div>
          <div><span>방향 변환 일치</span><b>+${score.breakdown.timeMatch}</b></div>
          <div><span>마감 임박 가중</span><b>+${score.breakdown.deadlineUrgency}</b></div>
          <div><span>신뢰도 보너스</span><b>+${score.breakdown.ratingBonus}</b></div>
        </div>
      </details>

      <div class="meta-grid">
        <div><span>상대 유형</span><strong>${ROLE_LABELS[post.ownerRole] || CABIN_ROLE_LABELS[post.ownerRole] || post.ownerRole}</strong></div>
        <div><span>신청 마감</span><strong class="${dd.days<=1?"urgent":""}">${dd.expired?"지남":`D-${dd.days} ${dd.hours}h`}</strong></div>
        <div><span>신뢰도</span><strong>★ ${post.ownerRating.toFixed(1)}</strong></div>
        <div><span>관심</span><strong>👀 ${post.watchers}명</strong></div>
      </div>

      <div class="card-actions">
        ${post.contactable === false
          ? `<div class="card-unavailable">이전 버전 글이라 요청할 수 없습니다</div>`
          : `<button class="secondary-button" data-action="ask" data-post="${post.id}">💬 양도 의향 묻기</button>
        <button class="primary-button" data-action="request" data-post="${post.id}">요청하기 · 1크레딧</button>`}
      </div>
    </article>`;
  }).join("");

  list.querySelectorAll("[data-action='request']").forEach(b => b.onclick = () => requestSwap(b.dataset.post));
  list.querySelectorAll("[data-action='ask']").forEach(b => b.onclick = () => {
    const post = state.posts.find(x => x.id === b.dataset.post);
    const dialog = $("#askDialog");
    $("#askDialogTitle").textContent = post
      ? `💬 ${post.offered.patternName} — 의향 묻기`
      : "💬 양도 의향 묻기";
    $("#askMessage").value = "";
    dialog._pendingPostId = b.dataset.post;
    openGenericModal("askDialog", "askOverlay");
  });
}

/* ====== 공유 포스트 API 로드 (Netlify Blobs) ====== */
async function fetchPosts() {
  try {
    const res = await fetch(`${API_BASE}/api/posts-get`);
    if (!res.ok) return;
    const data = await res.json();
    const myIds = new Set(state.myPosts.map(p => p.id));
    const now = Date.now();
    state.posts = (data.posts || [])
      .filter(p => !myIds.has(p.id))
      .map(p => ({
        ...p,
        postedHoursAgo: p.registeredAt
          ? Math.max(0, Math.round((now - new Date(p.registeredAt).getTime()) / 3600000))
          : 0,
      }));
    renderMatches();
  } catch (e) {
    console.warn("fetchPosts error:", e);
  }
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

async function requestSwap(postId) {
  if (state.credits < 1) {
    showToast("크레딧 부족 — 광고를 시청하면 요청권 1장이 지급됩니다.");
    return;
  }
  const p = state.posts.find(x => x.id === postId);
  if (!p) return;
  if (!state.user.email) {
    showToast("이메일 인증 정보가 없어 요청을 보낼 수 없습니다. 다시 가입해주세요.");
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/requests-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postId, type: "request",
        fromEmail: state.user.email, fromNick: state.user.nickname,
        fromBase: state.user.base, fromRole: state.user.roleType,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || "요청 전송 실패 — 다시 시도해주세요.");
      return;
    }
  } catch (e) {
    showToast("요청 전송 실패 — 네트워크 오류");
    return;
  }
  state.credits--;
  saveState();
  renderCredits();
  fetchRequests();
  showToast("요청을 보냈습니다. 상호 수락 전 개인정보는 비공개입니다.");
}

async function fetchMyPosts() {
  if (!state.user.email) return;
  try {
    const res = await fetch(`${API_BASE}/api/posts-get-mine?email=${encodeURIComponent(state.user.email)}`);
    if (!res.ok) { processExpiredRefunds(); return; }
    const data = await res.json();
    const serverPosts = data.posts || [];
    // 서버에 없는(구버전·ownerEmail 미포함) 로컬 전용 글은 보존, 같은 id는 서버 데이터로 갱신
    const localOnly = state.myPosts.filter(p => !serverPosts.some(sp => sp.id === p.id));
    state.myPosts = [...serverPosts, ...localOnly];
    saveState();
    processExpiredRefunds();
    renderMyPosts();
  } catch (e) { console.warn("fetchMyPosts error:", e); processExpiredRefunds(); }
}

// 마감일이 지났는데 매칭되지 않은 내 스왑 글 → 사용 크레딧 50% 자동 환급
function processExpiredRefunds() {
  let refundTotal = 0, count = 0;
  state.myPosts.forEach(p => {
    if (p.refunded || p.matched || p.status === "expired") return;
    const dd = dDayInfo(p.deadlineDay);
    if (dd.expired) {
      const refund = (p.creditSpent || 1) * 0.5;
      state.credits += refund;
      p.refunded = true;
      p.status = "expired";
      refundTotal += refund;
      count++;
    }
  });
  if (count > 0) {
    state.credits = Math.round(state.credits * 10) / 10;
    saveState();
    renderCredits();
    renderMyPosts();
    showToast(`마감된 미매칭 스왑 ${count}건 — 크레딧 ${refundTotal} 환급(50%)`);
  }
}

async function fetchRequests() {
  if (!state.user.email) return;
  try {
    const res = await fetch(`${API_BASE}/api/requests-get?email=${encodeURIComponent(state.user.email)}`);
    if (!res.ok) return;
    const data = await res.json();
    const ago = (iso) => {
      const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
      if (mins < 1) return "방금";
      if (mins < 60) return `${mins}분 전`;
      return `${Math.round(mins / 60)}시간 전`;
    };
    state.requests.sent = (data.sent || []).map(r => ({ ...r, sentAgo: ago(r.createdAt), nickname: r.toNick, base: r.base })).reverse();
    state.requests.received = (data.received || []).map(r => ({ ...r, sentAgo: ago(r.createdAt), nickname: r.fromNick, base: r.fromBase })).reverse();
    renderRequests();
  } catch (e) { console.warn("fetchRequests error:", e); }
}

function renderSavedSearches() {
  $("#savedList").innerHTML = state.savedSearches.length
    ? state.savedSearches.map(s => `
        <div class="saved-item">
          <button class="saved-del" data-id="${s.id}" title="삭제">×</button>
          <strong>${s.title}</strong>
          <span class="saved-meta">${s.meta}</span>
        </div>
      `).join("")
    : `<span class="hint">저장된 검색 없음 — 자주 찾는 조건을 저장하면 새 글 알림을 받습니다.</span>`;
  $$(".saved-del").forEach(b => b.onclick = () => {
    state.savedSearches = state.savedSearches.filter(s => s.id !== b.dataset.id);
    renderSavedSearches();
  });
}

function renderRequests() {
  const reqs = state.requests[state.reqViewMode];
  $("#requestList").innerHTML = reqs.length ? reqs.map(r => requestCard(r)).join("") : `<div class="empty-state">${state.reqViewMode==="sent"?"보낸":"받은"} 요청이 없습니다.</div>`;
  $$("#requestList .accept-req-btn").forEach(b => b.onclick = () => acceptRequest(b.dataset.reqId));
}

function requestCard(r) {
  // 3단계 구조 — 베이스/닉네임은 항상 공개, 실명/사번/연락처만 상호수락 후 공개
  const stages = [
    { icon:"📩", label:"요청 발송" },
    { icon:"✓",  label:"상호 수락" },
    { icon:"📞", label:"회사 상신" },
  ];
  // 기존 stage 1~4를 새로운 1~3으로 매핑: 1→1, 2→1, 3→2, 4→3
  const newStage = r.stage >= 4 ? 3 : r.stage >= 3 ? 2 : 1;
  const stagesHtml = stages.map((s, i) => {
    const cls = (i+1) < newStage ? "done" : (i+1) === newStage ? "current" : "";
    return `<div class="step ${cls}"><span class="step-icon">${s.icon}</span>${s.label}</div>`;
  }).join("");
  const badgeCls = newStage >= 2 ? "accepted" : "";
  const accepted = newStage >= 2;

  return `
    <article class="request-card">
      <div class="card-head">
        <div>
          <h3>${r.postTitle}</h3>
          <p>${state.reqViewMode==="sent"?"내가 보냄":"내가 받음"} · ${r.sentAgo}</p>
        </div>
        <span class="badge ${badgeCls}">${r.status}</span>
      </div>
      ${r.message ? `<div class="notice" style="margin-bottom:10px;">💬 ${r.message}</div>` : ""}
      ${r.type === "ask" ? "" : `<div class="privacy-stepper">${stagesHtml}</div>`}
      <div class="disclosed-info">
        <h4>공개 정보</h4>
        <div class="info-row"><span>직책/등급</span><strong>${ROLE_LABELS[r.postOwnerRole || r.requesterRole]}</strong></div>
        <div class="info-row"><span>기종/자격</span><strong>${r.aircraft} / ${r.quals}</strong></div>
        <div class="info-row"><span>베이스</span><strong>${r.base && r.base !== "비공개" ? r.base : "GMP"}</strong></div>
        <div class="info-row"><span>닉네임</span><strong>${r.nickname && r.nickname !== "비공개" ? r.nickname : "(상대 닉네임)"}</strong></div>
        <div class="info-row"><span>실명/사번/연락처</span><strong class="${!accepted?"locked":""}">${accepted ? "✓ 상호 수락 — 회사 상신 단계에서 양측에 공개" : "🔒 상호 수락 후 공개"}</strong></div>
      </div>
      ${accepted ? (() => {
        const rules = currentRules();
        const menu = rules.submitMenu || "회사 시스템 → 스케줄 변경 신청";
        const contact = rules.submitContact || "회사 운항편조팀";
        const deadline = rules.deadline ? `D-${rules.deadline.businessDays}일 ${rules.deadline.hour}시까지` : "회사 마감 시각까지";
        return `
        <div class="submit-guide">
          <h4>📋 회사 상신 방법 (${rules.label || "회사 시스템"})</h4>
          <ol>
            <li><strong>${menu}</strong> 메뉴 접속</li>
            <li>본인과 상대방 정보, 변경 일자/패턴 입력</li>
            <li>변경 시작일 <strong>${deadline}</strong> 신청서 작성·제출</li>
            <li>승인/반려 여부는 회사 시스템 알림으로 확인</li>
          </ol>
          <p class="hint">📞 문의: ${contact}</p>
        </div>`;
      })() : `
        <p class="hint">실제 SWAP 가능 여부는 상호 수락 후 회사 J-CREW 시스템 신청을 통해 최종 확정됩니다.</p>
      `}
      ${(state.reqViewMode === "received" && r.type !== "ask" && !accepted)
        ? `<button class="primary-button accept-req-btn" data-req-id="${r.id}" style="width:100%;margin-top:12px;">✓ 상호 수락하기</button>`
        : ""}
    </article>
  `;
}

async function acceptRequest(reqId) {
  if (!state.user.email) { showToast("이메일 인증 정보가 없습니다."); return; }
  try {
    const res = await fetch(`${API_BASE}/api/requests-accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reqId, email: state.user.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || "수락 실패 — 다시 시도해주세요."); return; }
  } catch (e) { showToast("수락 실패 — 네트워크 오류"); return; }
  recordSwapMatch();
  showToast("상호 수락 완료 — 회사 상신 단계로 진행하세요.");
  fetchRequests();
}

function renderAlerts() {
  const filter = state.alertFilter;
  const allIndexed = state.alerts.map((a, i) => ({ a, i }));
  const items = filter === "all" ? allIndexed : allIndexed.filter(x => x.a.kind === filter);
  $("#alertList").innerHTML = items.length ? items.map(({ a, i }) => `
    <div class="alert-item ${a.kind}">
      <button class="alert-del-btn" data-alert-idx="${i}" title="삭제">×</button>
      <strong>${a.title}</strong>
      <p>${a.body}</p>
      <span class="time">${a.time}</span>
    </div>
  `).join("") : `<div class="empty-state">알림이 없습니다.</div>`;
  $$("#alertList .alert-del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.alerts.splice(parseInt(btn.dataset.alertIdx, 10), 1);
      saveState();
      renderAlerts();
    });
  });
  $("#bellBadge").textContent = state.alerts.length;
  $("#bellBadge").style.display = state.alerts.length ? "grid" : "none";
}

/* ====== 9. 이벤트 ====== */
function switchTab(name) {
  $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.tab === name));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.id === name));
  if (name === "find") fetchPosts();
  if (name === "requests") fetchRequests();
  if (name === "post") fetchMyPosts();
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

function bindEvents() {
  $$(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));

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
  let _verifyCooldown = null; // 재발송 쿨다운 타이머 ID

  function setVerifyStatus(msg, type) {
    // type: "ok" | "err" | "hint"
    const el = $("#verifyStatus");
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === "ok" ? "var(--c-pass)" : type === "err" ? "var(--c-fail)" : "var(--muted)";
  }

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
      const res = await fetch(`${API_BASE}/api/send-verify`, {
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
      if (data.testMode && data.code) {
        // 테스트 모드: 코드를 입력란에 자동 입력 (이메일 미발송)
        $("#verifyCodeInput").value = data.code;
        setVerifyStatus("이메일 발송 미설정 — 인증 코드가 자동 입력됐습니다. 아래 '인증 확인'을 눌러주세요.", "hint");
      } else {
        setVerifyStatus(`${email} 으로 코드를 발송했습니다. 10분 이내 입력해주세요.`, "hint");
      }
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
      const res = await fetch(`${API_BASE}/api/check-verify`, {
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

  // ── 가입 폼 제출 ──────────────────────────────────────────────
  $("#signupForm").addEventListener("submit", e => {
    e.preventDefault();
    if (!_verifyEmail) {
      setVerifyStatus("회사 이메일 인증을 완료해주세요.", "err");
      $("#signupEmail").focus();
      return;
    }
    state.user.airline = $("#signupAirline").value;
    state.user.crewType = $("#signupCrewType").value;
    state.user.nickname = $("#signupNickname").value;
    state.user.roleType = $("#signupRole").value;
    state.user.aircraft = $("#signupAircraft").value;
    state.user.base     = $("#signupBase").value;
    state.user.edto     = $("#signupEdto").checked;
    state.user.cat2     = $("#signupCat2").checked;
    state.user.cat3     = $("#signupCat3").checked;
    // 객실 전용
    if (state.user.crewType === "CABIN") {
      state.user.gender = $("#signupGender").value;
      state.user.hasBroadcastRating = $("#signupBroadcast")?.checked || false;
      state.user.languages = ["Japanese","Chinese","Ann_JA","Ann_CA"]
        .filter(k => document.getElementById(`signup${k === "Japanese" ? "LangJP" : k === "Chinese" ? "LangCN" : k === "Ann_JA" ? "AnnJA" : "AnnCA"}`)?.checked);
    }
    state.user.email    = _verifyEmail;   // 인증된 이메일 저장
    state.user.hasSignedUp = true;
    // 프로필 폼 동기화 (crewType 포함)
    $("#nicknameInput").value = state.user.nickname;
    const crewTypeInputEl = document.getElementById("crewTypeInput");
    if (crewTypeInputEl) {
      crewTypeInputEl.value = state.user.crewType;
      updateRoleSelectForCrewType("crewTypeInput", "roleTypeInput", "aircraftInputLabel", state.user.roleType);
    }
    $("#roleTypeInput").value = state.user.roleType;
    $("#aircraftInput").value = state.user.aircraft;
    $("#baseInput").value     = state.user.base;
    $("#edtoInput").checked   = state.user.edto;
    $("#cat2Input").checked   = state.user.cat2;
    $("#cat3Input").checked   = state.user.cat3;
    const sp = document.getElementById("signupPanel");
    closeSignupModal();
    saveState();
    renderAll();
    showToast("가입 완료 · 무료 크레딧 5장 지급. Welcome to CrewSwap!");
  });

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
      const resp = await fetch(`${API_BASE}/api/crewconnex`, {
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
    state.schedules = finalSchedules;
    state.selectedDays.clear();
    // 현재 월에 데이터가 있는지 확인, 없으면 데이터가 있는 첫 월로 자동 전환
    const monthsAvail = [...new Set(finalSchedules.map(s => s.month).filter(Boolean))].sort();
    if (monthsAvail.length > 0 && !monthsAvail.includes(state.currentMonth)) {
      state.currentMonth = monthsAvail[0];
    }
    saveState();
    closeGenericModal("crewDialog", "crewOverlay");
    renderAll();
    const monthInfo = monthsAvail.length > 1 ? ` (${monthsAvail.length}개월: ${monthsAvail.join(", ")})` : "";
    const navHint = monthsAvail.length > 1 ? " 상단 월 칩으로 빠른 전환 가능." : " ‹ › 버튼으로 월 이동.";
    showToast(`스케줄 ${finalSchedules.length}건 적용${monthInfo}.${navHint}`);
  });

  document.getElementById("withdrawButton")?.addEventListener("click", async () => {
    if (!confirm("탈퇴하면 스케줄·크레딧·등록된 스왑 글이 모두 삭제됩니다.\n정말 탈퇴하시겠습니까?")) return;
    // 서버에 올린 내 포스트 모두 삭제
    const toDelete = state.myPosts.filter(p => p.deleteToken);
    await Promise.allSettled(
      toDelete.map(p => fetch(`${API_BASE}/api/posts-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, deleteToken: p.deleteToken }),
      }).catch(e => console.warn("posts-delete failed:", e)))
    );
    // 로컬 초기화
    state.selectedDays.clear();
    state.schedules = [];
    state.myPosts = [];
    state.requests = { sent: [], received: [] };
    state.alerts = createMockAlerts();
    state.credits = 5;
    state.user = {
      hasSignedUp: false, airline: "JEJU", crewType: "PILOT",
      nickname: "OrangeFlight", roleType: "FO_B", aircraft: "NG_MAX",
      edto: true, cat2: false, cat3: true, base: "GMP", rating: 4.8,
      monthlySwapUsed: 0, monthlySwapLimit: 3, yearlySwapUsed: 0,
    };
    clearStorage();
    renderAll();
    // 가입 팝업 다시 표시
    const sp = document.getElementById("signupPanel");
    openSignupModal();
    showToast("탈퇴 처리가 완료됐습니다.");
  });

  $("#clearSelectionButton").addEventListener("click", () => {
    state.selectedDays.clear();
    renderCalendar(); renderSelection(); renderRuleCheck(); syncOfferedSlot();
  });
  $("#registerSelectionButton").addEventListener("click", () => switchTab("post"));

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
    const allDayKeys = [...state.selectedDays].sort();
    if (allDayKeys.length === 0) return;

    const groups = [];
    let cur = [allDayKeys[0]];
    for (let i = 1; i < allDayKeys.length; i++) {
      if (areConsecCalendarDays(allDayKeys[i - 1], allDayKeys[i])) {
        cur.push(allDayKeys[i]);
      } else {
        groups.push(cur);
        cur = [allDayKeys[i]];
      }
    }
    groups.push(cur);

    const needed = groups.length;
    if (state.credits < needed) {
      showToast(`크레딧 부족 (필요: ${needed}개, 보유: ${state.credits}개)`);
      return;
    }

    const wanted = {
      types: [...state.wantedTypes],
      time: [...state.wantedTimes],
      dateFlex: $("#wantedDateFlex").value,
      includedAirports: parseAirportList($("#includedAirports").value),
      excludedAirports: parseAirportList($("#excludedAirports").value),
      memo: $("#postMemo").value || "",
    };

    for (const keyGroup of groups) {
      const ss = keyGroup.map(key => {
        const { day, month } = parseDayKey(key);
        return state.schedules.find(s => s.day === day && (s.month || state.currentMonth) === month);
      }).filter(Boolean);
      if (ss.length === 0) continue;
      const firstParsed = parseDayKey(keyGroup[0]);
      const lastParsed = parseDayKey(keyGroup[keyGroup.length - 1]);
      const fm = parseInt(firstParsed.month.split('-')[1]);
      const lm = parseInt(lastParsed.month.split('-')[1]);

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
        deadlineDay: ss[0].day,
        watchers: 0,
        offered: {
          patternName: `${fm}/${firstParsed.day}${keyGroup.length > 1 ? `~${fm !== lm ? lm + "/" : ""}${lastParsed.day}` : ""} · ${ss[0].type} 패턴`,
          days: keyGroup.map(k => parseDayKey(k).day),
          summary: ss.map(s => s.routeSummary || (s.dep&&s.arr?`${s.dep}-${s.arr}`:s.type)).join(" · "),
          type: ss[0].type,
          aircraft: ss[0].aircraft || null,
          edto: ss.some(s=>s.requiresEdto),
          cat3: ss.some(s=>s.requiresCat3),
          flightMinutes: ss.reduce((sum,s)=>sum+flightMinutesOf(s),0),
          region,
          reportTime: firstFlight ? firstFlight.reportTime : null,
          releaseTime: lastFlight ? lastFlight.releaseTime : null,
          crewPublic: firstCrew ? buildCrewPublic(firstCrew.crewComposition, state.user.roleType) : null,
        },
        wanted,
        creditSpent: 1,
        status: "active",
      };

      try {
        const res = await fetch(`${API_BASE}/api/posts-create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newPost),
        });
        if (!res.ok) console.warn("posts-create failed:", await res.json().catch(() => ({})));
      } catch (e) {
        console.warn("posts-create network error:", e);
      }

      state.myPosts.unshift(newPost);
      state.credits--;
      // 스왑 횟수(월/연)는 실제 매칭 성사(상호 수락) 시점에 카운팅 — 등록 시 증가 안 함
    }

    state.postDraft = null;
    state.selectedDays.clear();
    saveState();
    renderAll();
    showToast(needed > 1
      ? `스왑 글 ${needed}건 등록 완료 — ${needed}크레딧 차감됨`
      : "스왑 글 등록 완료 — 스왑 등록 탭에서 확인하고 취소할 수 있습니다.");
  }

  // 기존 글의 희망 조건만 수정 (오퍼/크레딧 변경 없음)
  async function doUpdatePost() {
    const post = state.myPosts.find(p => p.id === state.editingPostId);
    if (!post) { exitEditPostMode(); return; }
    const wanted = {
      types: [...state.wantedTypes],
      time: [...state.wantedTimes],
      dateFlex: $("#wantedDateFlex").value,
      includedAirports: parseAirportList($("#includedAirports").value),
      excludedAirports: parseAirportList($("#excludedAirports").value),
      memo: $("#postMemo").value || "",
    };
    try {
      const res = await fetch(`${API_BASE}/api/posts-update`, {
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
    if (state.credits < 1) { showToast("크레딧 부족"); return; }
    // 중복 등록 방지: 선택한 날짜가 이미 내 게시글에 있는지 확인
    const selectedDayNums = [...state.selectedDays].map(k => parseDayKey(k).day);
    const dupPost = state.myPosts.find(p => p.offered.days.some(d => selectedDayNums.includes(d)));
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
  ["watchAdButton","watchAdButtonProfile"].forEach(id => {
    const el = $("#"+id);
    if (!el) return;
    el.addEventListener("click", () => {
      state.credits++;
      renderCredits();
      showToast("📺 광고 시청 완료 — 등록권 1장 지급 (24시간 내 사용)");
    });
  });

  // 요청함 토글
  $$("[data-req-view]").forEach(b => b.onclick = () => {
    $$("[data-req-view]").forEach(x => x.classList.remove("is-active"));
    b.classList.add("is-active");
    state.reqViewMode = b.dataset.reqView;
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
    state.user.edto     = $("#edtoInput").checked;
    state.user.cat2     = $("#cat2Input").checked;
    state.user.cat3     = $("#cat3Input").checked;
    if (state.user.crewType === "CABIN") {
      state.user.gender = $("#genderInput").value;
      state.user.hasBroadcastRating = $("#broadcastInput")?.checked || false;
      state.user.languages = ["Japanese","Chinese","Ann_JA","Ann_CA"]
        .filter(k => document.getElementById(k === "Japanese" ? "langJPInput" : k === "Chinese" ? "langCNInput" : k === "Ann_JA" ? "annJAInput" : "annCAInput")?.checked);
    }
    saveState();
    renderAll();
    showToast("내 정보 저장 — 검색 결과가 새 조건으로 갱신됩니다.");
  });

  // 알림
  // 양도 의향 묻기 dialog
  $("#askCancelButton").addEventListener("click", () => closeGenericModal("askDialog", "askOverlay"));
  $("#askSendButton").addEventListener("click", async () => {
    const msg = $("#askMessage").value.trim();
    if (!msg) { showToast("메시지를 입력해주세요."); return; }
    if (!state.user.email) { showToast("이메일 인증 정보가 없어 보낼 수 없습니다."); return; }
    const postId = $("#askDialog")._pendingPostId;
    try {
      const res = await fetch(`${API_BASE}/api/requests-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId, type: "ask", message: msg,
          fromEmail: state.user.email, fromNick: state.user.nickname,
          fromBase: state.user.base, fromRole: state.user.roleType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || "전송 실패 — 다시 시도해주세요."); return; }
    } catch (e) { showToast("전송 실패 — 네트워크 오류"); return; }
    closeGenericModal("askDialog", "askOverlay");
    fetchRequests();
    showToast("💬 의향 문의 발송 완료 — 상대가 확인하면 알림이 옵니다.");
  });

  $("#bellButton").addEventListener("click", () => {
    $("#alertPanel").hidden = false;
  });
  $("#closeAlerts").addEventListener("click", () => {
    $("#alertPanel").hidden = true;
  });
  document.getElementById("clearAllAlerts")?.addEventListener("click", () => {
    if (!state.alerts.length) return;
    state.alerts = [];
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
        <strong>${parseInt(state.currentMonth.split("-")[1])}/${s.day} ${isWeekend(s.day)?"(주말)":""}</strong>
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
      v: 3,
      savedAt: new Date().toISOString(),
      schedules: state.schedules,
      user: state.user,
      credits: state.credits,
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
    if (d.v !== 3) return null;  // v1/v2는 스왑 카운트 오염 가능 — 무효화
    if (Array.isArray(d.schedules) && d.schedules.length) state.schedules = d.schedules;
    if (d.user) Object.assign(state.user, d.user);
    if (typeof d.credits === "number") state.credits = d.credits;
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

function openSignupModal() {
  const sp = document.getElementById("signupPanel");
  const ov = document.getElementById("signupOverlay");
  if (!sp || state.user.hasSignedUp) return;
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

function maybeAutoShowSignup() {
  if (!state.user.hasSignedUp) openSignupModal();
}

// 모든 dialog 닫힐 때 스크롤 잠금 해제

// 스플래시 화면이 있으면 스플래시 종료 후 표시, 없으면 바로 표시
if (!document.getElementById("splashScreen")) {
  setTimeout(maybeAutoShowSignup, 150);
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

  // 이미 가입된 사용자 — 새로고침/재방문 시 스플래시 없이 바로 현재 화면 유지
  if (state.user.hasSignedUp) {
    hideSplash();
    return;
  }

  const loginBtn = document.getElementById("splashLoginBtn");
  if (loginBtn) loginBtn.addEventListener("click", () => {
    hideSplash(() => {
      if (!state.user.hasSignedUp) {
        showToast("가입 기록이 없습니다 — 회원가입을 진행해주세요.");
        maybeAutoShowSignup();
      }
    });
  });

  const signupBtn = document.getElementById("splashSignupBtn");
  if (signupBtn) signupBtn.addEventListener("click", () => {
    hideSplash(() => {
      if (state.user.hasSignedUp) {
        showToast("이미 가입된 회원입니다 — 자동으로 로그인됩니다.");
      } else {
        maybeAutoShowSignup();
      }
    });
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
}

/* ====== 언어 토글 (KO ↔ EN) — 핵심 라벨만 ====== */
const I18N = {
  KO: {
    "탭.스케줄":"📅 내 스케줄","탭.찾기":"🔍 스왑 찾기","탭.등록":"➕ 스왑 등록","탭.요청함":"📨 요청함","탭.정보":"👤 내 정보",
    "버튼.불러오기":"📥 CrewConnex 불러오기","버튼.삭제":"데이터 삭제",
    "월":"월","주":"주","리스트":"리스트","제목.내스케줄":"내 스케줄","제목.스왑찾기":"스왑 찾기","제목.스왑등록":"스왑 등록","제목.요청함":"요청함","제목.내정보":"내 정보",
  },
  EN: {
    "탭.스케줄":"📅 My Schedule","탭.찾기":"🔍 Find Swap","탭.등록":"➕ Post Swap","탭.요청함":"📨 Requests","탭.정보":"👤 Profile",
    "버튼.불러오기":"📥 Import from CrewConnex","버튼.삭제":"Clear data",
    "월":"Month","주":"Week","리스트":"List","제목.내스케줄":"My Schedule","제목.스왑찾기":"Find Swap","제목.스왑등록":"Post Swap","제목.요청함":"Requests","제목.내정보":"Profile",
  }
};
state.lang = localStorage.getItem("jjswap_lang") || "KO";

function applyLang() {
  const t = I18N[state.lang] || I18N.KO;
  // 하단 탭 라벨
  const tabMap = { schedule:"탭.스케줄", find:"탭.찾기", post:"탭.등록", requests:"탭.요청함", profile:"탭.정보" };
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
applyLang();
fetchPosts(); // 스왑 찾기 탭 진입 전 포스트 미리 로드
processExpiredRefunds(); // 마감된 미매칭 글 크레딧 50% 환급 체크

// URL 해시 기반 탭 복원 (F5 새로고침 시 현재 탭 유지)
const _hashTab = location.hash.replace("#", "");
const _validTabs = ["schedule", "find", "post", "requests", "profile"];
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
      state.schedules = arr;
      state.selectedDays.clear();
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
    state.schedules = arr;
    state.selectedDays.clear();
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
  clear: () => { state.schedules = []; state.selectedDays.clear(); renderAll(); console.log('🗑️ 스케줄 삭제됨'); },
  showProfile: () => console.log(state.user),
};

console.log('%c🛠️ CrewSwap 콘솔 헬퍼 활성화', 'background:#F07820;color:#fff;padding:4px 8px;border-radius:4px;font-weight:700;');
console.log('• loadRoster(json)  — JSON 문자열/배열로 스케줄 즉시 로드');
console.log('• dumpRoster()      — 현재 스케줄 JSON 출력 + 클립보드 복사');
console.log('• JJ.clear()        — 스케줄 전체 삭제');
console.log('• JJ.showProfile()  — 내 정보 출력');
console.log('• JJ.state          — 전체 상태 (state.schedules, state.posts, state.user 등)');

