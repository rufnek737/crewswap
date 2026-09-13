import assert from "node:assert/strict";
import test from "node:test";
import usage from "../swap-usage.js";

test("pilot swap usage is shown as unlimited", () => {
  const result = usage.summary("PILOT", { monthlySwapUsed:99 }, {});
  assert.equal(result.limited, false);
  assert.equal(result.status, "횟수 제한 없음");
  assert.equal(result.level, "normal");
});

test("cabin swap usage shows remaining monthly and yearly counts", () => {
  const result = usage.summary("CABIN", { monthlySwapUsed:1, yearlySwapUsed:5 }, { swapLimitMonthly:2, swapLimitYearly:12 });
  assert.equal(result.level, "normal");
  assert.equal(result.monthly.remaining, 1);
  assert.equal(result.yearly.remaining, 7);
});

test("cabin swap usage warns when a limit is reached", () => {
  const result = usage.summary("CABIN", { monthlySwapUsed:2, yearlySwapUsed:5 }, { swapLimitMonthly:2, swapLimitYearly:12 });
  assert.equal(result.level, "limit");
  assert.match(result.warning, /한도에 도달/);
});

test("cabin swap usage strongly warns when a limit is exceeded", () => {
  const result = usage.summary("CABIN", { monthlySwapUsed:3, yearlySwapUsed:13 }, { swapLimitMonthly:2, swapLimitYearly:12 });
  assert.equal(result.level, "over");
  assert.match(result.warning, /한도를 초과/);
});

test("객실 동의권은 월 1회이고 Swap권과 따로 센다", () => {
  // 남을 도와준 것(동의)이 내 스왑 횟수를 깎으면 안 된다.
  const rules = { swapLimitMonthly: 2, swapLimitYearly: 12, consentLimitMonthly: 1 };
  const fresh = usage.canConsent("CABIN", { monthlySwapUsed: 2, yearlySwapUsed: 9 }, rules);
  assert.equal(fresh.ok, true, "Swap권을 다 써도 동의권은 남아 있다");

  const used = usage.canConsent("CABIN", { monthlyConsentUsed: 1 }, rules);
  assert.equal(used.ok, false);
  assert.match(used.reason, /동의권 1회를 모두 사용/);

  // 운항승무원은 동의권 제한이 없다
  assert.equal(usage.canConsent("PILOT", { monthlyConsentUsed: 9 }, rules).ok, true);
});

test("요약에 남은 동의 횟수가 나온다", () => {
  const rules = { swapLimitMonthly: 2, swapLimitYearly: 12, consentLimitMonthly: 1 };
  const s = usage.summary("CABIN", { monthlySwapUsed: 0, yearlySwapUsed: 0, monthlyConsentUsed: 0 }, rules);
  assert.deepEqual(s.consent, { used: 0, limit: 1, remaining: 1, reached: false });
  assert.match(s.warning, /동의 1회/);

  const done = usage.summary("CABIN", { monthlyConsentUsed: 1 }, rules);
  assert.equal(done.consent.reached, true);
});

test("달이 바뀌면 카운터가 0부터 다시 센다", () => {
  // 초기화가 없어 한도에 닿은 사람이 영영 막히던 것을 고쳤다.
  const user = { swapCountMonth: "2026-08", swapCountYear: "2026",
                 monthlySwapUsed: 2, monthlyConsentUsed: 1, yearlySwapUsed: 5 };
  const changed = usage.rollOver(user, Date.parse("2026-09-01T00:00:00+09:00"));
  assert.equal(changed, true);
  assert.equal(user.monthlySwapUsed, 0);
  assert.equal(user.monthlyConsentUsed, 0);
  assert.equal(user.yearlySwapUsed, 5, "연 카운터는 해가 같으면 유지된다");
  assert.equal(user.swapCountMonth, "2026-09");

  // 같은 달에 또 부르면 아무것도 건드리지 않는다
  user.monthlySwapUsed = 1;
  assert.equal(usage.rollOver(user, Date.parse("2026-09-20T00:00:00+09:00")), false);
  assert.equal(user.monthlySwapUsed, 1);
});

test("해가 바뀌면 연 카운터도 초기화된다", () => {
  const user = { swapCountMonth: "2026-12", swapCountYear: "2026", yearlySwapUsed: 12, monthlySwapUsed: 2 };
  usage.rollOver(user, Date.parse("2027-01-05T00:00:00+09:00"));
  assert.equal(user.yearlySwapUsed, 0);
  assert.equal(user.monthlySwapUsed, 0);
});
