export const BASE_MONTHLY_CREDITS = 3;

// 급구 쿠폰은 유료로 산 소모품이라 매달 초기화되는 크레딧과 다르다.
// 달이 바뀌어도 그대로 남고, 광고나 환급으로는 늘지 않는다.
export const URGENT_COUPON_PACKS = { small: 5, large: 10 };

export function creditMonthKey(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date(now));
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}`;
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 10) / 10) : 0;
}

/* freeCouponsPerMonth: 무료 기간 동안 매달 그냥 주는 급구 쿠폰 수.
   쿠폰을 살 수 없는 기간에 0을 주면 아무도 급구를 못 올리고, 그러면 아무도 보상을
   못 받아 쿠폰이 영원히 0장이 된다. 기능 전체가 죽은 채로 출시되는 것을 막는다.
   유료화가 시작되면 서버에서 0으로 되돌리면 된다. */
export function normalizeWallet(input, now = Date.now(), { freeCouponsPerMonth = 0 } = {}) {
  const month = creditMonthKey(now);
  const wallet = input && typeof input === 'object' ? { ...input } : {};
  if (wallet.creditMonth !== month) {
    wallet.creditMonth = month;
    wallet.credits = BASE_MONTHLY_CREDITS;
    wallet.adCreditsThisMonth = 0;
  } else {
    wallet.credits = amount(wallet.credits);
    wallet.adCreditsThisMonth = Math.floor(amount(wallet.adCreditsThisMonth));
  }
  wallet.urgentCoupons = Math.floor(amount(wallet.urgentCoupons));
  // 산 쿠폰은 그대로 두고 무료분만 더한다 — 초기화가 아니라 지급이다.
  if (freeCouponsPerMonth > 0 && wallet.freeCouponMonth !== month) {
    wallet.urgentCoupons += Math.floor(freeCouponsPerMonth);
    wallet.freeCouponMonth = month;
  }
  wallet.operations = wallet.operations && typeof wallet.operations === 'object' ? { ...wallet.operations } : {};
  return wallet;
}

function remember(wallet, operationId, result) {
  if (!operationId) return;
  wallet.operations[operationId] = { ...result, at: Date.now() };
  const ids = Object.keys(wallet.operations);
  if (ids.length > 500) {
    ids.sort((a, b) => (wallet.operations[a]?.at || 0) - (wallet.operations[b]?.at || 0));
    ids.slice(0, ids.length - 500).forEach(id => delete wallet.operations[id]);
  }
}

export function applyWalletCommand(input, command = {}, now = Date.now(), options = {}) {
  const wallet = normalizeWallet(input, now, options);
  const operationId = String(command.operationId || '').slice(0, 160);
  const previous = operationId ? wallet.operations[operationId] : null;
  if (previous) return { ok: true, duplicate: true, ...previous, wallet };

  if (command.type === 'spend') {
    const requested = amount(command.amount);
    const spent = command.unlimited ? 0 : requested;
    if (wallet.credits < spent) return { ok: false, code: 'CREDIT_REQUIRED', required: spent, wallet };
    wallet.credits = Math.round((wallet.credits - spent) * 10) / 10;
    const result = { spent };
    remember(wallet, operationId, result);
    return { ok: true, ...result, wallet };
  }

  // 급구 쿠폰 사용 — 급구로 글을 올릴 때 1장 소모한다.
  if (command.type === 'spend-coupon') {
    const requested = Math.floor(amount(command.amount)) || 1;
    if (wallet.urgentCoupons < requested) {
      return { ok: false, code: 'URGENT_COUPON_REQUIRED', required: requested, wallet };
    }
    wallet.urgentCoupons -= requested;
    const result = { couponsSpent: requested };
    remember(wallet, operationId, result);
    return { ok: true, ...result, wallet };
  }

  // 쿠폰 지급 — 구매, 그리고 급구에 응해 근무를 내준 사람에 대한 보상.
  if (command.type === 'grant-coupon') {
    const requested = Math.floor(amount(command.amount)) || 1;
    wallet.urgentCoupons += requested;
    const result = { couponsGranted: requested };
    remember(wallet, operationId, result);
    return { ok: true, ...result, wallet };
  }

  // 보상 지급 — 크레딧은 월 상한(3)에 묶이지 않는다. 상한은 매달 나눠주는
  // 무료분에 대한 것이고, 이건 실제로 근무를 내준 대가이기 때문이다.
  if (command.type === 'grant-credit') {
    const requested = amount(command.amount);
    wallet.credits = Math.round((wallet.credits + requested) * 10) / 10;
    const result = { granted: requested };
    remember(wallet, operationId, result);
    return { ok: true, ...result, wallet };
  }

  if (command.type === 'refund') {
    const requested = amount(command.amount);
    const granted = Math.min(requested, Math.max(0, BASE_MONTHLY_CREDITS - wallet.credits));
    wallet.credits = Math.round((wallet.credits + granted) * 10) / 10;
    const result = { refunded: Math.round(granted * 10) / 10 };
    remember(wallet, operationId, result);
    return { ok: true, ...result, wallet };
  }

  if (command.type === 'reverse') {
    const requested = amount(command.amount);
    wallet.credits = Math.round((wallet.credits + requested) * 10) / 10;
    const result = { refunded: requested };
    remember(wallet, operationId, result);
    return { ok: true, ...result, wallet };
  }

  return { ok: true, wallet };
}

export function publicWallet(wallet, now = Date.now(), options = {}) {
  const current = normalizeWallet(wallet, now, options);
  return {
    credits: current.credits,
    creditMonth: current.creditMonth,
    adCreditsThisMonth: current.adCreditsThisMonth,
    urgentCoupons: current.urgentCoupons,
    baseMonthlyCredits: BASE_MONTHLY_CREDITS,
  };
}
