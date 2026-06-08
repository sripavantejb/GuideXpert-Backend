const mongoose = require('mongoose');
const AiCallReminder = require('../models/AiCallReminder');
const AiTestCall = require('../models/AiTestCall');
const AiCallReminderActivity = require('../models/AiCallReminderActivity');
const { mapSubmissionToReminderFields } = require('../utils/aiCallReminderFieldMapper');
const {
  computeCallbackTimeFromSlot,
  isCallbackTimeInPast,
} = require('../utils/aiCallReminderTiming');
const {
  buildOsviPayloadFromReminder,
  buildOsviPayloadFromTestCall,
  getAgentUuid,
} = require('../utils/aiCallReminderPayload');
const { scheduleOsviCallback } = require('../utils/osviService');
const { getAiCallsSchedulingMode } = require('../utils/appSettings');

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function actorFromAdmin(admin) {
  if (!admin) return { actorType: 'system', actorId: null, actorName: 'System' };
  return {
    actorType: 'admin',
    actorId: admin._id || admin.id || null,
    actorName: admin.username || admin.name || 'Admin',
  };
}

async function logActivity({
  reminderId = null,
  testCallId = null,
  action,
  oldValue = null,
  newValue = null,
  metadata = null,
  admin = null,
}) {
  const actor = actorFromAdmin(admin);
  await AiCallReminderActivity.create({
    reminderId,
    testCallId,
    ...actor,
    action,
    oldValue,
    newValue,
    metadata,
  });
}

