'use strict';

const {
  CURATED_MODERN_CATALOG,
  EXPLORE_PRESENT_LIMIT,
} = require('../../../../constants/careerCounsellingV2ExploreModernColleges');

/**
 * M-1 curated catalog — Phase 5 CURATED_MODERN_CATALOG only (NOT B8 FLAT_CATALOG / Polar).
 * @param {{ limit?: number }} [args]
 * @param {{ deps?: { getCatalog?: Function } }} [_ctx]
 */
function run(args = {}, _ctx = {}) {
  const catalogFn =
    (_ctx.deps && _ctx.deps.getCatalog) ||
    (() => CURATED_MODERN_CATALOG);
  const raw = catalogFn();
  const limit = Math.min(
    Number(args.limit) > 0 ? Number(args.limit) : EXPLORE_PRESENT_LIMIT,
    EXPLORE_PRESENT_LIMIT
  );
  const rows = (Array.isArray(raw) ? raw : CURATED_MODERN_CATALOG)
    .slice(0, limit)
    .map((row) => ({
      ...row,
      catalog: 'curated',
    }));
  return {
    ok: true,
    count: rows.length,
    rows,
  };
}

module.exports = { run };
