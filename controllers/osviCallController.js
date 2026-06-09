const CallSession = require('../models/CallSession');
const { ingestIitAiCallWebhook } = require('../services/iitAiCallRecordService');

exports.saveIitAiCallAnalysis = async (req, res) => {
  try {
    const result = await ingestIitAiCallWebhook(req.body || {});
    if (!result.ok) {
      const status = result.error === 'call_log_id_required' || result.error === 'invalid_phone' ? 400 : 500;
      return res.status(status).json({
        success: false,
        message: result.error === 'call_log_id_required'
          ? 'call_log_id is required'
          : result.error === 'invalid_phone'
            ? 'phone is required'
            : 'Failed to store IIT AI call record',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'IIT AI call analysis stored successfully',
      data: result.record,
    });
  } catch (error) {
    console.error('[OSVI] saveIitAiCallAnalysis error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store IIT AI call analysis',
    });
  }
};

exports.saveCallSession = async (req, res) => {
  try {
    const {
      callId,
      phone,
      agentName,
      callType,
      duration,
      status,
      recordingUrl,
      summary,
      transcript,
      tag,
      sessionRating,
      candidateQuestions,
      availabilityForTraining,
      endReason,
      endedBy,
      callTime,
    } = req.body || {};

    if (!callId || !String(callId).trim()) {
      return res.status(400).json({ success: false, message: 'callId is required' });
    }

    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }

    const callSession = new CallSession({
      callId,
      phone,
      agentName,
      callType,
      duration,
      status,
      recordingUrl,
      summary,
      transcript,
      tag,
      sessionRating,
      candidateQuestions,
      availabilityForTraining,
      endReason,
      endedBy,
      callTime,
    });

    const savedCall = await callSession.save();

    ingestIitAiCallWebhook(req.body || {}).catch((ingestErr) => {
      console.warn('[OSVI] IIT AI call ingest failed:', ingestErr?.message || ingestErr);
    });

    try {
      const { syncReminderFromWebhook } = require('../services/aiCallReminderService');
      const additionalData = req.body?.additional_data || req.body?.additionalData || {};
      const source = additionalData?.source || '';
      if (source === 'iitian_career_counselling' || callType === 'callback') {
        syncReminderFromWebhook({ phone, status, callId }).catch((syncErr) => {
          console.warn('[OSVI] AI reminder webhook sync failed:', syncErr?.message || syncErr);
        });
      }
    } catch (syncHookErr) {
      console.warn('[OSVI] AI reminder webhook hook error:', syncHookErr?.message || syncHookErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Call session stored successfully',
      data: savedCall,
    });
  } catch (error) {
    console.error('[OSVI] saveCallSession error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store call session',
    });
  }
};

exports.getCallSessions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      CallSession.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CallSession.countDocuments({}),
    ]);

    return res.json({
      success: true,
      message: 'Call sessions fetched successfully',
      rows,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('[OSVI] getCallSessions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch call sessions',
    });
  }
};
