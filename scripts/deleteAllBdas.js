/**
 * Remove all BDA accounts and return their assigned leads to the unassigned pool.
 *
 * Usage:
 *   node scripts/deleteAllBdas.js              # dry-run (default)
 *   node scripts/deleteAllBdas.js --execute    # apply deletes
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Bda = require('../models/Bda');
const IitCounsellingSubmission = require('../models/IitCounsellingSubmission');
const LeadCallHistory = require('../models/LeadCallHistory');
const IitCounsellingLeadActivity = require('../models/IitCounsellingLeadActivity');

function parseArgs(argv) {
  return { execute: argv.slice(2).includes('--execute') };
}

async function run({ execute }) {
  const bdas = await Bda.find({}).select('_id name email phone language status').lean();
  const bdaIds = bdas.map((b) => b._id);

  const assignedLeads = await IitCounsellingSubmission.countDocuments({
    submissionType: 'iitCounselling',
    assignedBdaId: { $in: bdaIds },
  });

  const callHistory = bdaIds.length
    ? await LeadCallHistory.countDocuments({ bdaId: { $in: bdaIds } })
    : 0;
  const activities = bdaIds.length
    ? await IitCounsellingLeadActivity.countDocuments({ bdaId: { $in: bdaIds } })
    : 0;

  const stats = {
    execute,
    bdasToDelete: bdas.length,
    bdas: bdas.map((b) => ({
      id: String(b._id),
      name: b.name,
      email: b.email || '',
      phone: b.phone || '',
      language: b.language || '',
      status: b.status,
    })),
    assignedLeadsToUnassign: assignedLeads,
    callHistoryToDelete: callHistory,
    activitiesToDelete: activities,
  };

  if (!execute) {
    return stats;
  }

  if (bdaIds.length > 0) {
    const unassign = await IitCounsellingSubmission.updateMany(
      { assignedBdaId: { $in: bdaIds } },
      {
        $set: {
          assignedBdaId: null,
          assignedBdaName: '',
          assignedAt: null,
          assignedBy: '',
          assignedByAdminId: null,
          assignedByAdminName: '',
        },
      }
    );
    stats.leadsUnassigned = unassign.modifiedCount;

    const delCalls = await LeadCallHistory.deleteMany({ bdaId: { $in: bdaIds } });
    stats.callHistoryDeleted = delCalls.deletedCount;

    const delActs = await IitCounsellingLeadActivity.deleteMany({ bdaId: { $in: bdaIds } });
    stats.activitiesDeleted = delActs.deletedCount;
  }

  const delBdas = await Bda.deleteMany({});
  stats.bdasDeleted = delBdas.deletedCount;

  return stats;
}

async function main() {
  const { execute } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI (or MONGO_URI) is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Delete all BDAs (${execute ? 'EXECUTE' : 'DRY-RUN'})…`);

  const stats = await run({ execute });
  console.log(JSON.stringify(stats, null, 2));

  if (!execute) {
    console.log('\nDry-run only. Re-run with --execute to delete all BDAs and unassign leads.');
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run, parseArgs };
