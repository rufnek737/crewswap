// 급구 스왑 — 유료 쿠폰, 등급 기반 알림, 내준 사람에 대한 보상.
// 급구는 돈이 오가는 기능이라 "두 번 걷히거나 두 번 지급되지 않는가"가 핵심이다.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyWalletCommand, normalizeWallet, publicWallet } from '../worker/credit-wallet.mjs';
import { subscriberCanTakeUrgentPost } from '../worker/premium-alerts.mjs';

const require = createRequire(import.meta.url);
const gradePolicy = require('../grade-policy.js');

const SEP = Date.parse('2026-09-10T00:00:00Z');
const OCT = Date.parse('2026-10-05T00:00:00Z');

test('쿠폰은 사서 쓰는 소모품이라 달이 바뀌어도 남는다', () => {
  const bought = applyWalletCommand(null, { type: 'grant-coupon', operationId: 'buy', amount: 5 }, SEP).wallet;
  assert.equal(bought.urgentCoupons, 5);

  // 크레딧은 매달 3개로 초기화되지만 쿠폰은 그대로여야 한다.
  const next = normalizeWallet(bought, OCT);
  assert.equal(next.credits, 3);
  assert.equal(next.urgentCoupons, 5);
});

test('급구 등록은 쿠폰 1장을 쓰고, 없으면 막는다', () => {
  const wallet = applyWalletCommand(null, { type: 'grant-coupon', operationId: 'buy', amount: 1 }, SEP).wallet;
  const used = applyWalletCommand(wallet, { type: 'spend-coupon', operationId: 'post:urgent:P1' }, SEP);
  assert.equal(used.ok, true);
  assert.equal(used.wallet.urgentCoupons, 0);

  const denied = applyWalletCommand(used.wallet, { type: 'spend-coupon', operationId: 'post:urgent:P2' }, SEP);
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'URGENT_COUPON_REQUIRED');
});

test('같은 글로 쿠폰이 두 번 걷히지 않는다', () => {
  const wallet = applyWalletCommand(null, { type: 'grant-coupon', operationId: 'buy', amount: 2 }, SEP).wallet;
  const first = applyWalletCommand(wallet, { type: 'spend-coupon', operationId: 'post:urgent:P1' }, SEP);
  const again = applyWalletCommand(first.wallet, { type: 'spend-coupon', operationId: 'post:urgent:P1' }, SEP);
  assert.equal(again.duplicate, true);
  assert.equal(again.wallet.urgentCoupons, 1);
});

test('보상은 쿠폰 1장 + 크레딧 1개이고 같은 요청에 한 번만 나간다', () => {
  const start = normalizeWallet(null, SEP);
  const one = applyWalletCommand(start, { type: 'grant-coupon', operationId: 'urgent:reward-coupon:R1', amount: 1 }, SEP);
  const two = applyWalletCommand(one.wallet, { type: 'grant-credit', operationId: 'urgent:reward-credit:R1', amount: 1 }, SEP);
  assert.equal(two.wallet.urgentCoupons, 1);
  assert.equal(two.wallet.credits, 4);

  const repeat = applyWalletCommand(two.wallet, { type: 'grant-credit', operationId: 'urgent:reward-credit:R1', amount: 1 }, SEP);
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.wallet.credits, 4);
});

test('보상 크레딧은 월 상한 3에 묶이지 않는다', () => {
  // 상한은 매달 그냥 나눠주는 무료분에 대한 것이고, 보상은 실제로 근무를 내준 대가다.
  const full = normalizeWallet(null, SEP);        // credits 3
  const refunded = applyWalletCommand(full, { type: 'refund', operationId: 'r', amount: 2 }, SEP);
  assert.equal(refunded.wallet.credits, 3);        // 환급은 상한에 걸린다
  const rewarded = applyWalletCommand(full, { type: 'grant-credit', operationId: 'g', amount: 1 }, SEP);
  assert.equal(rewarded.wallet.credits, 4);        // 보상은 걸리지 않는다
});

test('지갑 응답에 쿠폰 잔량이 실린다', () => {
  const wallet = applyWalletCommand(null, { type: 'grant-coupon', operationId: 'buy', amount: 5 }, SEP).wallet;
  assert.equal(publicWallet(wallet, SEP).urgentCoupons, 5);
});

const pilot = (roleType, extra = {}) => ({ crewType: 'PILOT', roleType, aircraft: 'NG_MAX', ...extra });
const urgentPost = (ownerRole, offered = {}) => ({ crewType: 'PILOT', ownerRole, urgent: true, offered: { ...offered } });

test('급구 알림은 등급이 맞는 사람에게만 간다', () => {
  const post = urgentPost('CAPTAIN_A');
  assert.equal(subscriberCanTakeUrgentPost(pilot('CAPTAIN_B'), post, gradePolicy), true);
  assert.equal(subscriberCanTakeUrgentPost(pilot('CAPTAIN_C'), post, gradePolicy), false);
});

