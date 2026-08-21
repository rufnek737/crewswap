import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWalletCommand, normalizeWallet } from '../worker/credit-wallet.mjs';

test('server wallet resets to three at the start of a new Korea month', () => {
  const august = normalizeWallet(null, Date.parse('2026-08-20T00:00:00Z'));
  const spent = applyWalletCommand(august, { type:'spend', operationId:'one', amount:1 }, Date.parse('2026-08-20T00:00:00Z'));
  assert.equal(spent.wallet.credits, 2);
  const september = normalizeWallet(spent.wallet, Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(september.credits, 3);
});

test('server wallet operations are idempotent', () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  const first = applyWalletCommand(null, { type:'spend', operationId:'same', amount:1 }, now);
  const second = applyWalletCommand(first.wallet, { type:'spend', operationId:'same', amount:1 }, now);
  assert.equal(first.wallet.credits, 2);
  assert.equal(second.wallet.credits, 2);
  assert.equal(second.duplicate, true);
});
