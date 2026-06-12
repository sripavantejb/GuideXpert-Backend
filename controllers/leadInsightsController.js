'use strict';

const leadInsightsService = require('../services/chatbot/leadInsights/leadInsightsService');

async function getLeadDetailsByPhone(req, res) {
  try {
    const result = await leadInsightsService.getLeadDetails(req.params.phone);
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: result.profile,
        score: result.score,
        recentEvents: result.recentEvents,
      },
    });
  } catch (error) {
    console.error('[leadInsights.getLeadDetailsByPhone] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

async function listLeadInsights(req, res) {
  try {
    const stageResult = leadInsightsService.parseStage(req.query.stage);
    if (stageResult.error) {
      return res.status(400).json({ success: false, message: stageResult.error });
    }

    const minScoreResult = leadInsightsService.parseMinScore(req.query.minScore);
    if (minScoreResult.error) {
      return res.status(400).json({ success: false, message: minScoreResult.error });
    }

    const result = await leadInsightsService.listLeads({
      stage: stageResult.stage,
      minScore: minScoreResult.minScore,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[leadInsights.listLeadInsights] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

async function getLeadInsightsStats(req, res) {
  try {
    const stats = await leadInsightsService.getLeadStats();
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('[leadInsights.getLeadInsightsStats] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

async function getHotLeadInsights(req, res) {
  try {
    const items = await leadInsightsService.getHotLeads();
    return res.status(200).json({
      success: true,
      data: { items },
    });
  } catch (error) {
    console.error('[leadInsights.getHotLeadInsights] Error:', error);
    return res.status(500).json({ success: false, message: 'Something went wrong.' });
  }
}

module.exports = {
  getLeadDetailsByPhone,
  listLeadInsights,
  getLeadInsightsStats,
  getHotLeadInsights,
};
