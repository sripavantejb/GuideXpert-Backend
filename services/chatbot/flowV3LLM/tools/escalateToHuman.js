'use strict';

const defaultHandoffService = require('../../handoffService');
const defaultWhatsAppAgentHandoff = require('../../../../models/WhatsAppAgentHandoff');

const CRISIS_MARKER = 'CRISIS_HANDOFF';

/** TODO(decision): add crisis_escalation to frozen HANDOFF_REASONS enum — see docs/hotfixes/crisis-escalation-handoff-reason.md */
const CRISIS_REASON_WORKAROUND = 'bot_escalation';

/**
 * @param {object} AgentHandoffModel
 * @param {string|object} conversationId
 */
async function findOpenHandoff(AgentHandoffModel, conversationId) {
  if (!conversationId) return null;
  return AgentHandoffModel.findOne({
    conversationId,
    status: { $in: ['open', 'claimed'] },
  })
    .sort({ createdAt: -1 })
    .lean();
}

function buildCrisisSummary(baseSummary, userLastMessage) {
  const base = String(baseSummary || '').trim();
  const msg = userLastMessage ? String(userLastMessage).slice(0, 500) : '';
  if (base.startsWith(`[${CRISIS_MARKER}]`)) return base;
  const parts = [`[${CRISIS_MARKER}]`];
  if (msg) parts.push(`Student message: ${msg}`);
  if (base) parts.push(base);
  return parts.join(' ');
}

/**
 * M-1 human escalation — wraps handoffService.createHandoff with DI.
 * Once per conversation except crisis. Crisis maps to bot_escalation + CRISIS_HANDOFF marker.
 * @param {{
 *   conversation?: object,
 *   leadContext?: object,
 *   reason?: string,
 *   userLastMessage?: string,
 *   crisis?: boolean,
 * }} args
 * @param {{ deps?: { createHandoff?: Function, WhatsAppAgentHandoff?: object } }} [_ctx]
 */
async function run(args = {}, _ctx = {}) {
  const createHandoff =
    (_ctx.deps && _ctx.deps.createHandoff) || defaultHandoffService.createHandoff;
  const AgentHandoffModel =
    (_ctx.deps && _ctx.deps.WhatsAppAgentHandoff) || defaultWhatsAppAgentHandoff;

  const conversation = args.conversation;
  if (!conversation || !conversation._id) {
    return { ok: false, error: 'missing_conversation' };
  }

  const crisis = args.crisis === true;
  const existing = await findOpenHandoff(AgentHandoffModel, conversation._id);

  if (!crisis && existing) {
    return {
      ok: true,
      idempotent: true,
      handoffId: String(existing._id),
      reason: existing.reason,
      status: existing.status,
    };
  }

  const handoffReason = crisis ? CRISIS_REASON_WORKAROUND : args.reason || 'user_requested';

  let handoff;
  try {
    handoff = await createHandoff({
      conversation,
      leadContext: args.leadContext || {},
      reason: handoffReason,
      userLastMessage: args.userLastMessage || null,
      createdBy: args.createdBy || 'bot',
    });
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : 'create_handoff_failed',
    };
  }

  if (crisis && handoff && handoff._id) {
    const crisisSummary = buildCrisisSummary(handoff.summaryForAgent, args.userLastMessage);
    await AgentHandoffModel.updateOne(
      { _id: handoff._id },
      {
        $set: {
          summaryForAgent: crisisSummary,
          expiresAt: null,
        },
        $push: {
          auditTrail: {
            action: 'crisis_marker',
            adminId: null,
            srCounsellor: null,
            meta: { marker: CRISIS_MARKER, workaroundReason: CRISIS_REASON_WORKAROUND },
            at: new Date(),
          },
        },
      }
    );
    return {
      ok: true,
      handoffId: String(handoff._id),
      reason: handoffReason,
      crisis: true,
      marker: CRISIS_MARKER,
      expiresAt: null,
    };
  }

  return {
    ok: true,
    handoffId: handoff ? String(handoff._id) : null,
    reason: handoffReason,
    crisis: false,
  };
}

module.exports = {
  run,
  CRISIS_MARKER,
  CRISIS_REASON_WORKAROUND,
  findOpenHandoff,
  buildCrisisSummary,
};
