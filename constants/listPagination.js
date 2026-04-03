/**
 * Maximum `limit` for paginated list endpoints (admin leads, assessments, training, meetings, etc.).
 * Override with env ADMIN_LIST_MAX_LIMIT (hard-capped to avoid abuse).
 */
const ABSOLUTE_CEILING = 500000;
const raw = Number(process.env.ADMIN_LIST_MAX_LIMIT);
const parsed = Number.isFinite(raw) && raw > 0 ? raw : 100000;
exports.ADMIN_LIST_MAX_LIMIT = Math.min(ABSOLUTE_CEILING, parsed);
