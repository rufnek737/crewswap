import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateProTrial,
  getProStatus,
  PRO_TRIAL_DURATION_MS,
} from '../worker/pro-entitlement.mjs';

const NOW = Date.parse('2026-08-21T00:00:00.000Z');

test('PRO trial waits until the user activates it', () => {
  assert.deepEqual(getProStatus({}, NOW), {
    active: false,
    entitlement: 'none',
    expiresAt: null,
    trialAvailable: true,
    trialStartedAt: null,
    trialExpiresAt: null,
  });
});

test('activating the pass grants exactly 30 days from the chosen time', () => {
  const result = activateProTrial({}, NOW);
  assert.equal(result.ok, true);
  assert.equal(Date.parse(result.status.trialExpiresAt) - Date.parse(result.status.trialStartedAt), PRO_TRIAL_DURATION_MS);
  assert.equal(result.status.active, true);
  assert.equal(result.status.entitlement, 'trial');
  assert.equal(result.status.expiresAt, result.status.trialExpiresAt);
  assert.equal(result.status.trialAvailable, false);
});

test('the free pass cannot be activated twice or restarted after expiry', () => {
  const first = activateProTrial({}, NOW);
  const second = activateProTrial(first.user, NOW + PRO_TRIAL_DURATION_MS + 1);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'PRO_TRIAL_ALREADY_USED');
  assert.equal(second.status.active, false);
  assert.equal(second.status.trialAvailable, false);
});

test('a permanent purchase keeps PRO active without an expiry', () => {
  const status = getProStatus({ proLifetime: true }, NOW);
  assert.equal(status.active, true);
  assert.equal(status.entitlement, 'lifetime');
  assert.equal(status.trialExpiresAt, null);
});
