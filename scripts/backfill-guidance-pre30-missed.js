#!/usr/bin/env node
/**
 * Backfill guidance_pre30min reminder jobs for confirmed bookings missing a job row.
 *
 * Usage:
 *   node scripts/backfill-guidance-pre30-missed.js
 *   node scripts/backfill-guidance-pre30-missed.js --slotDate=2026-06-14
 *   node scripts/backfill-guidance-pre30-missed.js --slotDate=2026-06-14 --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { repairMissingGuidanceReminderJobs } = require('../services/guidanceReminderRepairService');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const GuidanceSlot = require('../models/GuidanceSlot');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');

function parseArgs(argv) {
  const slotDateFlag = argv.find((a) => a.startsWith('--slotDate='));
  const slotDate = slotDateFlag ? slotDateFlag.split('=')[1].trim() : null;
  const dryRun = argv.includes('--dry-run');
  const limitFlag = argv.find((a) => a.startsWith('--limit='));
  const limit = limitFlag ? parseInt(limitFlag.split('=')[1], 10) : 500;
  return { slotDate, dryRun, limit };
}

async function countMissing(slotDate) {
  const leadQuery = { bookingConfirmed: true, selectedSlotId: { $ne: null } };
  if (slotDate) {
    const slots = await GuidanceSlot.find({ slotDate, isActive: true }).select('_id').lean();
    const slotIds = slots.map((s) => s._id);
    if (!slotIds.length) return { leads: 0, missing: 0 };
    leadQuery.selectedSlotId = { $in: slotIds };
  }
  const leads = await OneOnOneCounselingLead.find(leadQuery).select('_id').lean();
  if (!leads.length) return { leads: 0, missing: 0 };
  const jobs = await WhatsAppReminderJob.find({
    messageKind: 'guidance_pre30min',
    oneOnOneCounselingLeadId: { $in: leads.map((l) => l._id) },
  })
    .select('oneOnOneCounselingLeadId')
    .lean();
  const hasJob = new Set(jobs.map((j) => String(j.oneOnOneCounselingLeadId)));
  const missing = leads.filter((l) => !hasJob.has(String(l._id))).length;
  return { leads: leads.length, missing };
}

async function main() {
  const { slotDate, dryRun, limit } = parseArgs(process.argv.slice(2));
  await connectDB();

  const before = await countMissing(slotDate);
  console.log('Before:', { slotDate: slotDate || '(all)', ...before });

  if (dryRun) {
    console.log('[dry-run] No jobs created.');
    await mongoose.disconnect();
    return;
  }

  const result = await repairMissingGuidanceReminderJobs({ slotDate, limit });
  const after = await countMissing(slotDate);
  console.log('Repair:', result);
  console.log('After:', { slotDate: slotDate || '(all)', ...after });

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
