/**
 * Detect MongoDB duplicate key errors (E11000).
 * @param {unknown} err
 */
function isMongoDuplicateKeyError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.code === 11000) return true;
  return String(err.message || '').includes('E11000');
}

module.exports = { isMongoDuplicateKeyError };
