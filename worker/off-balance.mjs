// OFF 맞교환 — 스왑으로 어느 한쪽의 OFF 수가 줄면 안 된다(2026-11-21 Kay).
// 월 보장 OFF 총수(현재 31일 달 10일·30일 이하 9일)는 바뀔 수 있어 쓰지 않는다. 대신 OFF 를 하나 받으면 하나 줘야 한다.
// aKeys: A 가 내주는 날, bKeys: B 가 내주는 날. 한쪽만 고른 날은 고른 사람이 비우고(OFF) 상대가 그 근무를 맡는다.
const keyOf = s => `${s.month}-${String(s.day).padStart(2, '0')}`;
const isOff = s => !!s && String(s.type || '').toUpperCase() === 'OFF';

export function offBalance(aRoster, bRoster, aKeys, bKeys) {
  const a = new Map((aRoster || []).filter(s => s?.month).map(s => [keyOf(s), s]));
  const b = new Map((bRoster || []).filter(s => s?.month).map(s => [keyOf(s), s]));
  const aGive = new Set(aKeys), bGive = new Set(bKeys);
  let aDelta = 0, bDelta = 0;
  for (const k of new Set([...aGive, ...bGive])) {
    const aAfter = bGive.has(k) ? isOff(b.get(k)) : aGive.has(k) ? true : isOff(a.get(k));
    const bAfter = aGive.has(k) ? isOff(a.get(k)) : bGive.has(k) ? true : isOff(b.get(k));
    aDelta += (aAfter ? 1 : 0) - (isOff(a.get(k)) ? 1 : 0);
    bDelta += (bAfter ? 1 : 0) - (isOff(b.get(k)) ? 1 : 0);
  }
  return { aDelta, bDelta };
}
