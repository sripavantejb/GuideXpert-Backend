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
  const candidates = [
    d.messageId,
    d.message_id,
    d.id,
    d.msgId,
    d.gsId,
    d?.data?.messageId,
    d?.data?.id
  ];
  const id = candidates.find((x) => x != null && x !== '');
  return id != null && id !== '' ? String(id) : undefined;
}

function summarizeVars(vars) {
  const src = vars && typeof vars === 'object' ? vars : {};
  const keys = Object.keys(src);
  const preview = {};
  keys.forEach((k) => {
    const v = src[k];
    preview[k] = v == null ? 0 : String(v).trim().length;
  });
  return { keys, lengths: preview };
}

function providerPayloadSnippet(result, max = 1000) {
  if (!result || result.data == null) return null;
  try {
    const s = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return null;
  }
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
  const varSummary = summarizeVars(vars);

  try {
    if (typeof sendFn !== 'function') {
      console.warn('[WhatsApp]', maskPhone(phone10), `type=${retryKind}`, 'sendFn missing');
      return { success: false, error: 'sendFn missing' };
    }

    console.log(
      '[WhatsApp] attempt',
      maskPhone(phone10),
      `type=${retryKind}`,
      `templateKey=${templateIdEnvKey || 'n/a'}`,
      `templateId=${templateId || 'missing'}`,
      `vars=${JSON.stringify(varSummary)}`
    );
    if (!templateId) {
      console.warn('[WhatsApp] template missing', maskPhone(phone10), `type=${retryKind}`, templateIdEnvKey || 'unknown');
    }
    const emptyKeys = varSummary.keys.filter((k) => (varSummary.lengths[k] || 0) === 0);
    if (emptyKeys.length > 0) {
      console.warn('[WhatsApp] empty var values', maskPhone(phone10), `type=${retryKind}`, emptyKeys.join(','));
    }

    const result = await sendFn(phone10, vars);
    const now = new Date();
    const messageId = extractMessageId(result);
    const payloadSnippet = providerPayloadSnippet(result);

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
        providerAcceptedAt: now,
        providerPayloadSnippet: payloadSnippet,
        status: 'submitted',
        retryCountSnapshot: retrySnapOnSuccess,
        errorMessage: null
      });

      console.log('[WhatsApp] success', maskPhone(phone10), `type=${retryKind}`);
      return { success: true };
    }

    const errText = (result && result.error) ? String(result.error) : 'send failed';
    const providerDebug = providerPayloadSnippet(result, 500) || '';

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

    console.warn(
      '[WhatsApp] failure',
      maskPhone(phone10),
      `type=${retryKind}`,
      errText,
      providerDebug ? `provider=${providerDebug}` : ''
    );
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
