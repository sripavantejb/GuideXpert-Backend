'use strict';

const {
  getPredictionForPhone,
  getPortfolioPredictions,
  recomputePredictions,
} = require('../services/analytics/predictionService');

exports.getPredictionByPhone = async (req, res) => {
  try {
    const force = req.query?.force === 'true' || req.query?.refresh === 'true';
    const result = await getPredictionForPhone(req.params.phone, { force });
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.status(200).json({
      success: true,
      data: {
        prediction: result.prediction,
        servedFromCache: result.servedFromCache,
      },
    });
  } catch (error) {
    console.error('[getPredictionByPhone]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.getPredictionPortfolio = async (req, res) => {
  try {
    const data = await getPortfolioPredictions(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getPredictionPortfolio]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};

exports.postRecomputePredictions = async (req, res) => {
  try {
    const phones = Array.isArray(req.body?.phones)
      ? req.body.phones
      : req.body?.phone
        ? [req.body.phone]
        : [];
    const all = req.body?.all === true || req.query?.all === 'true';
    const limit = req.body?.limit ?? req.query?.limit;

    const result = await recomputePredictions({ phones, all, limit });
    if (result.error) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[postRecomputePredictions]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
