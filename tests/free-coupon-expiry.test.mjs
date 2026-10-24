// 무료 급구 쿠폰은 그달에만 — 구매·보상 쿠폰은 남는다(2026-10-24 Kay 결정).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWallet, applyWalletCommand } from '../worker/credit-wallet.mjs';

const OCT = Date.parse('2026-10-24T03:00:00Z');
const NOV = Date.parse('2026-11-02T03:00:00Z');
const DEC = Date.parse('2026-12-02T03:00:00Z');
const opt = { freeCouponsPerMonth: 1 };

test('안 쓴 무료 쿠폰은 다음 달에 사라지고 새로 1장', () => {
  let w = normalizeWallet({}, OCT, opt);
  assert.equal(w.urgentCoupons, 1); assert.equal(w.freeCoupons, 1);
  w = normalizeWallet(w, NOV, opt);
  assert.equal(w.urgentCoupons, 1, '쌓이지 않는다');
  w = normalizeWallet(w, DEC, opt);
  assert.equal(w.urgentCoupons, 1);
});

test('구매·보상 쿠폰은 남고 무료분만 사라진다', () => {
  let w = normalizeWallet({}, OCT, opt);
  w = applyWalletCommand(w, { type: 'grant-coupon', operationId: 'buy1', amount: 5 }, OCT, opt).wallet;
  w = applyWalletCommand(w, { type: 'grant-coupon', operationId: 'rw1', amount: 0.5 }, OCT, opt).wallet;
  assert.equal(w.urgentCoupons, 6.5);
  w = normalizeWallet(w, NOV, opt);
  assert.equal(w.urgentCoupons, 6.5, '무료 1 소멸 + 새 무료 1 = 그대로 6.5');
  assert.equal(w.freeCoupons, 1);
});

test('쓸 때는 무료분부터', () => {
  let w = normalizeWallet({}, OCT, opt);
  w = applyWalletCommand(w, { type: 'grant-coupon', operationId: 'buy', amount: 2 }, OCT, opt).wallet;
  w = applyWalletCommand(w, { type: 'spend-coupon', operationId: 'post:urgent:A', amount: 1 }, OCT, opt).wallet;
  assert.equal(w.urgentCoupons, 2); assert.equal(w.freeCoupons, 0);
  w = normalizeWallet(w, NOV, opt);
  assert.equal(w.urgentCoupons, 3, '산 2장 남고 새 무료 1장');
});

test('같은 달에 돌려받은 무료 쿠폰은 무료분으로, 달이 바뀌면 산 쿠폰이 되지 않는다', () => {
  let w = normalizeWallet({}, OCT, opt);
  w = applyWalletCommand(w, { type: 'spend-coupon', operationId: 'post:urgent:B', amount: 1 }, OCT, opt).wallet;
  w = applyWalletCommand(w, { type: 'grant-coupon', operationId: 'post:urgent-refund:B', amount: 1, restoreOf: 'post:urgent:B' }, OCT, opt).wallet;
  assert.equal(w.urgentCoupons, 1); assert.equal(w.freeCoupons, 1);

  let v = normalizeWallet({}, OCT, opt);
  v = applyWalletCommand(v, { type: 'spend-coupon', operationId: 'post:urgent:C', amount: 1 }, OCT, opt).wallet;
  v = applyWalletCommand(v, { type: 'grant-coupon', operationId: 'post:urgent-refund:C', amount: 1, restoreOf: 'post:urgent:C' }, NOV, opt).wallet;
  assert.equal(v.urgentCoupons, 1, '11월 무료 1장만 — 10월 무료분이 산 쿠폰으로 살아나지 않는다');
});

test('예전 지갑(무료분 기록 없음): 이번 달은 그대로, 다음 달부터 정리', () => {
  const old = { urgentCoupons: 3.5, freeCouponMonth: '2026-10', creditMonth: '2026-10', credits: 3 };
  let w = normalizeWallet(old, OCT, opt);
  assert.equal(w.urgentCoupons, 3.5, '이번 달은 손대지 않는다');
  w = normalizeWallet(w, NOV, opt);
  assert.equal(w.urgentCoupons, 1.5, '정수 3장은 무료분이라 사라지고, 보상 0.5 + 새 무료 1');
});

test('무료 기간이 끝나면 남은 무료분은 사라지고 새로 주지 않는다', () => {
  let w = normalizeWallet({}, OCT, opt);
  w = applyWalletCommand(w, { type: 'grant-coupon', operationId: 'buy', amount: 2 }, OCT, opt).wallet;
  w = normalizeWallet(w, NOV, { freeCouponsPerMonth: 0 });
  assert.equal(w.urgentCoupons, 2);
});
