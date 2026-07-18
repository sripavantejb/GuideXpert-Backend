'use strict';

const mongoose = require('mongoose');
const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');
const {
  deriveFlagsFromJourneyContext,
  mapStageToPhase,
} = require('./conversationRecoveryCore');

function pickStudentName(profile = {}) {
  return (
    profile.studentName ||
    profile.name ||
    profile.firstName ||
    null
  );
}

function cloneJourneyBlob(context = {}) {
  try {
    return JSON.parse(JSON.stringify(context || {}));
  } catch (_) {
    return { ...(context || {}) };
  }
}

function isMongoReady() {
  return mongoose.connection?.readyState === 1;
}

async function upsertFromTurn({
  phone,
  conversationId,
  productLine = 'guidexpert',
  context,
  lastActivityAt = new Date(),
} = {}) {
  if (!phone || !conversationId || !context) return null;
  // Avoid mongoose buffering timeouts in unit tests / cold starts without DB
  if (!isMongoReady()) return null;

  const profile = context.profile || {};
  const flags = deriveFlagsFromJourneyContext(context);
  const lastStage = context.stage || null;
  const lastStep = context.step || null;
  const lastPhase = mapStageToPhase(lastStage);
  const eligibleHint =
    !flags.journeyCompleted && !flags.bookingCompleted && !flags.optedOut;

  const doc = await ConversationRecoverySnapshot.findOneAndUpdate(
    { phone: String(phone), conversationId },
    {
      $set: {
        productLine: productLine || 'guidexpert',
        lastPhase,
        lastStage,
        lastStep,
        journeyBlob: cloneJourneyBlob(context),
        journeyCompleted: flags.journeyCompleted,
        bookingCompleted: flags.bookingCompleted,
        optedOut: flags.optedOut,
        lastActivityAt: lastActivityAt || new Date(),
        examName: profile.examName || profile.entranceExam || null,
        preferredCourse: profile.preferredCourse || null,
        studentName: pickStudentName(profile),
        recoveryEligibleHint: eligibleHint,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return doc;
}

async function getLatestSnapshotForPhone(phone) {
  return ConversationRecoverySnapshot.findOne({ phone: String(phone) })
    .sort({ lastActivityAt: -1 })
    .lean();
}

async function getSnapshotByConversation(conversationId) {
  return ConversationRecoverySnapshot.findOne({ conversationId }).lean();
}

module.exports = {
  upsertFromTurn,
  getLatestSnapshotForPhone,
  getSnapshotByConversation,
  cloneJourneyBlob,
  pickStudentName,
};
