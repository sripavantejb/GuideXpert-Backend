'use strict';

const {
  listCollegeComparisonSearchesForAdmin,
} = require('../services/collegeComparisonService');

/**
 * GET /api/admin/college-comparisons
 * Lists saved college comparison searches with user identity + result snapshot.
 */
async function getCollegeComparisons(req, res) {
  try {
    const page = req.query.page != null ? parseInt(req.query.page, 10) : 1;
    const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : 50;
    const phone = String(req.query.phone || '').trim();
    const q = String(req.query.q || '').trim();

    const data = await listCollegeComparisonSearchesForAdmin({ page, limit, phone, q });
    return res.status(200).json(data);
  } catch (error) {
    console.error('[getCollegeComparisons]', error);
    return res.status(500).json({
      response: error.message || 'Could not load college comparisons',
      res_status: 'COLLEGE_COMPARISONS_ADMIN_FAILED',
      http_status_code: 500,
    });
  }
}

module.exports = { getCollegeComparisons };