function extractOsviCallbackId(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [data.callback_id, data.callbackId, data.id, data.call_id, data.callId];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/**
 * @param {object} submission lean IitCounsellingSubmission
 */
async function createPendingReminder(submission) {
  const subId = submission?._id;
  if (!subId) return { ok: false, error: 'missing_submission_id' };

  const slotInstant = submission.counsellingSlotInstantUtc;
  if (!slotInstant) return { ok: false, error: 'missing_slot_instant' };

  const callbackTime = computeCallbackTimeFromSlot(slotInstant);
  if (!callbackTime) return { ok: false, error: 'invalid_callback_time' };

  const mapped = mapSubmissionToReminderFields(submission);
  const phone = normalizePhone(mapped.phone);
  if (!/^\d{10}$/.test(phone)) return { ok: false, error: 'invalid_phone' };

  const existing = await AiCallReminder.findOne({ iitCounsellingSubmissionId: subId }).lean();
  const setDoc = {
    ...mapped,
    phone,
    callbackTime,
    iitCounsellingSubmissionId: subId,
  };

  let reminder;
  if (existing) {
    reminder = await AiCallReminder.findOneAndUpdate(
      { _id: existing._id },
      { $set: setDoc },
      { new: true, runValidators: true }
    ).lean();
    await logActivity({
      reminderId: reminder._id,
      action: 'reminder_updated',
      metadata: { source: 'section1_upsert' },
    });
  } else {
    reminder = await AiCallReminder.create({
      ...setDoc,
      status: 'pending_approval',
    });
    reminder = reminder.toObject();
    await logActivity({
      reminderId: reminder._id,
      action: 'reminder_created',
      newValue: 'pending_approval',
    });
  }

  const mode = await getAiCallsSchedulingMode();
  if (mode === 'automatic') {
    const scheduleResult = await scheduleReminderToOsvi(reminder._id, null);
    return { ok: true, reminder: scheduleResult.reminder || reminder, autoScheduled: true, scheduleResult };
  }

  return { ok: true, reminder, autoScheduled: false };
}

/**
 * @param {object} submission lean IitCounsellingSubmission
 */
async function enrichReminderFromSubmission(submission) {
  const subId = submission?._id;
  if (!subId) return { ok: false, error: 'missing_submission_id' };

  const reminder = await AiCallReminder.findOne({ iitCounsellingSubmissionId: subId });
  if (!reminder) return { ok: false, error: 'reminder_not_found' };

  const mapped = mapSubmissionToReminderFields(submission);
  const updates = {
    studentName: mapped.studentName,
    class: mapped.class,
    city: mapped.city,
    biggestConcern: mapped.biggestConcern,
    careerGoal: mapped.careerGoal,
    selectedSlot: mapped.selectedSlot,
    selectedSlotInstantUtc: mapped.selectedSlotInstantUtc,
    slotDayIst: mapped.slotDayIst,
  };

  if (mapped.selectedSlotInstantUtc) {
    updates.callbackTime = computeCallbackTimeFromSlot(mapped.selectedSlotInstantUtc);
  }

  Object.assign(reminder, updates);
  await reminder.save();

  await logActivity({
    reminderId: reminder._id,
    action: 'reminder_updated',
    metadata: { source: 'enrich_from_submission' },
  });

  return { ok: true, reminder: reminder.toObject() };
}

async function getPayloadPreview(reminderId) {
  const reminder = await AiCallReminder.findById(reminderId).lean();
  if (!reminder) return { ok: false, error: 'not_found' };
  return { ok: true, payload: buildOsviPayloadFromReminder(reminder) };
}

async function scheduleReminderToOsvi(reminderId, admin) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };

  if (!['pending_approval', 'failed'].includes(reminder.status)) {
    return { ok: false, error: 'invalid_status', status: reminder.status };
  }

  if (isCallbackTimeInPast(reminder.callbackTime)) {
    return { ok: false, error: 'callback_time_in_past' };
  }

  if (!getAgentUuid()) {
    return { ok: false, error: 'osvi_agent_not_configured' };
  }

  const payload = buildOsviPayloadFromReminder(reminder);
  if (!payload.phone) {
    return { ok: false, error: 'invalid_phone' };
  }

  const osviResult = await scheduleOsviCallback(payload);

  reminder.osviRequest = payload;
  reminder.osviResponse = osviResult.data || null;

  if (osviResult.success) {
    reminder.status = 'scheduled';
    reminder.scheduledAt = new Date();
    reminder.scheduledBy = admin?._id || admin?.id || null;
    reminder.lastError = null;
    reminder.osviCallbackId = extractOsviCallbackId(osviResult.data);
    await reminder.save();

    await logActivity({
      reminderId: reminder._id,
      action: 'reminder_scheduled',
      oldValue: 'pending_approval',
      newValue: 'scheduled',
      admin,
    });

    return { ok: true, reminder: reminder.toObject() };
  }

  reminder.status = 'failed';
  reminder.lastError = osviResult.error || 'OSVI callback failed';
  await reminder.save();

  await logActivity({
    reminderId: reminder._id,
    action: 'reminder_failed',
    newValue: reminder.lastError,
    admin,
  });

  return { ok: false, error: reminder.lastError, reminder: reminder.toObject() };
}

async function bulkScheduleReminders(ids, admin) {
  const results = [];
  for (const id of ids) {
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      results.push({ id, ok: false, error: 'invalid_id' });
      continue;
    }
    const result = await scheduleReminderToOsvi(id, admin);
    results.push({ id, ...result });
  }
  const scheduled = results.filter((r) => r.ok).length;
  const failed = results.length - scheduled;
  return { scheduled, failed, results };
}

async function scheduleAllPending(admin) {
  const pending = await AiCallReminder.find({ status: 'pending_approval' })
    .select('_id')
    .lean();
  const ids = pending.map((r) => r._id);
  return bulkScheduleReminders(ids, admin);
}

