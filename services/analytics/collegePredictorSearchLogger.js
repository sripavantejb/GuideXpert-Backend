'use strict';

const CollegePredictorSearchEvent = require('../../models/CollegePredictorSearchEvent');

function toStrArray(value) {
  if (!Array.isArray(value)) {
    if (value == null || value === '') return [];
    return [String(value).trim()].filter(Boolean);
  }
  return value.map((x) => String(x).trim()).filter(Boolean);
}

function extractCollegeNames(data) {
  const colleges = data?.colleges || [];
  return colleges
    .map((c) => c.college_name || c.collegeName || c.name || c.institute_name)
    .filter(Boolean)
    .map((name) => String(name).trim())
    .slice(0, 25);
}

function resolveSource(req) {
  const path = String(req.originalUrl || req.url || '');
  if (path.includes('/counsellor/college-predictor')) return 'counsellor';
  if (path.includes('/college-predictor')) return 'public';
  return 'unknown';
}

function buildCategories(body = {}) {
  const codes = new Set([
    ...toStrArray(body.reservation_category_codes),
    ...toStrArray(body.reservation_category_code),
  ]);
  if (body.admission_category_name_enum) {
    codes.add(String(body.admission_category_name_enum).trim());
  }
  return [...codes].filter(Boolean);
}

/**
 * Record a predictor search for demand intelligence (first page only).
 */
async function recordPredictorSearch(req, body = {}, data = {}, offset = 0) {
  if (Number(offset) !== 0) return null;

  const exam =
    String(body.exam || body.entrance_exam_name_enum || '').trim() || 'UNKNOWN';

  const doc = {
    exam,
    source: resolveSource(req),
    branchCodes: toStrArray(body.branch_codes),
    districts: toStrArray(body.districts),
    categories: buildCategories(body),
    collegeNames: extractCollegeNames(data),
    resultCount: Number(data?.total_no_of_colleges) || (data?.colleges || []).length || 0,
    searchedAt: new Date(),
  };

  return CollegePredictorSearchEvent.create(doc);
}

module.exports = {
  recordPredictorSearch,
  extractCollegeNames,
  buildCategories,
  toStrArray,
};
