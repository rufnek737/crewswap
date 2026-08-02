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
