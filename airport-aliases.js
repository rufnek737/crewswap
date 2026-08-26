(function (root) {
  "use strict";

  // CrewSwap에서 실제로 사용하는 국내선 및 주요 국제선 공항.
  // 각 항목은 IATA, ICAO, 영문 공항명/도시명, 한글명을 하나의 IATA 코드로 묶는다.
  const AIRPORTS = [
    ["ICN", ["RKSI", "Incheon International Airport", "Incheon", "인천", "인천공항"]],
    ["GMP", ["RKSS", "Gimpo International Airport", "Gimpo", "김포", "김포공항"]],
    ["CJU", ["RKPC", "Jeju International Airport", "Jeju", "제주", "제주공항"]],
    ["PUS", ["RKPK", "Gimhae International Airport", "Busan", "Gimhae", "부산", "김해", "김해공항"]],
    ["TAE", ["RKTN", "Daegu International Airport", "Daegu", "대구", "대구공항"]],
    ["CJJ", ["RKTU", "Cheongju International Airport", "Cheongju", "청주", "청주공항"]],
    ["MWX", ["RKJB", "Muan International Airport", "Muan", "무안", "무안공항"]],
    ["RSU", ["RKJY", "Yeosu Airport", "Yeosu", "여수", "여수공항"]],
    ["USN", ["RKPU", "Ulsan Airport", "Ulsan", "울산", "울산공항"]],
    ["KPO", ["RKTH", "Pohang Gyeongju Airport", "Pohang", "Gyeongju", "포항", "경주", "포항경주공항"]],
    ["KWJ", ["RKJJ", "Gwangju Airport", "Gwangju", "광주", "광주공항"]],
    ["WJU", ["RKNW", "Wonju Airport", "Wonju", "원주", "원주공항"]],
    ["HIN", ["RKPS", "Sacheon Airport", "Sacheon", "Jinju", "사천", "진주", "사천공항"]],
    ["KUV", ["RKJK", "Gunsan Airport", "Gunsan", "군산", "군산공항"]],
    ["YNY", ["RKNY", "Yangyang International Airport", "Yangyang", "양양", "양양공항"]],

    ["NRT", ["RJAA", "Narita International Airport", "Narita", "Tokyo Narita", "나리타", "도쿄 나리타"]],
    ["HND", ["RJTT", "Tokyo Haneda Airport", "Haneda", "Tokyo Haneda", "하네다", "도쿄 하네다"]],
    ["KIX", ["RJBB", "Kansai International Airport", "Kansai", "Osaka Kansai", "간사이", "오사카 간사이"]],
    ["FUK", ["RJFF", "Fukuoka Airport", "Fukuoka", "후쿠오카", "후쿠오카공항"]],
    ["NGO", ["RJGG", "Chubu Centrair International Airport", "Nagoya", "Chubu", "나고야", "주부"]],
    ["CTS", ["RJCC", "New Chitose Airport", "Sapporo", "New Chitose", "삿포로", "신치토세"]],
    ["OKA", ["ROAH", "Naha Airport", "Okinawa", "Naha", "오키나와", "나하"]],
    ["KMQ", ["RJNK", "Komatsu Airport", "Komatsu", "고마쓰", "코마츠"]],
    ["KMJ", ["RJFT", "Kumamoto Airport", "Kumamoto", "구마모토"]],
    ["KOJ", ["RJFK", "Kagoshima Airport", "Kagoshima", "가고시마"]],
    ["HIJ", ["RJOA", "Hiroshima Airport", "Hiroshima", "히로시마"]],
    ["MYJ", ["RJOM", "Matsuyama Airport", "Matsuyama", "마쓰야마", "마츠야마"]],
    ["OIT", ["RJFO", "Oita Airport", "Oita", "오이타"]],
    ["FSZ", ["RJNS", "Shizuoka Airport", "Shizuoka", "시즈오카"]],
    ["SDJ", ["RJSS", "Sendai Airport", "Sendai", "센다이"]],
    ["TAK", ["RJOT", "Takamatsu Airport", "Takamatsu", "다카마쓰", "타카마츠"]],

    ["PVG", ["ZSPD", "Shanghai Pudong International Airport", "Shanghai Pudong", "Pudong", "상하이 푸동", "푸동"]],
    ["SHA", ["ZSSS", "Shanghai Hongqiao International Airport", "Shanghai Hongqiao", "Hongqiao", "상하이 홍차오", "홍차오"]],
    ["PEK", ["ZBAA", "Beijing Capital International Airport", "Beijing Capital", "베이징 수도", "베이징 서우두", "서우두"]],
    ["PKX", ["ZBAD", "Beijing Daxing International Airport", "Beijing Daxing", "베이징 다싱", "다싱"]],
    ["TAO", ["ZSQD", "Qingdao Jiaodong International Airport", "Qingdao", "칭다오", "청도"]],
    ["YNT", ["ZSYT", "Yantai Penglai International Airport", "Yantai", "옌타이", "연태"]],
    ["WEH", ["ZSWH", "Weihai Dashuibo Airport", "Weihai", "웨이하이", "위해"]],
    ["HGH", ["ZSHC", "Hangzhou Xiaoshan International Airport", "Hangzhou", "항저우", "항주"]],
    ["NKG", ["ZSNJ", "Nanjing Lukou International Airport", "Nanjing", "난징", "남경"]],
    ["HKG", ["VHHH", "Hong Kong International Airport", "Hong Kong", "홍콩", "첵랍콕"]],
    ["MFM", ["VMMC", "Macau International Airport", "Macau", "Macao", "마카오"]],
    ["TPE", ["RCTP", "Taiwan Taoyuan International Airport", "Taipei Taoyuan", "Taoyuan", "타이베이", "타오위안", "도원"]],
    ["KHH", ["RCKH", "Kaohsiung International Airport", "Kaohsiung", "가오슝", "카오슝"]],

    ["DAD", ["VVDN", "Da Nang International Airport", "Da Nang", "Danang", "다낭", "다낭공항"]],
    ["CXR", ["VVCR", "Cam Ranh International Airport", "Cam Ranh", "Nha Trang", "깜란", "캄란", "나트랑"]],
    ["SGN", ["VVTS", "Tan Son Nhat International Airport", "Ho Chi Minh City", "Saigon", "호찌민", "호치민", "사이공"]],
    ["HAN", ["VVNB", "Noi Bai International Airport", "Hanoi", "하노이", "노이바이"]],
    ["BKK", ["VTBS", "Suvarnabhumi Airport", "Bangkok Suvarnabhumi", "Bangkok", "방콕", "수완나품"]],
    ["DMK", ["VTBD", "Don Mueang International Airport", "Bangkok Don Mueang", "Don Mueang", "돈므앙", "돈무앙"]],
    ["CNX", ["VTCC", "Chiang Mai International Airport", "Chiang Mai", "치앙마이"]],
    ["HKT", ["VTSP", "Phuket International Airport", "Phuket", "푸껫", "푸켓"]],
    ["MNL", ["RPLL", "Ninoy Aquino International Airport", "Manila", "마닐라", "니노이 아키노"]],
    ["CEB", ["RPVM", "Mactan Cebu International Airport", "Cebu", "Mactan", "세부", "막탄"]],
    ["TAG", ["RPSP", "RPVT", "Bohol Panglao International Airport", "Tagbilaran", "Panglao", "Bohol", "보홀", "팡라오", "탁빌라란"]],
    ["DPS", ["WADD", "Ngurah Rai International Airport", "Denpasar", "Bali", "덴파사르", "발리", "응우라라이"]],
    ["CGK", ["WIII", "Soekarno Hatta International Airport", "Jakarta", "자카르타", "수카르노 하타"]],
    ["BKI", ["WBKK", "Kota Kinabalu International Airport", "Kota Kinabalu", "코타키나발루"]],
    ["KUL", ["WMKK", "Kuala Lumpur International Airport", "Kuala Lumpur", "쿠알라룸푸르"]],
    ["SIN", ["WSSS", "Singapore Changi Airport", "Singapore", "Changi", "싱가포르", "창이"]],
    ["VTE", ["VLVT", "Wattay International Airport", "Vientiane", "비엔티안", "왓타이"]],
    ["LPQ", ["VLLB", "Luang Prabang International Airport", "Luang Prabang", "루앙프라방"]],
    ["PNH", ["VDPP", "Phnom Penh International Airport", "Phnom Penh", "프놈펜"]],
    ["REP", ["VDSR", "Siem Reap International Airport", "Siem Reap", "시엠레아프", "씨엠립"]],
    ["SAI", ["VDSA", "Siem Reap Angkor International Airport", "Siem Reap Angkor", "시엠레아프 앙코르"]],
    ["UBN", ["ZMCK", "Chinggis Khaan International Airport", "Ulaanbaatar", "울란바토르", "칭기즈칸"]],
    ["GUM", ["PGUM", "Antonio B Won Pat International Airport", "Guam", "괌"]],
    ["SPN", ["PGSN", "Saipan International Airport", "Saipan", "사이판"]],
  ];

  function normalize(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^0-9A-Z가-힣]/g, "");
  }

  const byAlias = new Map();
  const byIata = new Map();
  for (const [iata, aliases] of AIRPORTS) {
    const record = { iata, aliases: [iata, ...aliases] };
    byIata.set(iata, record);
    for (const alias of record.aliases) {
      const key = normalize(alias);
      if (key && !byAlias.has(key)) byAlias.set(key, iata);
    }
  }

  function canonicalAirportCode(value) {
    return byAlias.get(normalize(value)) || "";
  }

  function expandAirportSearchText(value) {
    const original = String(value || "");
    const expanded = [original];
    const tokens = original.toUpperCase().match(/[A-Z0-9]{3,4}/g) || [];
    for (const token of tokens) {
      const iata = canonicalAirportCode(token);
      const record = byIata.get(iata);
      if (record) expanded.push(...record.aliases);
    }
    return expanded.join(" ").toUpperCase();
  }

  function airportKeywordMatches(value, keyword) {
    const query = String(keyword || "").trim();
    if (!query) return true;
    const haystack = expandAirportSearchText(value);
    const exactCode = canonicalAirportCode(query);
    if (exactCode) return haystack.includes(exactCode);
    const tokens = query.split(/[\s,]+/).filter(Boolean);
    return !tokens.length || tokens.some(token => {
      const code = canonicalAirportCode(token);
      return haystack.includes(code || String(token).toUpperCase());
    });
  }

  root.CrewSwapAirportAliases = Object.freeze({
    canonicalAirportCode,
    expandAirportSearchText,
    airportKeywordMatches,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
