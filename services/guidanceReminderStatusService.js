/**
 * Slot-grouped guidance WhatsApp status for admin (30-min reminder + counsellor booking notify).
 */
const GuidanceSlot = require('../models/GuidanceSlot');
const OneOnOneCounselingLead = require('../models/OneOnOneCounselingLead');
const OneOnOneCounselor = require('../models/OneOnOneCounselor');
const WhatsAppReminderJob = require('../models/WhatsAppReminderJob');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { GUIDANCE_REMINDER_MESSAGE_KINDS } = require('../models/WhatsAppReminderJob');
const { overdueSlaMs } = require('../utils/waReminderJobObservability');
const { getCronScheduleHealth } = require('../utils/waCronScheduleHealth');
const { CRON_JOB_KEYS } = require('../models/MessagingCronRun');

const MESSAGE_KIND = GUIDANCE_REMINDER_MESSAGE_KINDS[0];
const COUNSELLOR_NOTIFY_MESSAGE_KIND = 'guidance_counsellor_booking_notify';
const SUPPORTED_STATUS_MESSAGE_KINDS = new Set([MESSAGE_KIND, COUNSELLOR_NOTIFY_MESSAGE_KIND]);

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
  if (state === 'dispatched' || state === 'reconcile_pending') return 'sent';

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
 * @param {object|null|undefined} event
 * @returns {string}
 */
function mapEventToReminderState(event) {
  if (!event) return 'none';

  const status = event.status;
  if (status === 'delivered') return 'delivered';
  if (status === 'read') return 'read';
  if (status === 'failed' || status === 'retry_exhausted') return 'failed';
  if (status === 'retry_pending') return 'pending';
  if (['sent', 'submitted', 'queued', 'awaiting_final_dlr'].includes(status)) return 'sent';

  return status;
}

/**
 * @param {object[]} events
 * @returns {Record<string, object>}
 */
function indexLatestEventByLeadId(events) {
  const map = {};
  for (const event of events) {
    const key = String(event.oneOnOneCounselingLeadId || '');
    if (!key) continue;
    const existing = map[key];
    if (!existing) {
      map[key] = event;
      continue;
    }
    const attemptDelta = (event.attemptNumber || 0) - (existing.attemptNumber || 0);
    if (attemptDelta > 0) {
      map[key] = event;
      continue;
    }
    if (attemptDelta === 0) {
      const eventAt = event.createdAt ? new Date(event.createdAt).getTime() : 0;
      const existingAt = existing.createdAt ? new Date(existing.createdAt).getTime() : 0;
      if (eventAt >= existingAt) map[key] = event;
    }
  }
  return map;
}

/**
 * @param {object} counts
 * @param {object|null|undefined} event
 */
function incrementEventCounts(counts, event) {
  if (!event) return;

  counts.scheduled += 1;
  const reminderState = mapEventToReminderState(event);

  if (reminderState === 'pending') counts.pending += 1;
  else if (reminderState === 'delivered') counts.delivered += 1;
  else if (reminderState === 'read') counts.read += 1;
  else if (reminderState === 'failed') counts.failed += 1;
  else if (reminderState === 'sent') {
    /* dispatched — counted via slot rollup */
  }
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
  else if (reminderState === 'sent') {
    /* dispatched / reconcile_pending — counted via slot rollup, not pending */
  }
}

function resolveStatusMessageKind(messageKind) {
  if (messageKind === COUNSELLOR_NOTIFY_MESSAGE_KIND) return COUNSELLOR_NOTIFY_MESSAGE_KIND;
  return MESSAGE_KIND;
}

/**
 * @param {string} slotDate YYYY-MM-DD
 * @param {{ now?: Date, messageKind?: string }} [opts]
 */
