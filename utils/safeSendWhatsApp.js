/**
 * Non-blocking WhatsApp send with FormSubmission retry fields + WhatsAppMessageEvent audit row.
 */
const FormSubmission = require('../models/FormSubmission');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const { getTemplateMetaForKind } = require('./whatsappTemplateMeta');

function maskPhone(phone10) {
  const s = String(phone10 || '').replace(/\D/g, '');
  const last4 = s.slice(-4);
  return last4.length === 4 ? `****${last4}` : '****';
}

function extractMessageId(result) {
  const d = result && result.data;
  if (!d || typeof d !== 'object') return undefined;
  const id = d.messageId;
  return id != null && id !== '' ? String(id) : undefined;
}

/**
 * @param {object} opts
 * @param {string} opts.phone10
 * @param {string} [opts.formSubmissionId]
 * @param {object} opts.vars
 * @param {'slot_booked'|'pre4hr'|'meet'|'30min'} opts.retryKind
 * @param {'save_step3'|'cron'|'retry_cron'|'admin_manual'} opts.source
 * @param {import('mongoose').Types.ObjectId|null} [opts.cronRunId]
 * @param {string|null} [opts.cronJobKey]
 * @param {(phone10: string, vars: object) => Promise<{ success: boolean, data?: object, error?: string }>} opts.sendFn
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function safeSendWhatsApp({
  phone10,
  formSubmissionId,
  vars,
  retryKind,
  source,
  cronRunId,
  cronJobKey,
  sendFn
}) {
  const { templateIdEnvKey, templateId } = getTemplateMetaForKind(retryKind);

  try {
    if (typeof sendFn !== 'function') {
      console.warn('[WhatsApp]', maskPhone(phone10), `type=${retryKind}`, 'sendFn missing');
      return { success: false, error: 'sendFn missing' };
    }

    const result = await sendFn(phone10, vars);
    const now = new Date();
    const messageId = extractMessageId(result);

    let subId = formSubmissionId;
    if (!subId) {
      const sub = await FormSubmission.findOne({ phone: phone10 }).select('_id').lean();
      subId = sub ? sub._id : null;
    }

    if (result && result.success) {
      const prior = await FormSubmission.findOne({ phone: phone10 }).select('whatsappRetryCount').lean();
      const retrySnapOnSuccess = prior && Number.isFinite(prior.whatsappRetryCount)
        ? prior.whatsappRetryCount
        : 0;

      const setDoc = {
        whatsappRetryCount: 0,
        whatsappRetryKind: null,
        lastWhatsappAttemptAt: now,
        whatsappLastError: null
      };
      if (messageId) {
        setDoc.whatsappLastMessageId = messageId;
      }
      await FormSubmission.updateOne({ phone: phone10 }, { $set: setDoc });

      await WhatsAppMessageEvent.create({
        phone: phone10,
        formSubmissionId: subId,
        messageKind: retryKind,
        cronRunId: cronRunId || null,
        cronJobKey: cronJobKey || null,
        source,
        templateIdEnvKey,
        templateId,
        gupshupMessageId: messageId || null,
        status: 'submitted',
        retryCountSnapshot: retrySnapOnSuccess,
        errorMessage: null
      });

      console.log('[WhatsApp] success', maskPhone(phone10), `type=${retryKind}`);
      return { success: true };
    }

    const errText = (result && result.error) ? String(result.error) : 'send failed';

    const subBefore = await FormSubmission.findOneAndUpdate(
      { phone: phone10 },
      {
        $inc: { whatsappRetryCount: 1 },
        $set: {
          whatsappRetryKind: retryKind,
          lastWhatsappAttemptAt: now,
          whatsappLastError: errText.slice(0, 2000)
        }
      },
      { new: true, select: 'whatsappRetryCount' }
    );

    const snap = subBefore ? subBefore.whatsappRetryCount : null;
    const derivedStatus =
      snap != null && snap >= 3 ? 'retry_exhausted' : 'failed';

    await WhatsAppMessageEvent.create({
      phone: phone10,
      formSubmissionId: subId,
      messageKind: retryKind,
      cronRunId: cronRunId || null,
        cronJobKey: cronJobKey || null,
      source,
      templateIdEnvKey,
      templateId,
      gupshupMessageId: null,
      status: derivedStatus === 'retry_exhausted' ? 'retry_exhausted' : 'failed',
      retryCountSnapshot: snap,
      errorMessage: errText.slice(0, 2000)
    });

    console.warn('[WhatsApp] failure', maskPhone(phone10), `type=${retryKind}`, errText);
    return { success: false, error: errText };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown error';
    const now = new Date();
    try {
      let subId = formSubmissionId;
      if (!subId) {
        const sub = await FormSubmission.findOne({ phone: phone10 }).select('_id').lean();
        subId = sub ? sub._id : null;
      }

      const subBefore = await FormSubmission.findOneAndUpdate(
        { phone: phone10 },
        {
          $inc: { whatsappRetryCount: 1 },
          $set: {
            whatsappRetryKind: retryKind,
            lastWhatsappAttemptAt: now,
            whatsappLastError: msg.slice(0, 2000)
          }
        },
        { new: true, select: 'whatsappRetryCount' }
      );

      const snap = subBefore ? subBefore.whatsappRetryCount : null;
      const evtStatus =
        snap != null && snap >= 3 ? 'retry_exhausted' : 'failed';

      await WhatsAppMessageEvent.create({
        phone: phone10,
        formSubmissionId: subId,
        messageKind: retryKind,
        cronRunId: cronRunId || null,
        cronJobKey: cronJobKey || null,
        source,
        templateIdEnvKey,
        templateId,
        status: evtStatus,
        retryCountSnapshot: snap,
        errorMessage: msg.slice(0, 2000)
      });
    } catch (inner) {
      console.warn('[WhatsApp] failure', maskPhone(phone10), `type=${retryKind}`, msg, '| persist:', inner.message);
      return { success: false, error: msg };
    }
    console.warn('[WhatsApp] failure', maskPhone(phone10), `type=${retryKind}`, msg);
    return { success: false, error: msg };
  }
}

module.exports = {
  safeSendWhatsApp
};
