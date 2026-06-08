/**
 * Unassign Hindi IIT counselling leads from a BDA that were assigned on a given IST day.
 *
 * Usage:
 *   node scripts/unassignBdaHindiLeadsByDate.js --dry-run
 *   node scripts/unassignBdaHindiLeadsByDate.js --bda "Dipika" --date 2026-06-03
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../config/db');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, bdaPattern: 'dipika', date: '2026-06-03' };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') out.dryRun = true;
    else if (args[i] === '--bda' && args[i + 1]) {
      out.bdaPattern = args[i + 1];
      i += 1;
    } else if (args[i] === '--date' && args[i + 1]) {
      out.date = args[i + 1];
      i += 1;
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) {
    throw new Error('--date must be YYYY-MM-DD');
  }
  return out;
}

function istDayRange(ymd) {
  const start = new Date(`${ymd}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function main() {
  const { dryRun, bdaPattern, date } = parseArgs();
  const { start, end } = istDayRange(date);
  const bdaRegex = new RegExp(bdaPattern.trim(), 'i');

  await connectDB();

  const bda = await Bda.findOne({ name: bdaRegex, status: 'active' }).lean();
  if (!bda) {
    console.error(`No active BDA matching name: ${bdaPattern}`);
    process.exit(1);
  }

  const filter = {
    submissionType: 'iitCounselling',
    assignedBdaId: bda._id,
    assignedAt: { $gte: start, $lt: end },
    'iitCounselling.section2Data.preferredLanguage': 'Hindi',
  };

  const leads = await IitCounsellingSubmission.find(filter)
    .select('fullName phone assignedAt assignedBdaName')
    .sort({ assignedAt: 1 })
    .lean();

  console.log(`BDA: ${bda.name} (${bda._id})`);
  console.log(`IST date: ${date} (${start.toISOString()} – ${end.toISOString()})`);
  console.log(`Hindi leads to unassign: ${leads.length}`);

  if (leads.length === 0) {
    await IitCounsellingSubmission.db.close();
    process.exit(0);
  }

  for (const lead of leads) {
    console.log(`  ${lead.phone}  ${lead.fullName}`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no changes written');
    await IitCounsellingSubmission.db.close();
    process.exit(0);
  }

  const now = new Date();
  const leadIds = leads.map((l) => l._id);

  const updateResult = await IitCounsellingSubmission.updateMany(
    { _id: { $in: leadIds } },
    {
      $set: {
        assignedBdaId: null,
        assignedBdaName: '',
        assignedAt: null,
        assignedBy: '',
        assignedByAdminId: null,
        assignedByAdminName: '',
        lastActivityAt: now,
        updatedAt: now,
      },
    }
  );

  const activities = leadIds.map((leadId) => ({
    leadId,
    bdaId: bda._id,
    bdaName: bda.name,
    actorType: 'admin',
    actorName: 'script:unassignBdaHindiLeadsByDate',
    eventType: 'assignment',
    fromValue: String(bda._id),
    toValue: '',
    remark: `Unassigned Hindi leads assigned on ${date} (IST) from ${bda.name}`,
    createdAt: now,
  }));
  await IitCounsellingLeadActivity.insertMany(activities);

  console.log(`\nUnassigned ${updateResult.modifiedCount} lead(s).`);
  await IitCounsellingSubmission.db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
