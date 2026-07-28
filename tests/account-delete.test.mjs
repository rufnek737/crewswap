import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountDeletionPlan } from '../worker/account-delete.mjs';

test('account deletion removes owned posts, related requests, and premium push records', () => {
  const plan = buildAccountDeletionPlan(
    'Pilot@jejuair.net',
    [{ id: 'P1', ownerEmail: 'pilot@jejuair.net' }, { id: 'P2', ownerEmail: 'other@jejuair.net' }],
    [
      { id: 'R1', fromEmail: 'pilot@jejuair.net', toEmail: 'other@jejuair.net' },
      { id: 'R2', fromEmail: 'other@jejuair.net', toEmail: 'pilot@jejuair.net' },
      { id: 'R3', fromEmail: 'a@jejuair.net', toEmail: 'b@jejuair.net' },
    ],
    [{ email: 'pilot@jejuair.net' }, { email: 'other@jejuair.net' }],
  );

  assert.deepEqual(plan.postsToDelete.map(item => item.id), ['P1']);
  assert.deepEqual(plan.remainingPosts.map(item => item.id), ['P2']);
  assert.deepEqual(plan.requestsToDelete.map(item => item.id), ['R1', 'R2']);
  assert.deepEqual(plan.remainingRequests.map(item => item.id), ['R3']);
  assert.deepEqual(plan.remainingPremiumRecords, [{ email: 'other@jejuair.net' }]);
  assert.equal(plan.removedPremiumRecords, 1);
});

test('account deletion email comparison is case-insensitive', () => {
  const plan = buildAccountDeletionPlan('PILOT@JEJUAIR.NET', [{ id: 'P1', ownerEmail: 'pilot@jejuair.net' }]);
  assert.equal(plan.postsToDelete.length, 1);
});
