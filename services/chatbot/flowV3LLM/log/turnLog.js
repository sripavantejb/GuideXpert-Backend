'use strict';

/**
 * Persist a Flow V3 turn log document (async-safe; never throws to caller).
 */

const { resolveTurnLogPhoneHash } = require('./flowV3TurnLogPhone');
const { generateCallId } = require('../tools/toolBroker');

async function writeTurnLog(entry = {}, deps = {}) {
  try {
    const FlowV3TurnLog = deps.FlowV3TurnLog || require('../../../../models/FlowV3TurnLog');
    // Fail FAST and VISIBLY when the connection is down instead of letting
    // mongoose buffer for 10s and time out — the caller checks this result
    // and logs it as an alertable failure (F-3).
    const readyState = FlowV3TurnLog.db && FlowV3TurnLog.db.readyState;
    if (readyState !== undefined && readyState !== 1) {
      return { ok: false, error: `db_not_connected:readyState=${readyState}` };
    }
    const phoneHash =
      entry.phoneHash != null
        ? entry.phoneHash
        : resolveTurnLogPhoneHash(entry.phone).phoneHash;
    const conversationId = entry.conversationId;
    if (!conversationId) {
      return { ok: false, error: 'conversationId_required' };
    }
    const doc = {
      turnId: entry.turnId || generateCallId('turn'),
      conversationId,
      phoneHash: phoneHash || null,
      inboundId: entry.inboundId || null,
      promptVersion: entry.promptVersion || 'v1',
      promptHash: entry.promptHash || null,
      model: entry.model || null,
      inboundText: entry.inboundText || null,
      gateVerdicts: entry.gateVerdicts || [],
      profileBefore: entry.profileBefore || null,
      slotPatch: entry.slotPatch || null,
      profileAfter: entry.profileAfter || null,
      llmCalls: entry.llmCalls || [],
      toolCalls: (entry.toolTrace || entry.toolCalls || []).map((t) => ({
        name: t.name,
        args: t.args || null,
        result: t.result || null,
        latencyMs: t.latencyMs || null,
        failed: t.ok === false,
        refused: Boolean(t.refused),
      })),
      envelope: entry.envelope || null,
      validationVerdicts: entry.validationVerdicts || [],
      blocked: Boolean(entry.blocked),
      regenerated: Boolean(entry.regenerated),
      fallbackTier: entry.fallbackTier || null,
      sentParts: entry.sentParts || [],
      deliveryStatus: entry.deliveryStatus || (entry.mode === 'shadow' ? 'shadow_only' : null),
      latencyBreakdown: {
        totalMs: entry.latencyMs || null,
        ...(entry.latencyBreakdown || {}),
      },
    };
    await FlowV3TurnLog.create(doc);
    return { ok: true, turnId: doc.turnId };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { writeTurnLog };