async function rejectReminder(reminderId, admin, reason = null) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };
  if (reminder.status !== 'pending_approval') {
    return { ok: false, error: 'invalid_status', status: reminder.status };
  }

  const oldStatus = reminder.status;
  reminder.status = 'cancelled';
  reminder.rejectedAt = new Date();
  reminder.rejectedBy = admin?._id || admin?.id || null;
  reminder.rejectionReason = reason || null;
  await reminder.save();

  await logActivity({
    reminderId: reminder._id,
    action: 'reminder_rejected',
    oldValue: oldStatus,
    newValue: 'cancelled',
    metadata: reason ? { reason } : null,
    admin,
  });

  return { ok: true, reminder: reminder.toObject() };
}

const EDITABLE_FIELDS = ['studentName', 'phone', 'class', 'city', 'biggestConcern', 'callbackTime'];

async function updateReminderFields(reminderId, fields, admin) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };
  if (!['pending_approval', 'failed', 'scheduled'].includes(reminder.status)) {
    return { ok: false, error: 'invalid_status' };
  }

  const changes = {};
  for (const key of EDITABLE_FIELDS) {
    if (fields[key] === undefined) continue;
    if (key === 'phone') {
      const p = normalizePhone(fields[key]);
      if (!/^\d{10}$/.test(p)) return { ok: false, error: 'invalid_phone' };
      changes[key] = p;
    } else if (key === 'callbackTime') {
      const d = new Date(fields[key]);
      if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid_callback_time' };
      changes[key] = d;
    } else {
      changes[key] = typeof fields[key] === 'string' ? fields[key].trim() : fields[key];
    }
  }

  if (Object.keys(changes).length === 0) {
    return { ok: true, reminder: reminder.toObject() };
  }

  Object.assign(reminder, changes);
  await reminder.save();

  await logActivity({
    reminderId: reminder._id,
    action: 'reminder_updated',
    metadata: { fields: Object.keys(changes) },
    admin,
  });

  return { ok: true, reminder: reminder.toObject() };
}

async function retryReminder(reminderId, admin) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };
  if (reminder.status !== 'failed') {
    return { ok: false, error: 'invalid_status', status: reminder.status };
  }

  reminder.retryCount = (reminder.retryCount || 0) + 1;
  await reminder.save();

  const result = await scheduleReminderToOsvi(reminderId, admin);
  if (result.ok) {
    await logActivity({
      reminderId: reminder._id,
      action: 'reminder_retried',
      newValue: 'scheduled',
      admin,
    });
  }
  return result;
}

async function rescheduleReminder(reminderId, newCallbackTime, admin) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };

  const d = new Date(newCallbackTime);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'invalid_callback_time' };

  const oldTime = reminder.callbackTime?.toISOString() || null;
  reminder.callbackTime = d;
  await reminder.save();

  await logActivity({
    reminderId: reminder._id,
    action: 'reminder_rescheduled',
    oldValue: oldTime,
    newValue: d.toISOString(),
    admin,
  });

  if (['scheduled', 'failed'].includes(reminder.status)) {
    reminder.status = 'pending_approval';
    await reminder.save();
    return scheduleReminderToOsvi(reminderId, admin);
  }

  return { ok: true, reminder: reminder.toObject() };
}

async function cancelReminder(reminderId, admin) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };
  if (['completed', 'cancelled'].includes(reminder.status)) {
    return { ok: false, error: 'invalid_status', status: reminder.status };
  }

  const oldStatus = reminder.status;
  reminder.status = 'cancelled';
  await reminder.save();

  await logActivity({
    reminderId: reminder._id,
    action: 'reminder_cancelled',
    oldValue: oldStatus,
    newValue: 'cancelled',
    admin,
  });

  return { ok: true, reminder: reminder.toObject() };
}

async function deleteReminder(reminderId, admin) {
  const reminder = await AiCallReminder.findById(reminderId);
  if (!reminder) return { ok: false, error: 'not_found' };
  if (!['pending_approval', 'cancelled'].includes(reminder.status)) {
    return { ok: false, error: 'invalid_status', status: reminder.status };
  }

  await AiCallReminder.deleteOne({ _id: reminderId });
  return { ok: true };
}

