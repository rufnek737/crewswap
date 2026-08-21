export const PRO_TRIAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

function validTime(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

export function getProStatus(user = {}, now = Date.now()) {
  const lifetime = user.proLifetime === true;
  const trialStartedAt = user.proTrialStartedAt || null;
  const trialExpiresAt = user.proTrialExpiresAt || null;
  const trialExpiry = validTime(trialExpiresAt);
  const legacyExpiry = validTime(user.premiumUntil);
  const trialActive = trialExpiry !== null && trialExpiry > now;
  const legacyActive = legacyExpiry !== null && legacyExpiry > now;
  const active = lifetime || trialActive || legacyActive;

  return {
    active,
    entitlement: lifetime ? 'lifetime' : trialActive ? 'trial' : legacyActive ? 'legacy' : 'none',
    trialAvailable: !trialStartedAt && !trialExpiresAt,
    trialStartedAt,
    trialExpiresAt,
  };
}

export function activateProTrial(user = {}, now = Date.now()) {
  const current = getProStatus(user, now);
  if (current.entitlement === 'lifetime') {
    return { ok: false, code: 'PRO_ALREADY_LIFETIME', user, status: current };
  }
  if (!current.trialAvailable) {
    return { ok: false, code: 'PRO_TRIAL_ALREADY_USED', user, status: current };
  }

  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PRO_TRIAL_DURATION_MS).toISOString();
  const nextUser = {
    ...user,
    proTrialStartedAt: startedAt,
    proTrialExpiresAt: expiresAt,
  };
  return { ok: true, user: nextUser, status: getProStatus(nextUser, now) };
}
