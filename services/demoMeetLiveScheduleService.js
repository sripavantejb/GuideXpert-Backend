const DemoMeetLiveSchedule = require('../models/DemoMeetLiveSchedule');

/** Default IST live windows: Sun 11–13; Mon–Sat 19:00–20:00 (admin can widen). */
function defaultRecurringWindows() {
  const windows = [];
  for (let dow = 1; dow <= 6; dow += 1) {
    windows.push({ dayOfWeek: dow, startHHmm: '19:00', endHHmm: '20:00' });
  }
  windows.push({ dayOfWeek: 0, startHHmm: '11:00', endHHmm: '13:00' });
  return windows;
}

/**
 * @returns {Promise<import('mongoose').Document>}
 */
async function getOrCreateDemoMeetLiveSchedule() {
  let doc = await DemoMeetLiveSchedule.findOne({ singletonKey: 'demoMeetLive' });
  if (!doc) {
    doc = await DemoMeetLiveSchedule.create({
      singletonKey: 'demoMeetLive',
      recurringWindows: defaultRecurringWindows(),
      joinEarlyMinutes: 5,
    });
  }
  return doc;
}

function toPlainSchedule(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    recurringWindows: Array.isArray(o.recurringWindows) ? o.recurringWindows.map((w) => ({ ...w })) : [],
    joinEarlyMinutes: typeof o.joinEarlyMinutes === 'number' ? o.joinEarlyMinutes : 5,
    updatedAt: o.updatedAt || null,
  };
}

module.exports = {
  getOrCreateDemoMeetLiveSchedule,
  defaultRecurringWindows,
  toPlainSchedule,
};
