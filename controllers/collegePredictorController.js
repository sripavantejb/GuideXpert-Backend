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
  const entranceExamRaw = body.entrance_exam_name_enum;
  const entranceExamTrimmed = (entranceExamRaw != null && String(entranceExamRaw).trim() !== '') ? String(entranceExamRaw).trim() : '';
  if (!entranceExamTrimmed) {
    return res.status(400).json({
      response: 'entrance_exam_name_enum is required; please select an entrance exam',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }

  const rawFrom = body.cutoff_from;
  const rawTo = body.cutoff_to;
  const cutoffFrom = rawFrom != null && rawFrom !== '' ? parseInt(Number(rawFrom), 10) : NaN;
  const cutoffTo = rawTo != null && rawTo !== '' ? parseInt(Number(rawTo), 10) : NaN;

  const hasFrom = rawFrom !== undefined && rawFrom !== null && rawFrom !== '';
  const hasTo = rawTo !== undefined && rawTo !== null && rawTo !== '';

  if (!hasFrom) {
    return res.status(400).json({
      response: 'cutoff_from is required',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  if (!hasTo) {
    return res.status(400).json({
      response: 'cutoff_to is required',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  if (!Number.isInteger(cutoffFrom) || cutoffFrom < 0) {
    return res.status(400).json({
      response: 'cutoff_from must be a non-negative integer',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  if (!Number.isInteger(cutoffTo) || cutoffTo < 0) {
    return res.status(400).json({
      response: 'cutoff_to must be a non-negative integer',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }
  if (cutoffFrom >= cutoffTo) {
    return res.status(400).json({
      response: 'cutoff_to must be greater than cutoff_from',
      res_status: 'INVALID_CUTOFF_RANGE',
      http_status_code: 400,
    });
  }

  const sortOrder = (body.sort_order != null && body.sort_order !== '') ? String(body.sort_order).toUpperCase() : 'ASC';
  if (sortOrder !== 'ASC' && sortOrder !== 'DESC') {
    return res.status(400).json({
      response: 'sort_order must be ASC or DESC',
      res_status: 'INVALID_INPUT_FORMAT',
      http_status_code: 400,
    });
  }

  const normalizedBody = {
    ...body,
    cutoff_from: cutoffFrom,
    cutoff_to: cutoffTo,
    entrance_exam_name_enum: entranceExamTrimmed,
    admission_category_name_enum: body.admission_category_name_enum != null && body.admission_category_name_enum !== '' ? String(body.admission_category_name_enum).trim() : 'GENERAL',
    reservation_category_code: body.reservation_category_code != null && body.reservation_category_code !== '' ? String(body.reservation_category_code).trim() : 'GNT2S',
    sort_order: sortOrder,
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[college-predictor] entrance_exam_name_enum:', JSON.stringify(normalizedBody.entrance_exam_name_enum));
  }

  try {
    const data = await getPredictedColleges(offset, limit, normalizedBody);
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
