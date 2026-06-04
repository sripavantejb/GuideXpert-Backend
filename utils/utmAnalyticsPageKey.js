/** Maps admin ?linkTarget= to IitCounsellingVisit.pageKey. */
function resolveUtmAnalyticsPageKey(query = {}) {
  const raw = query.linkTarget || query.pageKey || '';
  const s = String(raw).trim().toLowerCase().replace(/-/g, '_');
  if (s === 'oneononesession' || s === 'one_on_one_session') return 'oneOnOneSession';
  return 'iitCounselling';
}

module.exports = { resolveUtmAnalyticsPageKey };
