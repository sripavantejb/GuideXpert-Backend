const { predictRank, listExams } = require('../services/rankPredictorService');

async function getRankPredictorExams(req, res) {
  return res.status(200).json({
    success: true,
    data: {
      exams: listExams(),
    },
  });
}

async function predictRankHandler(req, res) {
  try {
    const { examId, score, options } = req.body || {};
    const result = predictRank({ examId, score, options });
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const status = Number(error.status) || 500;
    return res.status(status).json({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Something went wrong while predicting rank.',
        details: error.details || null,
      },
    });
  }
}

module.exports = {
  getRankPredictorExams,
  predictRank: predictRankHandler,
};
