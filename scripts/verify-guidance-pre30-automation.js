#!/usr/bin/env node
/**
 * Verify guidance 30-min reminder scheduling + config for a mobile number.
 *
 * Usage: node scripts/verify-guidance-pre30-automation.js 9347763131
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const gupshupLocal = path.join(__dirname, '../.env.gupshup.local');
if (require('fs').existsSync(gupshupLocal)) {
  require('dotenv').config({ path: gupshupLocal, override: true });
}

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const GuidanceSlot = require('../models/GuidanceSlot');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const {
  computeGuidancePre30ScheduledSendAt,
  getGuidancePre30ScheduleDecision,
  getGuidancePre30ReminderEligibility,
} = require('../utils/guidanceReminderEligibility');
const { computeExpiresAt } = require('../utils/waReminderJobExpiration');
const { isGupshupConfigured } = require('../services/gupshupService');

function parseMobile(argv) {
  const flag = argv.find((a) => a.startsWith('--mobile='));
  if (flag) return flag.split('=')[1].replace(/\D/g, '').slice(-10);
  const positional = argv.find((a) => /^\d{10}$/.test(a.replace(/\D/g, '').slice(-10)));
  return positional ? positional.replace(/\D/g, '').slice(-10) : null;
}

async function main() {
  const mobile = parseMobile(process.argv.slice(2));
  if (!mobile) {
    console.error('Usage: node scripts/verify-guidance-pre30-automation.js <10-digit-mobile>');
    process.exit(1);
  }

  await connectDB();
  const now = new Date();

  console.log('\n=== Config ===');
  console.log({
    templateId: process.env.GUPSHUP_TEMPLATE_GUIDANCE_PRE30MIN_REMINDER || '(missing)',
    gupshupConfigured: isGupshupConfigured(),
    whatsappEnabled: process.env.ENABLE_WHATSAPP,
    integrationStub: process.env.WA_INTEGRATION_STUB || '0',
    cronSecretSet: Boolean(process.env.CRON_SECRET || process.env.GUIDEXPERT_CRON_SECRET),
    devCronLoop: process.env.DEV_GUIDANCE_REMINDER_CRON_LOOP || '0',
  });

  const lead = await OneOnOneCounselingLead.findOne({ mobileNumber: mobile }).lean();
  console.log('\n=== Lead ===');
  if (!lead) {
    console.log('No lead found — book from /guidance-booking-confirmation first.');
  } else {
    console.log({
      id: String(lead._id),
      name: lead.studentName,
      bookingConfirmed: lead.bookingConfirmed,
      selectedSlotId: lead.selectedSlotId ? String(lead.selectedSlotId) : null,
    });

    const slot = lead.selectedSlotId ? await GuidanceSlot.findById(lead.selectedSlotId).lean() : null;
    if (slot) {
      const sendAt = computeGuidancePre30ScheduledSendAt(slot);
      const scheduleDecision = getGuidancePre30ScheduleDecision(slot, now);
      const dispatchElig = getGuidancePre30ReminderEligibility(slot, now);
      const slotStart = scheduleDecision.slotAt || (sendAt ? new Date(sendAt.getTime() + 30 * 60 * 1000) : null);
      console.log('\n=== Slot timing (IST) ===');
      console.log({
        sessionTitle: slot.sessionTitle,
        slotDate: slot.slotDate,
        slotTime: slot.slotTime,
        scheduledSendAtIso: sendAt?.toISOString(),
        minutesUntilSend: sendAt ? Math.round((sendAt - now) / 60000) : null,
        scheduleDecision,
        dispatchEligibilityNow: dispatchElig,
        expiresAtIso: slotStart ? computeExpiresAt('guidance_pre30min', slotStart).toISOString() : null,
      });
    } else {
      console.log('No slot on lead.');
    }

    const job = await WhatsAppReminderJob.findOne({
      oneOnOneCounselingLeadId: lead._id,
      messageKind: 'guidance_pre30min',
    }).lean();
    console.log('\n=== Reminder job ===');
    if (!job) {
      console.log('No guidance_pre30min job — schedule runs only after confirmed booking with slot >30 min away.');
    } else {
      console.log({
        state: job.state,
        scheduledSendAt: job.scheduledSendAt,
        expiresAt: job.expiresAt,
        suppressionReason: job.suppressionReason,
        dueNow: job.scheduledSendAt && new Date(job.scheduledSendAt) <= now,
      });
    }
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
