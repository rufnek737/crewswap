export function buildAccountDeletionPlan(email, posts = [], requests = [], premiumRecords = []) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const belongsToAccount = value => String(value || '').trim().toLowerCase() === normalizedEmail;

  const postsToDelete = posts.filter(post => belongsToAccount(post?.ownerEmail));
  const requestsToDelete = requests.filter(req =>
    belongsToAccount(req?.fromEmail) || belongsToAccount(req?.toEmail));
  const remainingPremiumRecords = premiumRecords.filter(record => !belongsToAccount(record?.email));

  return {
    postsToDelete,
    remainingPosts: posts.filter(post => !belongsToAccount(post?.ownerEmail)),
    requestsToDelete,
    remainingRequests: requests.filter(req =>
      !belongsToAccount(req?.fromEmail) && !belongsToAccount(req?.toEmail)),
    remainingPremiumRecords,
    removedPremiumRecords: premiumRecords.length - remainingPremiumRecords.length,
  };
}
