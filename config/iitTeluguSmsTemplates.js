/**
 * STPL-approved Telugu DLT templates for IIT counselling SMS (MSG91 Flow).
 * Override template IDs via MSG91_IIT_TELUGU_SMS_* env vars in production.
 *
 * Static templates (no Flow variables): T-1 day, T-2 hours, session 8 AM.
 * Link templates (##var## = meet URL): T-30 min, T-5 min, T+5 min.
 */
const { IIT_TELUGU_SMS_MESSAGE_KINDS } = require('../models/IitTeluguSmsReminderJob');

const DEFAULT_IIT_COUNSELLING_MEET_LINK = 'https://www.guidexpert.co.in/iitcounsellingmeet';

const DEFAULT_TEMPLATE_IDS = {
  iit_sms_tminus_1d: '1707177970525757388',
  iit_sms_tminus_2h: '1707177970552845186',
  iit_sms_session_8am: '1707177970535787192',
  iit_sms_tminus_30m: '1707177970579426973',
  iit_sms_tminus_5m: '1707177977442936157',
  iit_sms_tplus_5m: '1707177977449694822',
};

const ENV_KEY_BY_KIND = {
  iit_sms_tminus_1d: 'MSG91_IIT_TELUGU_SMS_TMINUS_1D_TEMPLATE_ID',
  iit_sms_tminus_2h: 'MSG91_IIT_TELUGU_SMS_TMINUS_2H_TEMPLATE_ID',
  iit_sms_session_8am: 'MSG91_IIT_TELUGU_SMS_SESSION_8AM_TEMPLATE_ID',
  iit_sms_tminus_30m: 'MSG91_IIT_TELUGU_SMS_TMINUS_30M_TEMPLATE_ID',
  iit_sms_tminus_5m: 'MSG91_IIT_TELUGU_SMS_TMINUS_5M_TEMPLATE_ID',
  iit_sms_tplus_5m: 'MSG91_IIT_TELUGU_SMS_TPLUS_5M_TEMPLATE_ID',
};

/** Templates that use MSG91 Flow ##var## for the IIT counselling meet link. */
const MEET_LINK_VARIABLE_KINDS = new Set([
  'iit_sms_tminus_30m',
  'iit_sms_tminus_5m',
  'iit_sms_tplus_5m',
]);

/** @type {Record<string, { static: boolean, variableKeys: string[] }>} */
const TEMPLATE_META = {
  iit_sms_tminus_1d: { static: true, variableKeys: [] },
  iit_sms_tminus_2h: { static: true, variableKeys: [] },
  iit_sms_session_8am: { static: true, variableKeys: [] },
  iit_sms_tminus_30m: { static: false, variableKeys: ['var'] },
  iit_sms_tminus_5m: { static: false, variableKeys: ['var'] },
  iit_sms_tplus_5m: { static: false, variableKeys: ['var'] },
};

function getIitCounsellingMeetLink() {
  const fromEnv = String(process.env.IIT_COUNSELLING_MEET_LINK || '').trim();
  return fromEnv || DEFAULT_IIT_COUNSELLING_MEET_LINK;
}

function isStaticTeluguSmsTemplate(messageKind) {
  return TEMPLATE_META[messageKind]?.static === true;
}

function resolveTemplateId(messageKind) {
  const envKey = ENV_KEY_BY_KIND[messageKind];
  const fromEnv = envKey ? String(process.env[envKey] || '').trim() : '';
  if (fromEnv) return fromEnv;
  return DEFAULT_TEMPLATE_IDS[messageKind] || null;
}

function variableKeysForKind(messageKind) {
  return TEMPLATE_META[messageKind]?.variableKeys || [];
}

/**
 * MSG91 Flow recipient variables for one Telugu SMS kind.
 * @returns {Record<string, string>}
 */
function buildFlowVariablesForKind(messageKind) {
  if (!MEET_LINK_VARIABLE_KINDS.has(messageKind)) {
    return {};
  }
  return { var: getIitCounsellingMeetLink() };
}

/** @deprecated use buildFlowVariablesForKind */
function pickVariablesForKind(messageKind, allVars) {
  const keys = variableKeysForKind(messageKind);
  const out = {};
  for (const k of keys) {
    if (allVars[k] != null) out[k] = allVars[k];
  }
  return out;
}

module.exports = {
  IIT_TELUGU_SMS_MESSAGE_KINDS,
  DEFAULT_IIT_COUNSELLING_MEET_LINK,
  DEFAULT_TEMPLATE_IDS,
  ENV_KEY_BY_KIND,
  TEMPLATE_META,
  MEET_LINK_VARIABLE_KINDS,
  getIitCounsellingMeetLink,
  isStaticTeluguSmsTemplate,
  resolveTemplateId,
  variableKeysForKind,
  buildFlowVariablesForKind,
  pickVariablesForKind,
};
