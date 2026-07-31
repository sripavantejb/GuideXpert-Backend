'use strict';

/**
 * F-3 — serverless-safe turn-log flush.
 *
 * The incident root cause was a floating `writeTurnLog(...).catch(() => {})`:
 * Vercel freezes the container right after the HTTP response, killing the
 * in-flight insert, and the swallowed rejection hid every single failure —
 * zero turn logs were ever written in production.
 *
 * Mechanism, per environment:
 *   - Vercel runtime: register the write with `waitUntil` from
 *     `@vercel/functions`, which keeps the container alive past the response.
 *     The caller is not blocked, so the hot path pays no p95 cost.
 *   - Anywhere else (local, tests, other hosts), or if `waitUntil` refuses
 *     (no request context): AWAIT the write inline — a stronger guarantee,
 *     never a weaker one.
 *
 * In BOTH modes the result is checked: a turn-log write failure is the loss
 * of this system's only audit trail, and is logged as an alertable ERROR,
 * never swallowed.
 */

const { writeTurnLog } = require('./turnLog');

function resolveWaitUntil() {
  try {
    // Optional at runtime by design: absence simply selects the await path,
    // which is the stricter behavior — this is not a silent degradation.
    const { waitUntil } = require('@vercel/functions');
    return typeof waitUntil === 'function' ? waitUntil : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} entry writeTurnLog entry
 * @param {{ FlowV3TurnLog?: object, waitUntil?: Function|null }} [deps]
 *        pass `waitUntil: null` to force the inline-await path (tests)
 * @returns {Promise<{ ok: boolean, deferred?: boolean, turnId?: string, error?: string }>}
 */
async function flushTurnLog(entry = {}, deps = {}) {
  const write = async () => {
    const result = await writeTurnLog(entry, deps);
    if (!result.ok) {
      console.error('[flowV3] TURNLOG_WRITE_FAILED', {
        turnId: entry.turnId || null,
        conversationId: entry.conversationId || null,
        error: result.error || 'unknown',
      });
    }
    return result;
  };

  const waitUntil = deps.waitUntil !== undefined ? deps.waitUntil : resolveWaitUntil();
  if (typeof waitUntil === 'function') {
    try {
      waitUntil(write());
      return { ok: true, deferred: true };
    } catch {
      // waitUntil is unusable outside a request context — fall through to the
      // inline await, which is the stricter guarantee.
    }
  }
  return write();
}

module.exports = { flushTurnLog, resolveWaitUntil };
