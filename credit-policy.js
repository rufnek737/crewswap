(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CrewSwapCreditPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BASE_MONTHLY_CREDITS = 3;

  function monthKey(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function cleanNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number * 10) / 10) : fallback;
  }

  function reconcileMonth(wallet, now = new Date()) {
    const current = monthKey(now);
    const previous = wallet.creditMonth || null;
    const legacy = !previous;
    const changedMonth = !!previous && previous !== current;

    if (legacy) {
      wallet.credits = Math.min(cleanNumber(wallet.credits, BASE_MONTHLY_CREDITS), BASE_MONTHLY_CREDITS);
      wallet.adCreditsThisMonth = 0;
    } else if (changedMonth) {
      wallet.credits = BASE_MONTHLY_CREDITS;
      wallet.adCreditsThisMonth = 0;
    } else {
      wallet.credits = cleanNumber(wallet.credits, BASE_MONTHLY_CREDITS);
      wallet.adCreditsThisMonth = Math.floor(cleanNumber(wallet.adCreditsThisMonth, 0));
    }
    wallet.creditMonth = current;
    return { changed: legacy || changedMonth, legacy, changedMonth, month: current };
  }

  function grantAdCredit(wallet, now = new Date()) {
    reconcileMonth(wallet, now);
    wallet.credits = cleanNumber(wallet.credits, 0) + 1;
    wallet.adCreditsThisMonth = Math.floor(cleanNumber(wallet.adCreditsThisMonth, 0)) + 1;
    return 1;
  }

  function grantRefund(wallet, requested, now = new Date()) {
    reconcileMonth(wallet, now);
    const amount = cleanNumber(requested, 0);
    if (!amount || wallet.credits >= BASE_MONTHLY_CREDITS) return 0;
    const granted = Math.min(amount, BASE_MONTHLY_CREDITS - wallet.credits);
    wallet.credits = Math.round((wallet.credits + granted) * 10) / 10;
    return Math.round(granted * 10) / 10;
  }

  return {
    BASE_MONTHLY_CREDITS,
    monthKey,
    reconcileMonth,
    grantAdCredit,
    grantRefund,
  };
});
