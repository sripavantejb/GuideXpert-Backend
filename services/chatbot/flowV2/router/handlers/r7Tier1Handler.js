'use strict';

/**
 * Flow v2 — R7 Tier-1 handler (disappointment / pressure).
 *
 * Does NOT hard-stop. Per spec: "one empathetic line, then falls through
 * to continue whatever the current stage was." Unlike the other 7 fully-
 * wired buckets (which fully own the turn's reply), R7 Tier-1 only
 * contributes a PREFIX line — `flowV2Dispatcher` is responsible for
 * prepending this line to whatever the normal stage-based fallthrough
 * (the same mechanism R1-R4 use) would have replied with this turn. This
 * handler intentionally has no state-mutating side effects and never
 * touches `context.flowV2.stage` — it must never be reachable from, or
 * lead into, R7 Tier-2's hard-stop path (they are different severity
 * handlers with no shared exit).
 */

const R7_TIER1_EMPATHY_LINE =
  "That sounds like a lot to carry right now. For what it's worth, one result or one hard conversation doesn't decide the rest of your story.";

/**
 * @returns {string} the fixed empathy line — dispatcher prepends this to
 * the normal fallthrough reply for the current stage.
 */
function getR7Tier1PrefixLine() {
  return R7_TIER1_EMPATHY_LINE;
}

module.exports = {
  getR7Tier1PrefixLine,
  R7_TIER1_EMPATHY_LINE,
};
