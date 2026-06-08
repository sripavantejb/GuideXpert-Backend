/**
 * Split leads assigned to one BDA on an IST day equally across target BDAs (round-robin).
 *
 * Usage:
 *   node scripts/splitBdaLeadsByDate.js --dry-run --from Srilekha --to "Akash Patnam,Mathe Prudhvi Raj" --date 2026-06-03 --language Telugu
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../config/db');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const { assignLeadToBda } = require('../services/iitCounsellingLeadAssignmentService');

const ADMIN_ACTOR = { username: 'script:splitBdaLeadsByDate', name: 'System' };

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    dryRun: false,
    fromPattern: 'Srilekha',
    toNames: ['Akash Patnam', 'Mathe Prudhvi Raj'],
    date: '2026-06-03',
    language: 'Telugu',
    excludeHindiBda: true,
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') out.dryRun = true;
    else if (args[i] === '--from' && args[i + 1]) {
      out.fromPattern = args[i + 1];
      i += 1;
    } else if (args[i] === '--to' && args[i + 1]) {
      out.toNames = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (args[i] === '--date' && args[i + 1]) {
      out.date = args[i + 1];
      i += 1;
    } else if (args[i] === '--language' && args[i + 1]) {
      out.language = args[i + 1];
      i += 1;
    }
  }
  return out;
}

function istDayRange(ymd) {
  const start = new Date(`${ymd}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function findBdaByName(pattern, { language, excludeHindiInName } = {}) {
  const regex = new RegExp(`^${pattern.trim()}$`, 'i');
  const candidates = await Bda.find({ name: regex, status: 'active' }).lean();
  let list = candidates;
  if (language) list = list.filter((b) => b.language === language);
  if (excludeHindiInName) {
    list = list.filter((b) => !/hindi/i.test(b.name));
  }
  return list[0] || null;
}

async function main() {
  const opts = parseArgs();
  const { start, end } = istDayRange(opts.date);

  await connectDB();

  const fromBda = await findBdaByName(opts.fromPattern, {
    language: opts.language,
    excludeHindiInName: opts.excludeHindiBda,
  });
  if (!fromBda) {
    console.error(`Source BDA not found: ${opts.fromPattern} (${opts.language})`);
    process.exit(1);
  }

  const targetBdas = [];
  for (const name of opts.toNames) {
    const b = await findBdaByName(name, { language: opts.language });
    if (!b) {
      console.error(`Target BDA not found: ${name}`);
      process.exit(1);
    }
    targetBdas.push(b);
  }

  const filter = {
    submissionType: 'iitCounselling',
    assignedBdaId: fromBda._id,
    assignedAt: { $gte: start, $lt: end },
    'iitCounselling.section2Data.preferredLanguage': opts.language,
  };

  const leads = await IitCounsellingSubmission.find(filter)
    .select('fullName phone')
    .sort({ assignedAt: 1, _id: 1 })
    .lean();

  console.log(`From: ${fromBda.name} (${fromBda._id})`);
  console.log(`To: ${targetBdas.map((b) => b.name).join(', ')}`);
  console.log(`Date (IST): ${opts.date} | Language: ${opts.language}`);
  console.log(`Leads to split: ${leads.length}`);

  const plan = new Map(targetBdas.map((b) => [b.name, []]));
  leads.forEach((lead, i) => {
    const bda = targetBdas[i % targetBdas.length];
    plan.get(bda.name).push(lead);
  });

  for (const bda of targetBdas) {
    const batch = plan.get(bda.name);
    console.log(`\n${bda.name}: ${batch.length} lead(s)`);
    for (const lead of batch) {
      console.log(`  ${lead.phone}  ${lead.fullName}`);
    }
  }

  if (opts.dryRun) {
    console.log('\n--dry-run: no changes written');
    await IitCounsellingSubmission.db.close();
    process.exit(0);
  }

  const reason = `Split ${opts.language} leads from ${fromBda.name} (${opts.date} IST) equally`;
  let moved = 0;
  const failed = [];

  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    const bda = targetBdas[i % targetBdas.length];
    const out = await assignLeadToBda({
      leadId: lead._id,
      bdaId: bda._id,
      admin: ADMIN_ACTOR,
      reason,
      isReassign: true,
    });
    if (out.error) {
      failed.push({ leadId: String(lead._id), phone: lead.phone, message: out.error });
    } else {
      moved += 1;
    }
  }

  console.log(`\nReassigned ${moved} lead(s). Failed: ${failed.length}`);
  if (failed.length) console.log(failed);
  await IitCounsellingSubmission.db.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