test('급구 알림도 직책과 자격은 기존 규칙을 그대로 따른다', () => {
  const post = urgentPost('CAPTAIN_C', { edto: true });
  assert.equal(subscriberCanTakeUrgentPost(pilot('FO_C'), post, gradePolicy), false);              // 직책 다름
  assert.equal(subscriberCanTakeUrgentPost(pilot('CAPTAIN_C'), post, gradePolicy), false);         // EDTO 없음
  assert.equal(subscriberCanTakeUrgentPost(pilot('CAPTAIN_C', { edto: true }), post, gradePolicy), true);
});

test('객실승무원은 등급 판정 대상이 아니다', () => {
  const post = { crewType: 'CABIN', ownerRole: 'PUR', urgent: true, offered: {} };
  assert.equal(subscriberCanTakeUrgentPost({ crewType: 'CABIN', roleType: 'FA' }, post, gradePolicy), true);
});

/* ── 쿠폰 구매 (App Store 소모형) ─────────────────────────────── */

import {
  CREWSWAP_BUNDLE_ID,
  CREWSWAP_PRO_PRODUCT_ID,
  CREWSWAP_COUPON_PRODUCT_IDS,
  couponsForProduct,
  validateCrewSwapTransaction,
} from '../worker/apple-iap.mjs';

const couponTx = (productId, transactionId = '300000000000001') => ({
  bundleId: CREWSWAP_BUNDLE_ID, productId,
  transactionId, originalTransactionId: transactionId,
});

test('지급 수량은 상품 ID에서만 나온다', () => {
  // 클라이언트가 "10장 샀다"고 주장해도 서버는 상품 ID만 본다.
  assert.equal(couponsForProduct('com.rufnekcrewswap.coupon.urgent5'), 5);
  assert.equal(couponsForProduct('com.rufnekcrewswap.coupon.urgent10'), 10);
  assert.equal(couponsForProduct('com.rufnekcrewswap.coupon.urgent999'), 0);
  assert.equal(couponsForProduct(undefined), 0);
});

test('PRO 거래와 쿠폰 거래는 서로의 경로로 들어갈 수 없다', () => {
  const pro = couponTx(CREWSWAP_PRO_PRODUCT_ID);
  const coupon = couponTx('com.rufnekcrewswap.coupon.urgent5');

  // 쿠폰 경로에 PRO 영수증
  assert.equal(validateCrewSwapTransaction(pro, pro.transactionId, CREWSWAP_COUPON_PRODUCT_IDS).code, 'PRODUCT_MISMATCH');
  // PRO 경로에 쿠폰 영수증 (기본 인자 = PRO)
  assert.equal(validateCrewSwapTransaction(coupon, coupon.transactionId).code, 'PRODUCT_MISMATCH');
  // 각자 제 경로에서는 통과
  assert.equal(validateCrewSwapTransaction(coupon, coupon.transactionId, CREWSWAP_COUPON_PRODUCT_IDS).ok, true);
  assert.equal(validateCrewSwapTransaction(pro, pro.transactionId).ok, true);
});

test('환불된 쿠폰 구매는 지급하지 않는다', () => {
  const refunded = { ...couponTx('com.rufnekcrewswap.coupon.urgent10'), revocationDate: Date.now() };
  const result = validateCrewSwapTransaction(refunded, refunded.transactionId, CREWSWAP_COUPON_PRODUCT_IDS);
  assert.equal(result.code, 'PURCHASE_REVOKED');
});

test('같은 거래로 두 번 요청해도 쿠폰은 한 번만 쌓인다', () => {
  // 소모형이라 거래 하나가 구매 하나다. 지갑의 operationId가 그대로 멱등키다.
  const op = 'iap:coupon:production:300000000000001';
  const first = applyWalletCommand(null, { type: 'grant-coupon', operationId: op, amount: 10 }, SEP);
  const again = applyWalletCommand(first.wallet, { type: 'grant-coupon', operationId: op, amount: 10 }, SEP);
  assert.equal(first.wallet.urgentCoupons, 10);
  assert.equal(again.duplicate, true);
  assert.equal(again.wallet.urgentCoupons, 10);
});

test('소모형이므로 두 번째 구매는 막히지 않는다', () => {
  // PRO(비소모형)는 originalTransactionId로 묶어 재구매를 막지만, 쿠폰은 거래마다 새로 쌓여야 한다.
  const one = applyWalletCommand(null, { type: 'grant-coupon', operationId: 'iap:coupon:production:1', amount: 5 }, SEP);
  const two = applyWalletCommand(one.wallet, { type: 'grant-coupon', operationId: 'iap:coupon:production:2', amount: 5 }, SEP);
  assert.equal(two.wallet.urgentCoupons, 10);
});
