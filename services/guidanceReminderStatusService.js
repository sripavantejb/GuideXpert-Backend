/**
 * Slot-grouped guidance 30-minute WhatsApp reminder status for admin.
 */
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const { GUIDANCE_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const { overdueSlaMs } = require('../utils/waReminderJobObservability');

const MESSAGE_KIND = GUIDANCE_REMINDER_MESSAGE_KINDS[0];

function emptyReminderCounts() {
  return {
    scheduled: 0,
    pending: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    skipped: 0,
    overdue: 0,
  };
}

/**
 * @param {object|null|undefined} job
 * @param {Date} now
 * @returns {string}
 */
function mapJobToReminderState(job, now) {
  if (!job) return 'none';

  const state = job.state;
  if (state === 'delivered') return 'delivered';
  if (state === 'read') return 'read';
  if (state === 'failed' || state === 'exhausted') return 'failed';
  if (state === 'skipped' || state === 'cancelled') return 'skipped';
  if (state === 'dispatched') return 'sent';

  const overdueBefore = new Date(now.getTime() - overdueSlaMs());
  const due =
    job.scheduledSendAt &&
    new Date(job.scheduledSendAt).getTime() <= overdueBefore.getTime();

  if (['pending', 'claimed', 'dispatching', 'reconcile_pending'].includes(state)) {
    return due ? 'overdue' : 'pending';
  }

  return state;
}

/**
 * @param {object} counts
 * @param {object|null|undefined} job
 * @param {Date} now
 */
function incrementReminderCounts(counts, job, now) {
  if (!job) return;

  counts.scheduled += 1;
  const reminderState = mapJobToReminderState(job, now);

  if (reminderState === 'pending') counts.pending += 1;
  else if (reminderState === 'overdue') counts.overdue += 1;
  else if (reminderState === 'delivered') counts.delivered += 1;
  else if (reminderState === 'read') counts.read += 1;
  else if (reminderState === 'failed') counts.failed += 1;
  else if (reminderState === 'skipped') counts.skipped += 1;
  else if (reminderState === 'sent') counts.pending += 1;
}

/**
 * @param {string} slotDate YYYY-MM-DD
 * @param {{ now?: Date }} [opts]
 */
async function getGuidanceReminderStatusBySlotDate(slotDate, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();

  const slots = await GuidanceSlot.find({ slotDate, isActive: true })
    .sort({ slotTime: 1 })
    .lean();

  if (!slots.length) {
    return { slotDate, slots: [] };
  }

  const slotIds = slots.map((s) => s._id);
  const counselorIds = [...new Set(slots.map((s) => String(s.oneOnOneCounselorId)))];

  const leads = await OneOnOneCounselingLead.find({
    bookingConfirmed: true,
    selectedSlotId: { $in: slotIds },
  })
    .select('studentName mobileNumber selectedSlotId')
    .lean();

  const leadIds = leads.map((l) => l._id);
  const [counselors, jobs] = await Promise.all([
    OneOnOneCounselor.find({ _id: { $in: counselorIds } })
      .select('name')
      .lean(),
    leadIds.length
      ? WhatsAppReminderJob.find({
          messageKind: MESSAGE_KIND,
          oneOnOneCounselingLeadId: { $in: leadIds },
        })
          .select('oneOnOneCounselingLeadId state scheduledSendAt suppressionReason')
          .lean()
      : [],
  ]);

  const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));
  const jobByLeadId = Object.fromEntries(
    jobs.map((j) => [String(j.oneOnOneCounselingLeadId), j])
  );

  const leadsBySlotId = {};
  for (const lead of leads) {
    const key = String(lead.selectedSlotId);
    if (!leadsBySlotId[key]) leadsBySlotId[key] = [];
    leadsBySlotId[key].push(lead);
  }

  const resultSlots = slots.map((slot) => {
    const slotKey = String(slot._id);
    const slotLeads = leadsBySlotId[slotKey] || [];
    const counselor = counselorById[String(slot.oneOnOneCounselorId)];
    const reminders = emptyReminderCounts();

    const students = slotLeads.map((lead) => {
      const job = jobByLeadId[String(lead._id)] || null;
      incrementReminderCounts(reminders, job, now);
      return {
        name: lead.studentName || '—',
        mobile: lead.mobileNumber || '',
        reminderState: mapJobToReminderState(job, now),
        suppressionReason: job?.suppressionReason || null,
      };
    });

    return {
      id: slotKey,
      sessionTitle: slot.sessionTitle,
      slotDate: slot.slotDate,
      slotTime: slot.slotTime,
      counselorName: counselor?.name || '',
      bookings: {
        confirmed: slotLeads.length,
        max: slot.maxBookings,
      },
      reminders,
      students,
    };
  });

  return { slotDate, slots: resultSlots };
}

module.exports = {
  getGuidanceReminderStatusBySlotDate,
  mapJobToReminderState,
  emptyReminderCounts,
  incrementReminderCounts,
  MESSAGE_KIND,
};
