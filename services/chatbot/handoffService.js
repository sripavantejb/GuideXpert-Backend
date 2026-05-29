const WhatsAppAgentHandoff = require('../../models/WhatsAppAgentHandoff');
const WhatsAppConversation = require('../../models/WhatsAppConversation');
const IitCounsellingSubmission = require('../../models/IitCounsellingSubmission');
const { buildHandoffSummary } = require('./leadContextService');
const { setConversationHandoff, clearConversationHandoff } = require('./conversationService');
const { transitionState } = require('./botStateService');
const whatsappOutbound = require('./whatsappOutboundService');
const { emptySubflows } = require('./botSubflowContext');

function handoffExpiryMs() {
  const h = parseInt(process.env.CHATBOT_HANDOFF_EXPIRY_HOURS || '4', 10);
  return (Number.isFinite(h) && h > 0 ? h : 4) * 60 * 60 * 1000;
}

function unclaimedAlertMs() {
  const m = parseInt(process.env.CHATBOT_HANDOFF_UNCLAIMED_MINUTES || '15', 10);
  return (Number.isFinite(m) && m > 0 ? m : 15) * 60 * 1000;
}

/**
 * Route: IIT lead with assigned BDA → bda; else admin_pool.
 */
async function determineRoute(leadContext) {
  if (leadContext.hasIit && leadContext.iit) {
    const iitSub = await IitCounsellingSubmission.findOne({ phone: leadContext.phone })
      .select('assignedBdaId assignedBdaName')
      .lean();
    if (iitSub && iitSub.assignedBdaId) {
      return { route: 'bda', assignedBdaId: iitSub.assignedBdaId };
    }
  }
  return { route: 'admin_pool', assignedBdaId: null };
}

async function createHandoff({
  conversation,
  leadContext,
  reason = 'user_requested',
  userLastMessage = null,
  createdBy = 'bot',
}) {
  const now = new Date();
  const routing = await determineRoute(leadContext);
  const summary = await buildHandoffSummary(leadContext);

  const handoff = await WhatsAppAgentHandoff.create({
    conversationId: conversation._id,
    phone: conversation.phone,
    productLine: conversation.productLine,
    status: routing.route === 'bda' ? 'open' : 'open',
    route: routing.route,
    assignedBdaId: routing.assignedBdaId,
    assignedAdminId: null,
    expiresAt: new Date(now.getTime() + handoffExpiryMs()),
    reason,
    userLastMessage: userLastMessage ? String(userLastMessage).slice(0, 2000) : null,
    summaryForAgent: summary,
    formSubmissionId: conversation.formSubmissionId || null,
    iitCounsellingSubmissionId: conversation.iitCounsellingSubmissionId || null,
    botPaused: true,
    createdBy,
  });

  await setConversationHandoff(conversation._id, handoff._id, now);
  await transitionState(conversation._id, conversation.phone, 'human_handoff', emptySubflows(), { now });

  const routeLabel =
    routing.route === 'bda'
      ? 'Your assigned counsellor team will respond shortly.'
      : 'Our support team will respond shortly.';

  await whatsappOutbound.sendBotTextReply({
    conversationId: conversation._id,
    phone10: conversation.phone,
    text: `Thanks — I've connected you with a human agent. ${routeLabel}\n\nPlease wait; we will reply here on WhatsApp.`,
    handoffId: handoff._id,
  });

  return handoff;
}

async function claimHandoff(handoffId, { adminId = null, bdaId = null }) {
  const now = new Date();
  const handoff = await WhatsAppAgentHandoff.findById(handoffId);
  if (!handoff || !['open', 'claimed'].includes(handoff.status)) {
    return { success: false, error: 'handoff_not_available' };
  }

  if (bdaId && handoff.route === 'bda' && handoff.assignedBdaId) {
    if (String(handoff.assignedBdaId) !== String(bdaId)) {
      return { success: false, error: 'not_assigned_bda' };
    }
  }

  const set = {
    status: 'claimed',
    claimedAt: handoff.claimedAt || now,
    updatedAt: now,
  };
  if (adminId) set.assignedAdminId = adminId;
  if (bdaId) set.assignedBdaId = bdaId;

  const updated = await WhatsAppAgentHandoff.findOneAndUpdate(
    { _id: handoffId, status: { $in: ['open', 'claimed'] } },
    { $set: set },
    { new: true }
  );
  if (!updated) return { success: false, error: 'claim_failed' };
  return { success: true, handoff: updated };
}