function previewTestCallPayload(input) {
  const phone = normalizePhone(input.phone);
  const callbackTime = new Date(input.callbackTime);
  if (!input.personName || !/^\d{10}$/.test(phone) || Number.isNaN(callbackTime.getTime())) {
    return { ok: false, error: 'invalid_input' };
  }
  return {
    ok: true,
    payload: buildOsviPayloadFromTestCall({
      personName: input.personName,
      phone,
      callbackTime,
      notes: input.notes || null,
    }),
  };
}

async function createTestCall(input, admin) {
  const phone = normalizePhone(input.phone);
  const callbackTime = new Date(input.callbackTime);
  if (!input.personName || !/^\d{10}$/.test(phone) || Number.isNaN(callbackTime.getTime())) {
    return { ok: false, error: 'invalid_input' };
  }

  const payload = buildOsviPayloadFromTestCall({
    personName: input.personName.trim(),
    phone,
    callbackTime,
    notes: input.notes || null,
  });

  const testCall = await AiTestCall.create({
    personName: input.personName.trim(),
    phone,
    callbackTime,
    notes: input.notes || null,
    status: 'pending',
    createdBy: admin?._id || admin?.id || null,
  });

  const osviResult = await scheduleOsviCallback(payload);
  testCall.osviRequest = payload;
  testCall.osviResponse = osviResult.data || null;

  if (osviResult.success) {
    testCall.status = 'scheduled';
    testCall.lastError = null;
  } else {
    testCall.status = 'failed';
    testCall.lastError = osviResult.error || 'OSVI callback failed';
  }
  await testCall.save();

  await logActivity({
    testCallId: testCall._id,
    action: 'test_call_triggered',
    newValue: testCall.status,
    admin,
  });

  return {
    ok: osviResult.success,
    testCall: testCall.toObject(),
    error: osviResult.success ? null : testCall.lastError,
  };
}

async function syncReminderFromWebhook({ phone, status, callId }) {
  const phone10 = normalizePhone(phone);
  if (!/^\d{10}$/.test(phone10)) return { ok: false, error: 'invalid_phone' };

  const reminder = await AiCallReminder.findOne({
    phone: phone10,
    status: { $in: ['scheduled', 'processing'] },
  })
    .sort({ scheduledAt: -1 })
    .lean();

  if (!reminder) return { ok: false, error: 'reminder_not_found' };

  const normalizedStatus = String(status || '').toLowerCase();
  let newStatus = reminder.status;
  if (['completed', 'success', 'done'].includes(normalizedStatus)) {
    newStatus = 'completed';
  } else if (['failed', 'failure', 'error'].includes(normalizedStatus)) {
    newStatus = 'failed';
  } else if (['processing', 'in_progress', 'ringing', 'active'].includes(normalizedStatus)) {
    newStatus = 'processing';
  }

  if (newStatus === reminder.status) return { ok: true, unchanged: true };

  const update = { status: newStatus };
  if (callId) update.osviCallbackId = String(callId).trim();

  await AiCallReminder.updateOne({ _id: reminder._id }, { $set: update });

  await logActivity({
    reminderId: reminder._id,
    action: newStatus === 'failed' ? 'reminder_failed' : 'reminder_updated',
    oldValue: reminder.status,
    newValue: newStatus,
    metadata: { source: 'webhook' },
  });

  return { ok: true, reminderId: reminder._id, status: newStatus };
}

module.exports = {
  createPendingReminder,
  enrichReminderFromSubmission,
  getPayloadPreview,
  scheduleReminderToOsvi,
  bulkScheduleReminders,
  scheduleAllPending,
  rejectReminder,
  updateReminderFields,
  retryReminder,
  rescheduleReminder,
  cancelReminder,
  deleteReminder,
  previewTestCallPayload,
  createTestCall,
  syncReminderFromWebhook,
  EDITABLE_FIELDS,
};
