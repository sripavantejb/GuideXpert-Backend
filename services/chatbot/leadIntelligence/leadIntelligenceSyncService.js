'use strict';

/**
 * Fire-and-forget sync: BotState.leadProfile → WhatsAppLeadProfile + WhatsAppLeadScore.
 * Must never throw into the LLM-only inbound path.
 */

const mongoose = require('mongoose');
const WhatsAppLeadProfile = require('../../../models/WhatsAppLeadProfile');
const WhatsAppLeadScore = require('../../../models/WhatsAppLeadScore');
const { computeLeadScoreFromProfile } = require('./leadScoreFromProfile');
const { maskPhoneTail } = require('../../../utils/chatbotPhone');

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 512);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value) && value.length) {
      return value
        .map((v) => String(v).trim())
        .filter(Boolean)
        .join(', ')
        .slice(0, 512);
    }
  }
  return null;
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v && v !== 'false' && v !== '0' && v !== 'no' && v !== 'none' && v !== 'null';
  }
  return false;
}

function mapProfileFields(leadProfile = {}) {
  const p = leadProfile && typeof leadProfile === 'object' ? leadProfile : {};
  const budget = firstNonEmpty(p.budget);
  return {
    branchInterest: firstNonEmpty(p.branchInterest, p.course_interest),
    collegeInterest: firstNonEmpty(p.shortlist, p.best_match, p.city_pref),
    exam: firstNonEmpty(p.exam),
    languagePreference: null,
    priceSensitive: Boolean(budget && /lakh|budget|afford|cheap|fee/i.test(String(budget))),
    demoInterested: isTruthyFlag(p.booking_status),
    handoffRequested: isTruthyFlag(p.handoff_status) || isTruthyFlag(p.escalate_human),
  };
}

/**
 * Upsert lead intelligence docs from the live LLM profile.
 * @param {{ conversation: object, leadProfile: object }} args
 */
async function syncLeadIntelligence({ conversation, leadProfile } = {}) {
  if (!conversation?._id || !conversation?.phone) return null;
  // Avoid mongoose buffering timeouts in unit tests / cold starts.
  if (mongoose.connection.readyState !== 1) return null;

  const phone = String(conversation.phone).trim();
  if (!/^\d{10}$/.test(phone)) return null;

  const now = new Date();
  const mapped = mapProfileFields(leadProfile);
  const scored = computeLeadScoreFromProfile(leadProfile, {
    messageCount: conversation.messageCount || 0,
  });

  const profileSet = {
    phone,
    conversationId: conversation._id,
    lastInteractionAt: now,
    ...mapped,
    metadata: {
      source: 'llm_only_sidecar',
      syncedAt: now.toISOString(),
      llmProfileKeys: Object.keys(leadProfile || {}),
    },
  };

  for (const key of ['branchInterest', 'collegeInterest', 'exam', 'languagePreference']) {
    if (profileSet[key] == null) delete profileSet[key];
  }

  await WhatsAppLeadProfile.findOneAndUpdate(
    { phone },
    {
      $set: profileSet,
      $setOnInsert: {
        firstInteractionAt: now,
        eventCount: 0,
        assistantTypesUsed: [],
      },
      $inc: { eventCount: 1 },
    },
    { upsert: true, new: true }
  );

  await WhatsAppLeadScore.findOneAndUpdate(
    { phone },
    {
      $set: {
        phone,
        conversationId: conversation._id,
        leadScore: scored.leadScore,
        leadStage: scored.leadStage,
        scoreReasons: scored.scoreReasons,
        confidence: scored.confidence,
        lastScoredAt: now,
        metadata: {
          source: 'llm_only_sidecar',
          syncedAt: now.toISOString(),
        },
      },
      $setOnInsert: {
        firstScoredAt: now,
      },
    },
    { upsert: true, new: true }
  );

  return {
    phone,
    leadScore: scored.leadScore,
    leadStage: scored.leadStage,
  };
}

/**
 * Non-blocking wrapper — logs errors, never throws.
 */
function syncLeadIntelligenceSafe({ conversation, leadProfile } = {}) {
  Promise.resolve()
    .then(() => syncLeadIntelligence({ conversation, leadProfile }))
    .catch((err) => {
      console.warn(
        '[leadIntelligenceSync] skipped',
        maskPhoneTail(conversation?.phone),
        err?.message || err
      );
    });
}

module.exports = {
  syncLeadIntelligence,
  syncLeadIntelligenceSafe,
  mapProfileFields,
};
