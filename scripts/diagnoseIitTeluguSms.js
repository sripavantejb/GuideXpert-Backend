/**
 * Diagnose IIT counselling Telugu SMS jobs for one phone (or all recent Telugu rows).
 *
 * Usage:
 *   node scripts/diagnoseIitTeluguSms.js --phone 9876543210
 *   node scripts/diagnoseIitTeluguSms.js --phone 9876543210 --simulate-cron
 *   node scripts/diagnoseIitTeluguSms.js --list-recent 5
 *
 * Requires MONGODB_URI in .env (use production URI to match Vercel cron).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitTeluguSmsReminderJob = require('../models/IitTeluguSmsReminderJob');
const { IIT_TELUGU_SMS_MESSAGE_KINDS } = require('../models/IitTeluguSmsReminderJob');
const { buildAllTriggerSchedules, cronWindowMs } = require('../utils/iitTeluguSmsSchedule');
const {
  resolveTemplateId,
  buildFlowVariablesForKind,
  isStaticTeluguSmsTemplate,
} = require('../config/iitTeluguSmsTemplates');

const KIND_LABELS = {
  iit_sms_tminus_1d: 'T-1 day (static)',
  iit_sms_tminus_2h: 'T-2 hours (static)',
  iit_sms_session_8am: 'Session day 8:00 AM IST (static)',
  iit_sms_tminus_30m: 'T-30 min (meet link)',
  iit_sms_tminus_5m: 'T-5 min (meet link)',
  iit_sms_tplus_5m: 'T+5 min (meet link)',
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const phoneIdx = args.indexOf('--phone');
  const listIdx = args.indexOf('--list-recent');
  return {
    phone: phoneIdx >= 0 ? String(args[phoneIdx + 1] || '').replace(/\D/g, '').slice(-10) : '',
    listRecent: listIdx >= 0 ? parseInt(args[listIdx + 1], 10) || 5 : 0,
    simulateCron: args.includes('--simulate-cron'),
  };
}

function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 4) return '****';
  return `******${p.slice(-4)}`;
}

function fmtIst(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

function fmtIso(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString();
}

function mongoDbHint(uri) {
  if (!uri) return '(no MONGODB_URI)';
  try {
    const u = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'https://'));
    const host = u.hostname || 'unknown-host';
    const db = (u.pathname || '').replace(/^\//, '') || 'default';
    return `${host} / db: ${db}`;
  } catch {
    return '(custom connection string)';
  }
}

function wouldCronClaim(job, now) {
  if (!job || job.state !== 'pending') return { claimable: false, reason: `state is ${job.state}` };
  const sched = job.scheduledSendAt ? new Date(job.scheduledSendAt).getTime() : NaN;
  const exp = job.expiresAt ? new Date(job.expiresAt).getTime() : NaN;
  const nowMs = now.getTime();
  if (Number.isNaN(sched) || sched > nowMs) {
    return { claimable: false, reason: `scheduledSendAt ${fmtIst(job.scheduledSendAt)} is still in the future` };
  }
  if (!Number.isNaN(exp) && exp <= nowMs) {
    return { claimable: false, reason: `expired at ${fmtIst(job.expiresAt)}` };
  }
  const lease = job.leaseExpiresAt ? new Date(job.leaseExpiresAt).getTime() : 0;
  if (lease > nowMs) {
    return { claimable: false, reason: `lease active until ${fmtIst(job.leaseExpiresAt)}` };
  }
  return { claimable: true, reason: 'yes — due now' };
}

function printExpectedSchedule(slotAt, section2At) {
  const now = new Date();
  const atSection2 = section2At ? new Date(section2At) : now;
  const expected = buildAllTriggerSchedules(slotAt, atSection2);
  console.log('\n--- Expected triggers (if Section 2 saved at', fmtIst(atSection2), ') ---');
  for (const kind of IIT_TELUGU_SMS_MESSAGE_KINDS) {
    const e = expected[kind];
    const vars = buildFlowVariablesForKind(kind);
    const varNote = isStaticTeluguSmsTemplate(kind)
      ? 'no variables'
      : `var=${vars.var || '(missing link)'}`;
    console.log(`  ${KIND_LABELS[kind] || kind}`);
    console.log(`    scheduled: ${fmtIst(e.scheduledSendAt)}  state@schedule: ${e.state}  (${e.suppressionReason || 'ok'})`);
    console.log(`    expires:   ${fmtIst(e.expiresAt)}  sendImmediately: ${!!e.sendImmediately}  ${varNote}`);
  }
  console.log(`  cron window: ${cronWindowMs() / 60000} min after scheduledSendAt`);
  console.log('  now (IST):', fmtIst(now));
}

function printJobRow(job, now) {
  const claim = wouldCronClaim(job, now);
  const vars = job.templateVariables || {};
  console.log(`\n  [${job.messageKind}] ${KIND_LABELS[job.messageKind] || ''}`);
  console.log(`    state: ${job.state}  suppression: ${job.suppressionReason || '—'}`);
  console.log(`    scheduledSendAt: ${fmtIst(job.scheduledSendAt)} (${fmtIso(job.scheduledSendAt)})`);
  console.log(`    expiresAt:       ${fmtIst(job.expiresAt)}`);
  console.log(`    templateId:      ${job.msg91TemplateId}`);
  console.log(`    variables:       ${Object.keys(vars).length ? JSON.stringify(vars) : '(none — static SMS)'}`);
  console.log(`    attempts: ${job.attempts || 0}  lastError: ${job.lastError || '—'}`);
  if (job.dispatchedAt) console.log(`    dispatchedAt: ${fmtIst(job.dispatchedAt)}`);
  console.log(`    cron would claim now? ${claim.claimable ? 'YES' : 'NO'} — ${claim.reason}`);
}

async function diagnosePhone(phone, opts = {}) {
  const now = new Date();
  const sub = await IitCounsellingSubmission.findOne({ phone }).lean();
  console.log('\n========== IIT Telugu SMS diagnosis ==========');
  console.log('Phone:', maskPhone(phone));
  console.log('Mongo:', mongoDbHint(process.env.MONGODB_URI));
  console.log('Now:', fmtIst(now), '|', now.toISOString());

  if (!sub) {
    console.log('\n❌ No IitCounsellingSubmission for this phone in this database.');
    console.log('   → Form may be on a different DB (local vs production) or phone mismatch.');
    const anyJobs = await IitTeluguSmsReminderJob.find({ phone }).lean();
    if (anyJobs.length) {
      console.log(`\n⚠ Found ${anyJobs.length} SMS job(s) without submission (orphan jobs):`);
      anyJobs.forEach((j) => printJobRow(j, now));
    }
    return { found: false, jobs: anyJobs.length };
  }

  const s2 = sub.iitCounselling?.section2Data || {};
  const s1 = sub.iitCounselling?.section1Data || {};
  const lang = s2.preferredLanguage || '(not set)';
  const slotAt = sub.counsellingSlotInstantUtc ? new Date(sub.counsellingSlotInstantUtc) : null;

  console.log('\n--- Submission ---');
  console.log('  submissionId:', String(sub._id));
  console.log('  preferredLanguage:', lang);
  console.log('  slotBooking:', s1.slotBooking || '—');
  console.log('  counsellingSlotInstantUtc:', fmtIst(slotAt), '|', fmtIso(slotAt));
  console.log('  section2 submittedAt:', fmtIst(s2.submittedAt));

  if (lang !== 'Telugu') {
    console.log('\n⚠ Language is not Telugu — Telugu SMS jobs should be cancelled / not created.');
  }
  if (!slotAt || Number.isNaN(slotAt.getTime())) {
    console.log('\n❌ No valid counsellingSlotInstantUtc — SMS cannot schedule.');
  } else {
    printExpectedSchedule(slotAt, s2.submittedAt || now);
  }

  const jobs = await IitTeluguSmsReminderJob.find({
    $or: [{ phone }, { iitCounsellingSubmissionId: sub._id }],
  })
    .sort({ scheduledSendAt: 1 })
    .lean();

  const claimable = jobs.filter((j) => wouldCronClaim(j, now).claimable);

  console.log('\n--- SMS jobs in DB:', jobs.length, '---');
  if (jobs.length === 0) {
    console.log('❌ No IitTeluguSmsReminderJob rows.');
    console.log('   → Complete Section 2 with Telugu on THIS environment, or run:');
    console.log('     node scripts/backfillIitTeluguSmsJobs.js --execute --include-today');
  } else {
    for (const j of jobs) printJobRow(j, now);
    console.log('\n--- Summary ---');
    console.log(`  Claimable by cron right now: ${claimable.length} / ${jobs.length}`);
    if (claimable.length === 0 && jobs.some((j) => j.state === 'pending')) {
      console.log('  → Pending jobs exist but not due yet, expired, or leased.');
    }
    if (jobs.every((j) => j.state === 'skipped')) {
      console.log('  → All skipped (often missed_window for T-1d / 8am if form completed late).');
    }
  }

  if (opts.simulateCron && claimable.length > 0) {
    console.log('\n--- Simulate cron dispatch (dry) ---');
    console.log('  Would attempt MSG91 for:', claimable.map((j) => j.messageKind).join(', '));
    console.log('  MSG91_AUTH_KEY:', process.env.MSG91_AUTH_KEY ? 'set' : 'MISSING');
  }

  console.log('\n--- Production cron URL ---');
  console.log('  GET /api/cron/send-iit-telugu-sms?key=<GUIDEXPERT_CRON_SECRET or CRON_SECRET>');
  console.log('  (Not the same as /api/cron/send-iit-reminders — that is WhatsApp only.)');
  console.log('==============================================\n');

  return { found: true, submissionId: sub._id, jobs: jobs.length, lang };
}

async function listRecent(n) {
  const subs = await IitCounsellingSubmission.find({
    'iitCounselling.section2Data.preferredLanguage': 'Telugu',
    'iitCounselling.section2Data.submittedAt': { $exists: true },
  })
    .sort({ 'iitCounselling.section2Data.submittedAt': -1 })
    .limit(n)
    .select('phone counsellingSlotInstantUtc iitCounselling.section2Data.submittedAt')
    .lean();

  console.log('\nRecent Telugu Section-2 submissions (this database):', mongoDbHint(process.env.MONGODB_URI));
  if (!subs.length) console.log('  (none)');
  for (const s of subs) {
    console.log(
      `  ${maskPhone(s.phone)}  slot ${fmtIst(s.counsellingSlotInstantUtc)}  s2 ${fmtIst(s.iitCounselling?.section2Data?.submittedAt)}  id ${s._id}`
    );
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set in .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    if (args.listRecent > 0) {
      await listRecent(args.listRecent);
      if (!args.phone) return;
    }

    if (!args.phone || args.phone.length !== 10) {
      console.error('Usage: node scripts/diagnoseIitTeluguSms.js --phone <10-digit>');
      console.error('       node scripts/diagnoseIitTeluguSms.js --list-recent 10');
      process.exit(1);
    }

    await diagnosePhone(args.phone, { simulateCron: args.simulateCron });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { diagnosePhone, wouldCronClaim };
