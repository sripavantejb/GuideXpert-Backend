/**
 * Manual end-to-end test for WhatsApp college predictor (same code path as live chatbot).
 *
 * Usage:
 *   node scripts/manualWhatsAppCollegePredictor.js
 *   node scripts/manualWhatsAppCollegePredictor.js --ts-bcb-male
 *   node scripts/manualWhatsAppCollegePredictor.js --ap-oc-female-au
 */
require('dotenv').config();

const { handleCollegePredictorMessage } = require('../services/chatbot/collegePredictorChatService');
const { fetchCollegeDostColleges } = require('../services/collegePredictorCore');
const { getPredictorAccessToken } = require('../services/collegeDostService');

const SCENARIOS = {
  'ts-bcb-male': ['2', '20000', '3', '1'],
  'ts-oc-female': ['2', '15000', '1', '2'],
  'ap-oc-female-au': ['1', '5000', '1', '2', '1'],
};

async function runSteps(label, steps) {
  console.log(`\n--- WhatsApp flow: ${label} ---`);
  let ctx = {};
  for (let i = 0; i < steps.length; i++) {
    const text = steps[i];
    const r = await handleCollegePredictorMessage(text, ctx.college || ctx, {
      isNewEntry: i === 0,
    });
    ctx = { college: r.context };
    console.log(`> ${text}`);
    console.log(r.reply);
    if (r.clearState) console.log('[state cleared]');
  }
}

async function main() {
  const token = getPredictorAccessToken();
  console.log('Token source:', process.env.NW_PREDICTORS_ACCESS_TOKEN ? 'NW_PREDICTORS_ACCESS_TOKEN' : process.env.COLLEGEDOST_ACCESS_TOKEN ? 'COLLEGEDOST_ACCESS_TOKEN' : 'NONE');
  console.log('Token configured:', Boolean(token), token ? `(${token.length} chars)` : '');

  try {
    await fetchCollegeDostColleges('TS_EAMCET', 0, 3, {
      exam: 'TS_EAMCET',
      rank: 20000,
      reservation_category_codes: ['BCB BOYS'],
    });
    console.log('Direct counsellor-style API call: OK');
  } catch (err) {
    console.error('Direct counsellor-style API call: FAIL', {
      http_status_code: err.http_status_code,
      res_status: err.res_status,
      response: err.response,
      upstreamDetail: err.upstreamBody?.detail,
    });
  }

  const arg = process.argv[2] || '--ts-bcb-male';
  const key = arg.replace(/^--/, '');
  const steps = SCENARIOS[key];
  if (!steps) {
    console.error('Unknown scenario. Use:', Object.keys(SCENARIOS).map((k) => `--${k}`).join(' '));
    process.exit(1);
  }
  await runSteps(key, steps);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