/**
 * BDA resolve authorization (pure, testable).
 * @param {object|null} handoff
 * @param {import('mongoose').Types.ObjectId|string|null} bdaId
 */
function assertBdaCanResolveHandoff(handoff, bdaId) {
  if (bdaId == null) {
    return { ok: true };
  }
  if (!handoff) {
    return { ok: false, error: 'not_found' };
  }
  if (handoff.route !== 'bda') {
    return { ok: false, error: 'not_bda_handoff' };
  }
  if (!handoff.assignedBdaId || String(handoff.assignedBdaId) !== String(bdaId)) {
    return { ok: false, error: 'not_assigned' };
  }
  return { ok: true };
}

async function resolveHandoff(handoffId, { resolvedBy = 'admin', bdaId = null } = {}) {
  const existing = await WhatsAppAgentHandoff.findById(handoffId).lean();
  const auth = assertBdaCanResolveHandoff(existing, bdaId);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const now = new Date();
  const handoff = await WhatsAppAgentHandoff.findByIdAndUpdate(
    handoffId,
    {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        botPaused: false,
        updatedAt: now,
      },
    },
    { new: true }
  );
  if (!handoff) return { success: false, error: 'not_found' };

  await clearConversationHandoff(handoff.conversationId, now);
  await transitionState(handoff.conversationId, handoff.phone, 'main_menu', emptySubflows(), { now });

  await whatsappOutbound.sendBotTextReply({
    conversationId: handoff.conversationId,
    phone10: handoff.phone,
    text: 'This chat is back with the GuideXpert assistant. Reply MENU for options.',
  });

  return { success: true, handoff };
}

async function expireStaleHandoffs(limit = 50) {
  const now = new Date();
  const stale = await WhatsAppAgentHandoff.find({
    status: { $in: ['open', 'claimed'] },
    expiresAt: { $lte: now },
  })
    .limit(limit)
    .lean();

  let count = 0;
  for (const h of stale) {
    await WhatsAppAgentHandoff.updateOne(
      { _id: h._id },
      { $set: { status: 'expired', botPaused: false, updatedAt: now } }
    );
    await clearConversationHandoff(h.conversationId, now);
    await transitionState(h.conversationId, h.phone, 'main_menu', emptySubflows(), { now });
    await whatsappOutbound.sendBotTextReply({
      conversationId: h.conversationId,
      phone10: h.phone,
      text: 'Our team could not join this chat in time. Reply MENU to continue with the assistant or AGENT to try again.',
    });
    count += 1;
  }
  return { expired: count };
}

async function cancelActiveHandoffForUser(conversation) {
  if (!conversation || conversation.status !== 'handoff' || !conversation.currentHandoffId) {
    return { cancelled: false };
  }
  const now = new Date();
  const handoff = await WhatsAppAgentHandoff.findOneAndUpdate(
    {
      _id: conversation.currentHandoffId,
      status: { $in: ['open', 'claimed'] },
    },
    {
      $set: {
        status: 'cancelled',
        botPaused: false,
        updatedAt: now,
      },
    },
    { new: true }
  );
  if (!handoff) {
    return { cancelled: false };
  }
  await clearConversationHandoff(conversation._id, now);
  await transitionState(conversation._id, conversation.phone, 'main_menu', emptySubflows(), { now });
  return { cancelled: true, handoff };
}

async function isBotPausedForConversation(conversation) {
  if (conversation.status === 'handoff' && conversation.currentHandoffId) {
    const h = await WhatsAppAgentHandoff.findById(conversation.currentHandoffId).lean();
    return h && ['open', 'claimed'].includes(h.status) && h.botPaused;
  }
  return false;
}

module.exports = {
  createHandoff,
  claimHandoff,
  resolveHandoff,
  assertBdaCanResolveHandoff,
  expireStaleHandoffs,
  isBotPausedForConversation,
  cancelActiveHandoffForUser,
  determineRoute,
  handoffExpiryMs,
  unclaimedAlertMs,
};
