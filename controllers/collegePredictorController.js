const { getPredictedColleges } = require('../services/nwCollegePredictorService');

/**
 * POST /college-predictor/colleges?offset=0&limit=10
 * Body: entrance_exam_name_enum, admission_category_name_enum, cutoff_from, cutoff_to, reservation_category_code, optional branch_codes, districts, sort_order
 */
async function getPredictedCollegesHandler(req, res) {
  const offset = req.query.offset != null ? parseInt(req.query.offset, 10) : NaN;
  const limit = req.query.limit != null ? parseInt(req.query.limit, 10) : NaN;

  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) {
    return res.status(400).json({
      response: 'offset and limit must be non-negative integers',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }

  const body = req.body || {};
  const cutoffFrom = Number(body.cutoff_from);
  const cutoffTo = Number(body.cutoff_to);
  if (typeof body.cutoff_from !== 'undefined' && (Number.isNaN(cutoffFrom) || cutoffFrom < 0)) {
    return res.status(400).json({
      response: 'cutoff_from must be a non-negative number',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  if (typeof body.cutoff_to !== 'undefined' && (Number.isNaN(cutoffTo) || cutoffTo < 0)) {
    return res.status(400).json({
      response: 'cutoff_to must be a non-negative number',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  if (!Number.isNaN(cutoffFrom) && !Number.isNaN(cutoffTo) && cutoffFrom > cutoffTo) {
    return res.status(400).json({
      response: 'Invalid cutoff range',
      res_status: 'INVALID_CUTOFF_RANGE',
      http_status_code: 400,
    });
  }

  try {
    const data = await getPredictedColleges(offset, limit, body);
    return res.status(200).json(data);
  } catch (err) {
    const status = err.http_status_code || 502;
    if (status === 400 && err.upstreamBody) {
      return res.status(400).json(err.upstreamBody);
    }
    if (status === 401 || status === 403) {
      return res.status(503).json({
        response: 'Predictor service unavailable',
        res_status: 'SERVICE_UNAVAILABLE',
        http_status_code: 503,
      });
    }
    return res.status(status).json({
      response: err.response || 'Predictor service unavailable',
      res_status: err.res_status || 'SERVICE_UNAVAILABLE',
      http_status_code: status,
    });
  }
}

module.exports = {
  getPredictedColleges: getPredictedCollegesHandler,
};
