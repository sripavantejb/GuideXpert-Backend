const DemoMeetLiveSchedule = require('../models/DemoMeetLiveSchedule');
const { parseHHmm } = require('../utils/demoMeetLiveWindows');
const { getOrCreateDemoMeetLiveSchedule, toPlainSchedule } = require('../services/demoMeetLiveScheduleService');

function validateRecurringWindows(windows) {
  if (!Array.isArray(windows)) {
    return { ok: false, message: 'recurringWindows must be an array.' };
  }
  if (windows.length === 0) {
    return { ok: false, message: 'Add at least one live window.' };
  }
  if (windows.length > 64) {
    return { ok: false, message: 'Too many windows (max 64).' };
  }
  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i];
    const dow = Number(w?.dayOfWeek);
    const startHHmm = typeof w?.startHHmm === 'string' ? w.startHHmm.trim() : '';
    const endHHmm = typeof w?.endHHmm === 'string' ? w.endHHmm.trim() : '';
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      return { ok: false, message: `Window ${i + 1}: dayOfWeek must be 0–6 (Sunday–Saturday).` };
    }
    const sh = parseHHmm(startHHmm);
    const eh = parseHHmm(endHHmm);
    if (!sh || !eh) {
      return { ok: false, message: `Window ${i + 1}: startHHmm and endHHmm must be HH:mm (24h).` };
    }
    const startMin = sh.h * 60 + sh.min;
    const endMin = eh.h * 60 + eh.min;
    if (endMin <= startMin) {
      return {
        ok: false,
        message: `Window ${i + 1}: end must be after start on the same day (overnight ranges are not supported).`,
      };
    }
  }
  return { ok: true };
}

exports.getDemoMeetSchedule = async (req, res) => {
  try {
    const doc = await getOrCreateDemoMeetLiveSchedule();
    const plain = toPlainSchedule(doc);
    return res.json({ success: true, schedule: plain });
  } catch (err) {
    console.error('[getDemoMeetSchedule]', err);
    return res.status(500).json({ success: false, message: 'Failed to load demo meet schedule.' });
  }
};

exports.putDemoMeetSchedule = async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const recurringWindows = body.recurringWindows;
    const joinEarlyMinutes = body.joinEarlyMinutes;

    const v = validateRecurringWindows(recurringWindows);
    if (!v.ok) {
      return res.status(400).json({ success: false, message: v.message, code: 'DEMO_MEET_SCHEDULE_INVALID' });
    }

    let early = Number(joinEarlyMinutes);
    if (!Number.isFinite(early) || joinEarlyMinutes == null) early = 5;
    early = Math.round(early);
    if (early < 0 || early > 120) {
      return res.status(400).json({
        success: false,
        message: 'joinEarlyMinutes must be between 0 and 120.',
        code: 'DEMO_MEET_SCHEDULE_INVALID',
      });
    }

    const sanitized = recurringWindows.map((w) => ({
      dayOfWeek: Number(w.dayOfWeek),
      startHHmm: String(w.startHHmm).trim(),
      endHHmm: String(w.endHHmm).trim(),
    }));

    const doc = await DemoMeetLiveSchedule.findOneAndUpdate(
      { singletonKey: 'demoMeetLive' },
      {
        $set: {
          recurringWindows: sanitized,
          joinEarlyMinutes: early,
        },
        $setOnInsert: { singletonKey: 'demoMeetLive' },
      },
      { new: true, upsert: true }
    );

    const plain = toPlainSchedule(doc);
    return res.json({ success: true, schedule: plain });
  } catch (err) {
    console.error('[putDemoMeetSchedule]', err);
    return res.status(500).json({ success: false, message: 'Failed to save demo meet schedule.' });
  }
};
