export const BASE_MONTHLY_CREDITS = 3;

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

export function normalizeWallet(input, now = Date.now()) {
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

export function applyWalletCommand(input, command = {}, now = Date.now()) {
  const wallet = normalizeWallet(input, now);
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

export function publicWallet(wallet, now = Date.now()) {
  const current = normalizeWallet(wallet, now);
  return {
    credits: current.credits,
    creditMonth: current.creditMonth,
    adCreditsThisMonth: current.adCreditsThisMonth,
    baseMonthlyCredits: BASE_MONTHLY_CREDITS,
  };
}
