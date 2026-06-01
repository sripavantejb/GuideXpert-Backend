/**
 * User-facing message when Atlas blocks writes due to storage quota (code 8000).
 * @param {unknown} err
 * @returns {string|null}
 */
function getMongoQuotaExceededMessage(err) {
  if (!err || typeof err !== 'object') return null;
  const code = err.code ?? err.errorResponse?.code;
  const msg = String(err.message || err.errorResponse?.errmsg || '');
  if (
    code === 8000
    || /space quota/i.test(msg)
    || /writes are blocked/i.test(msg)
  ) {
    return 'Database storage is full; new saves are blocked. Free space or upgrade MongoDB Atlas, then try again.';
  }
  return null;
}

module.exports = { getMongoQuotaExceededMessage };
