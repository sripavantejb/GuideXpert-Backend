'use strict';

// Load definitions side-effects (registers all entity types)
require('./entityDefinitions');

const { normalizeEntity, normalizeEntityValue } = require('./entityNormalizer');

module.exports = {
  normalizeEntity,
  normalizeEntityValue,
  normalizeApTsCategory: (text) => normalizeEntityValue('ap_ts_category', text),
  normalizeGender: (text) => normalizeEntityValue('gender', text),
  normalizeWbjeeQuota: (text) => normalizeEntityValue('wbjee_quota', text),
  normalizeApRegion: (text) => normalizeEntityValue('ap_region', text),
  normalizeJeeCategory: (text) => normalizeEntityValue('jee_category', text),
  normalizeTneaCategory: (text) => normalizeEntityValue('tnea_category', text),
  normalizeKcetAdmission: (text) => normalizeEntityValue('kcet_admission', text),
  normalizeMhtCetAdmission: (text) => normalizeEntityValue('mhtcet_admission', text),
};
