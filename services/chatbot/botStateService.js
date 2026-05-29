const WhatsAppBotState = require('../../models/WhatsAppBotState');

const SUBFLOW_TTL_MS = 30 * 60 * 1000;

async function getBotState(conversationId) {
  return WhatsAppBotState.findOne({ conversationId }).lean();
}

async function transitionState(conversationId, phone10, nextState, contextPatch = {}, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const existing = await WhatsAppBotState.findOne({ conversationId });
  const prev = existing ? existing.state : null;
  const context = {
    ...(existing && existing.context && typeof existing.context === 'object' ? existing.context : {}),
    ...contextPatch,
  };

  const stateExpiresAt = opts.stateExpiresAt
    || new Date(now.getTime() + (opts.ttlMs || SUBFLOW_TTL_MS));

  if (existing) {
    await WhatsAppBotState.updateOne(
      { _id: existing._id },
      {
        $set: {
          state: nextState,
          previousState: prev,
          context,
          stateEnteredAt: now,
          stateExpiresAt,
          updatedAt: now,
        },
        $inc: { version: 1 },
      }
    );
  } else {
    await WhatsAppBotState.create({
      conversationId,
      phone: phone10,
      state: nextState,
      previousState: prev,
      context,
      stateEnteredAt: now,
      stateExpiresAt,
    });
  }

  return { state: nextState, context };
}

async function resetToMainMenu(conversationId, phone10) {
  return transitionState(conversationId, phone10, 'main_menu', {}, { ttlMs: SUBFLOW_TTL_MS });
}

module.exports = {
  getBotState,
  transitionState,
  resetToMainMenu,
  SUBFLOW_TTL_MS,
};
