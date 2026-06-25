'use strict';

const { getDemandSummary } = require('../services/analytics/demandIntelligenceService');

exports.getDemandSummary = async (req, res) => {
  try {
    const data = await getDemandSummary(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[getDemandSummary]', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
};