async function getGuidanceReminderStatusBySlotDate(slotDate, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const messageKind = resolveStatusMessageKind(opts.messageKind);
  const isCounsellorNotify = messageKind === COUNSELLOR_NOTIFY_MESSAGE_KIND;

  const slots = await GuidanceSlot.find({ slotDate, isActive: true })
    .sort({ slotTime: 1 })
    .lean();

  if (!slots.length) {
    return { slotDate, messageKind, slots: [], cronHealth: null };
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
  const [counselors, deliveryRows] = await Promise.all([
    OneOnOneCounselor.find({ _id: { $in: counselorIds } })
      .select('name')
      .lean(),
    leadIds.length
      ? isCounsellorNotify
        ? WhatsAppMessageEvent.find({
            messageKind: COUNSELLOR_NOTIFY_MESSAGE_KIND,
            oneOnOneCounselingLeadId: { $in: leadIds },
            promotionSupersededAt: null,
          })
            .select(
              'oneOnOneCounselingLeadId status attemptNumber createdAt errorMessage sendErrorCode webhookErrorReason'
            )
            .lean()
        : WhatsAppReminderJob.find({
            messageKind: MESSAGE_KIND,
            oneOnOneCounselingLeadId: { $in: leadIds },
          })
            .select(
              'oneOnOneCounselingLeadId state scheduledSendAt suppressionReason lastError completedAt'
            )
            .lean()
      : [],
  ]);

  const counselorById = Object.fromEntries(counselors.map((c) => [String(c._id), c]));
  const deliveryByLeadId = isCounsellorNotify
    ? indexLatestEventByLeadId(deliveryRows)
    : Object.fromEntries(deliveryRows.map((j) => [String(j.oneOnOneCounselingLeadId), j]));

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
      const delivery = deliveryByLeadId[String(lead._id)] || null;
      if (isCounsellorNotify) {
        incrementEventCounts(reminders, delivery);
        const reminderState = mapEventToReminderState(delivery);
        const lastError =
          delivery?.errorMessage ||
          delivery?.webhookErrorReason ||
          (delivery?.sendErrorCode ? `send_error_${delivery.sendErrorCode}` : null);
        return {
          name: lead.studentName || '—',
          mobile: lead.mobileNumber || '',
          reminderState,
          jobState: delivery?.status || null,
          suppressionReason: delivery ? null : 'no_notify_event',
          scheduledSendAt: delivery?.createdAt || null,
          lastError,
        };
      }

      incrementReminderCounts(reminders, delivery, now);
      const reminderState = mapJobToReminderState(delivery, now);
      return {
        name: lead.studentName || '—',
        mobile: lead.mobileNumber || '',
        reminderState,
        jobState: delivery?.state || null,
        suppressionReason: delivery?.suppressionReason || (delivery ? null : 'no_reminder_job'),
        scheduledSendAt: delivery?.scheduledSendAt || null,
        lastError: delivery?.lastError || null,
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

  let cronHealth = null;
  if (!isCounsellorNotify) {
    const cronHealthAll = await getCronScheduleHealth();
    const guidanceCron =
      cronHealthAll.jobs.find((j) => j.jobKey === CRON_JOB_KEYS.SEND_GUIDANCE_REMINDERS) || null;
    cronHealth = guidanceCron
      ? {
          jobKey: guidanceCron.jobKey,
          label: guidanceCron.label,
          lastSuccessAt: guidanceCron.lastSuccessAt,
          stale: guidanceCron.stale,
          ageMs: guidanceCron.ageMs,
        }
      : null;
  }

  return {
    slotDate,
    messageKind,
    slots: resultSlots,
    cronHealth,
  };
}

module.exports = {
  getGuidanceReminderStatusBySlotDate,
  mapJobToReminderState,
  mapEventToReminderState,
  emptyReminderCounts,
  incrementReminderCounts,
  incrementEventCounts,
  indexLatestEventByLeadId,
  MESSAGE_KIND,
  COUNSELLOR_NOTIFY_MESSAGE_KIND,
  SUPPORTED_STATUS_MESSAGE_KINDS,
};
