const CallSession = require('../models/CallSession');

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
