import test from 'node:test';
import assert from 'node:assert/strict';
import creditPolicy from '../credit-policy.js';

const july = new Date(2026, 6, 29);
const august = new Date(2026, 7, 1);

test('legacy balances are capped at three when the monthly policy is introduced', () => {
  const wallet = { credits: 7 };
  const result = creditPolicy.reconcileMonth(wallet, july);
  assert.equal(result.legacy, true);
  assert.equal(wallet.credits, 3);
  assert.equal(wallet.creditMonth, '2026-07');
  assert.equal(wallet.adCreditsThisMonth, 0);
});

test('a new month resets the wallet to three and expires ad credits', () => {
  const wallet = { credits: 6, creditMonth: '2026-07', adCreditsThisMonth: 4 };
  creditPolicy.reconcileMonth(wallet, august);
  assert.deepEqual(wallet, { credits: 3, creditMonth: '2026-08', adCreditsThisMonth: 0 });
});

test('rewarded ads add one credit at a time above the base cap', () => {
  const wallet = { credits: 3, creditMonth: '2026-07', adCreditsThisMonth: 0 };
  creditPolicy.grantAdCredit(wallet, july);
  creditPolicy.grantAdCredit(wallet, july);
  assert.equal(wallet.credits, 5);
  assert.equal(wallet.adCreditsThisMonth, 2);
});

test('refunds restore credits only up to the base cap', () => {
  const wallet = { credits: 2.8, creditMonth: '2026-07', adCreditsThisMonth: 0 };
  assert.equal(creditPolicy.grantRefund(wallet, 0.5, july), 0.2);
  assert.equal(wallet.credits, 3);
  assert.equal(creditPolicy.grantRefund(wallet, 1, july), 0);
  assert.equal(wallet.credits, 3);
});

test('refunds never increase a balance already above three through ads', () => {
  const wallet = { credits: 4, creditMonth: '2026-07', adCreditsThisMonth: 1 };
  assert.equal(creditPolicy.grantRefund(wallet, 1, july), 0);
  assert.equal(wallet.credits, 4);
});
