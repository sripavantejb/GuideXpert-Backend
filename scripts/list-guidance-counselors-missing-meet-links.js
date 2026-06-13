#!/usr/bin/env node
/**
 * List active 1-on-1 counsellors that do not have a guidance meet link configured.
 *
 * Usage: node scripts/list-guidance-counselors-missing-meet-links.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { getActiveCounselorsMissingMeetLinks } = require('../services/guidanceMeetJoinService');
const { GUIDANCE_COUNSELOR_MEET_LINKS } = require('../constants/guidanceCounselorMeetLinks');

async function main() {
  await connectDB();

  const missing = await getActiveCounselorsMissingMeetLinks();

  console.log('Configured meet link keys:');
  for (const entry of GUIDANCE_COUNSELOR_MEET_LINKS) {
    console.log(`  - ${entry.keys.join(', ')} -> ${entry.url}`);
  }

  console.log('\nActive counsellors WITHOUT a meet link:');
  if (missing.length === 0) {
    console.log('  (none — all active counsellors are mapped)');
  } else {
    for (const name of missing) {
      console.log(`  - ${name}`);
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
