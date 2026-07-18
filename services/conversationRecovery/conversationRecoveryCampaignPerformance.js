'use strict';

const ConversationRecoveryAttempt = require('../../models/ConversationRecoveryAttempt');
const ConversationRecoveryCase = require('../../models/ConversationRecoveryCase');
const ConversationRecoverySnapshot = require('../../models/ConversationRecoverySnapshot');

async function metricsForWindow(hours, now = new Date()) {
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const [eligible, sent, delivered, read, replies, recovered, bookings] =
    await Promise.all([
      ConversationRecoverySnapshot.countDocuments({
        recoveryEligibleHint: true,
        lastActivityAt: { $gte: from, $lte: now },
      }),
      ConversationRecoveryAttempt.countDocuments({
        sentAt: { $gte: from, $lte: now },
        deliveryStatus: { $in: ['sent', 'delivered', 'read'] },
      }),
      ConversationRecoveryAttempt.countDocuments({
        deliveredAt: { $gte: from, $lte: now },
        deliveryStatus: { $in: ['delivered', 'read'] },
      }),
      ConversationRecoveryAttempt.countDocuments({
        readAt: { $gte: from, $lte: now },
        deliveryStatus: 'read',
      }),
      ConversationRecoveryAttempt.countDocuments({
        repliedAt: { $gte: from, $lte: now },
      }),
      ConversationRecoveryCase.countDocuments({
        status: 'recovered',
        recoveredAt: { $gte: from, $lte: now },
      }),
      ConversationRecoveryCase.countDocuments({
        bookingCompletedAfterRecovery: true,
        updatedAt: { $gte: from, $lte: now },
      }),
    ]);

  const conversion = recovered > 0 ? bookings / recovered : 0;
  return {
    windowHours: hours,
    eligible,
    sent,
    delivered,
    read,
    replies,
    recovered,
    bookings,
    conversionPct: conversion,
  };
}

async function getCampaignPerformance({ now = new Date() } = {}) {
  const [h24, h72, d7] = await Promise.all([
    metricsForWindow(24, now),
    metricsForWindow(72, now),
    metricsForWindow(168, now),
  ]);
  return {
    campaign: 'conversation_recovery',
    windows: {
      '24_hour': h24,
      '72_hour': h72,
      '7_day': d7,
    },
  };
}

module.exports = {
  getCampaignPerformance,
  metricsForWindow,
};
