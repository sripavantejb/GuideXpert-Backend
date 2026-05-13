/**
 * Non-blocking WhatsApp send with FormSubmission retry fields + WhatsAppMessageEvent audit row.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const FormSubmission = require('../models/FormSubmission');
const WhatsAppMessageEvent = require('../models/WhatsAppMessageEvent');
const WhatsAppRetryGroup = require('../models/WhatsAppRetryGroup');
const { getTemplateMetaForKind } = require('./whatsappTemplateMeta');
const { parseGupshupTemplateSendResponse } = require('./gupshupMessageIds');
const {
  retrySourceFromAttemptNumber,
  isImmediateOnlyStrategy,
  isRetryableFailure,
  isCampaignStrategy,
  getRetryPolicy,
  RETRY_EXCLUSION_REASON
} = require('./whatsappRetryRules');
const { getCampaignReminderEligibility, CAMPAIGN_RELATIVE_KINDS } = require('./waReminderEligibility');

function maskPhone(phone10) {
  const s = String(phone10 || '').replace(/\D/g, '');
  const last4 = s.slice(-4);
  return last4.length === 4 ? `****${last4}` : '****';
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

function mapSourceToGroupTrigger(source) {
  switch (source) {
    case 'save_step3':
      return 'save_step3';
    case 'cron':
      return 'cron';
    case 'retry_cron':
      return 'cron';
    case 'admin_manual':
      return 'manual';
    case 'retry_api':
      return 'retry_api';
    default:
      return 'manual';
  }
}

async function resolveRetryGroupId({ retryGroupId, messageKind, cronRunId, source }) {
  if (retryGroupId && mongoose.Types.ObjectId.isValid(String(retryGroupId))) {
    return new mongoose.Types.ObjectId(String(retryGroupId));
  }
  const g = await WhatsAppRetryGroup.create({
    messageKind,
    cronRunId: cronRunId || null,
    trigger: mapSourceToGroupTrigger(source),
    status: 'open'
  });
  return g._id;
}

function toOidMaybe(value) {
  if (value != null && mongoose.Types.ObjectId.isValid(String(value))) {
    return new mongoose.Types.ObjectId(String(value));
  }
  return null;
}

function buildMessageEventPayload({
  phone10,
  subId,
  retryKind,
  cronRunId,
  cronJobKey,
  source,
  templateIdEnvKey,
  templateId,
  messageId,
  ids,
  payloadSnippet,
  now,
  status,
  retrySnap,
  errText,
  retryGroupId,
  attemptNumber,
  parentOid,
  attemptBatchOid,
  retrySourceLabel,
  retryEligible,
  correlationId,
  canonicalRetryGroupId,
  terminalFailureKind,
  retryExclusionReason
}) {
  return {
    phone: phone10,
    formSubmissionId: subId,
    messageKind: retryKind,
    cronRunId: cronRunId || null,
    cronJobKey: cronJobKey || null,
    source,
    templateIdEnvKey,
    templateId,
    gupshupMessageId: messageId,
    gupshupInternalMessageId: ids.gupshupInternalMessageId || null,
    whatsappWaMessageId: ids.whatsappWaMessageId || null,
    providerAcceptedAt: status === 'submitted' || messageId ? now : null,
    providerPayloadSnippet: payloadSnippet,
    status,
    retryCountSnapshot: retrySnap,
    errorMessage: errText ? errText.slice(0, 2000) : null,
    retryGroupId,
    canonicalRetryGroupId: canonicalRetryGroupId || null,
    attemptNumber,
    parentMessageEventId: parentOid,
    attemptBatchId: attemptBatchOid,
    retrySource: retrySourceLabel,
    retryEligible,
    terminalFailureKind: terminalFailureKind || null,
    retryExclusionReason: retryExclusionReason || null,
    correlationId: correlationId || null
  };
}

async function persistAttemptEvent(payload) {
  const key = {
    retryGroupId: payload.retryGroupId,
    phone: payload.phone,
    attemptNumber: payload.attemptNumber
  };
  if (payload.attemptNumber > 1 && payload.retryGroupId) {
    await WhatsAppMessageEvent.updateOne(
      key,
      {
        $set: payload,
        $setOnInsert: { createdAt: payload.createdAt || new Date() }
      },
      { upsert: true }
    );
    return;
  }
  await WhatsAppMessageEvent.create(payload);
}

/**
 * @param {object} opts
 * @param {string} opts.phone10
 * @param {string} [opts.formSubmissionId]
 * @param {object} opts.vars
 * @param {'slot_booked'|'pre4hr'|'meet'|'30min'} opts.retryKind
 * @param {'save_step3'|'cron'|'retry_cron'|'admin_manual'|'retry_api'} opts.source
 * @param {import('mongoose').Types.ObjectId|null} [opts.cronRunId]
 * @param {string|null} [opts.cronJobKey]
 * @param {(phone10: string, vars: object) => Promise<{ success: boolean, data?: object, error?: string }>} opts.sendFn
 * @param {import('mongoose').Types.ObjectId|null} [opts.retryGroupId]
 * @param {number} [opts.attemptNumber]
 * @param {import('mongoose').Types.ObjectId|null} [opts.parentMessageEventId]
 * @param {import('mongoose').Types.ObjectId|null} [opts.attemptBatchId]
 * @param {string|null} [opts.correlationId]
 * @param {boolean} [opts.skipSlotRelativeGuard] when true, skip pre4hr/meet/30min slot-window guard (admin manual)
 * @returns {Promise<{ success: boolean, error?: string, retryGroupId?: import('mongoose').Types.ObjectId }>}
 */
async function safeSendWhatsApp({
  phone10,
  formSubmissionId,
  vars,
  retryKind,
  source,
  cronRunId,
  cronJobKey,
  sendFn,
  retryGroupId: retryGroupIdOpt,
  attemptNumber: attemptNumberOpt,
  parentMessageEventId,
  attemptBatchId: attemptBatchIdOpt,
  correlationId: correlationIdOpt,
  canonicalRetryGroupId: canonicalRetryGroupIdOpt,
  skipSlotRelativeGuard
}) {
  const { templateIdEnvKey, templateId } = getTemplateMetaForKind(retryKind);
  const varSummary = summarizeVars(vars);

  const attNum = Math.min(6, Math.max(1, parseInt(String(attemptNumberOpt ?? 1), 10) || 1));
  const retrySourceLabel = retrySourceFromAttemptNumber(attNum);
  const correlationId = correlationIdOpt || crypto.randomUUID();
  const canonicalOid = toOidMaybe(canonicalRetryGroupIdOpt);
  let resolvedGroupId = null;

  try {
    if (typeof sendFn !== 'function') {
      console.warn('[WhatsApp]', maskPhone(phone10), `type=${retryKind}`, 'sendFn missing');
      return { success: false, error: 'sendFn missing' };
    }

    resolvedGroupId = await resolveRetryGroupId({
      retryGroupId: retryGroupIdOpt,
      messageKind: retryKind,
      cronRunId,
      source
    });
    const parentOid = toOidMaybe(parentMessageEventId);
    let attemptBatchOid = toOidMaybe(attemptBatchIdOpt);
    if (!attemptBatchOid && attNum === 1 && cronRunId) {
      attemptBatchOid = toOidMaybe(cronRunId);
    }

    console.log(
      '[WhatsApp] attempt',
      maskPhone(phone10),
      `type=${retryKind}`,
      `attempt=${attNum}`,
      `group=${String(resolvedGroupId)}`,
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

    if (!skipSlotRelativeGuard && CAMPAIGN_RELATIVE_KINDS.has(retryKind)) {
      const subG = formSubmissionId
        ? await FormSubmission.findById(formSubmissionId).select('step3Data.slotDate').lean()
        : await FormSubmission.findOne({ phone: phone10 }).select('step3Data.slotDate').lean();
      const slot = subG && subG.step3Data ? subG.step3Data.slotDate : null;
      const elig = getCampaignReminderEligibility(retryKind, slot, new Date());
      if (!elig.ok) {
        console.warn('[WhatsApp] skipped_outside_validity', maskPhone(phone10), `type=${retryKind}`, elig.reason || '');
        return {
          success: false,
          error: elig.reason || 'outside_reminder_validity',
          skippedOutsideWindow: true
        };
      }
    }

    const result = await sendFn(phone10, vars);
    const now = new Date();
    const ids = parseGupshupTemplateSendResponse(result && result.data);
    const messageId = ids.canonicalMessageId || null;
    const payloadSnippet = providerPayloadSnippet(result);
    if (result && result.success && !messageId) {
      console.warn('[WhatsApp] send_ok_but_no_provider_id', {
        mask: maskPhone(phone10),
        type: retryKind,
        templateId: templateId || null,
        templateKey: templateIdEnvKey || null
      });
    }

    let subId = formSubmissionId;
    if (!subId) {
      const sub = await FormSubmission.findOne({ phone: phone10 }).select('_id').lean();
      subId = sub ? sub._id : null;
    }

    if (result && result.success) {
      const prior = await FormSubmission.findOne({ phone: phone10 }).select('whatsappRetryCount').lean();
      const retrySnapOnSuccess =
        prior && Number.isFinite(prior.whatsappRetryCount) ? prior.whatsappRetryCount : 0;

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

      await persistAttemptEvent(
        buildMessageEventPayload({
          phone10,
          subId,
          retryKind,
          cronRunId,
          cronJobKey,
          source,
          templateIdEnvKey,
          templateId,
          messageId,
          ids,
          payloadSnippet,
          now,
          status: 'submitted',
          retrySnap: retrySnapOnSuccess,
          errText: null,
          retryGroupId: resolvedGroupId,
          attemptNumber: attNum,
          parentOid,
          attemptBatchOid,
          retrySourceLabel,
          retryEligible: false,
          correlationId,
          canonicalRetryGroupId: canonicalOid,
          terminalFailureKind: null,
          retryExclusionReason: null
        })
      );

      console.log('[WhatsApp] success', maskPhone(phone10), `type=${retryKind}`);
      return { success: true, retryGroupId: resolvedGroupId };
    }

    const errText = result && result.error ? String(result.error) : 'send failed';
    const providerDebug = providerPayloadSnippet(result, 500) || '';

    let snap = attNum > 1 ? attNum - 1 : null;
    if (attNum === 1) {
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
      snap = subBefore ? subBefore.whatsappRetryCount : null;
    }

    const immediateOnly = isImmediateOnlyStrategy(retryKind);
    const transientRetryable = isRetryableFailure(retryKind, { errorText: errText });
    const policy = getRetryPolicy(retryKind);
    const maxA = Number(policy.maxAttempts) || 3;

    let derivedStatus = 'failed';
    let rowRetryEligible = true;
    let terminalFailureKind = null;
    let permExcl = null;

    if (immediateOnly) {
      derivedStatus =
        (immediateOnly && attNum >= 2) || (!transientRetryable && immediateOnly) || attNum >= maxA
          ? 'retry_exhausted'
          : 'failed';
      rowRetryEligible = attNum === 1 && transientRetryable;
    } else if (isCampaignStrategy(retryKind)) {
      if (!transientRetryable) {
        derivedStatus = 'failed';
        rowRetryEligible = false;
        terminalFailureKind = 'permanent';
        permExcl = RETRY_EXCLUSION_REASON.permanentFailure;
      } else if (attNum >= maxA) {
        derivedStatus = 'retry_exhausted';
        rowRetryEligible = false;
      } else {
        derivedStatus = 'failed';
        rowRetryEligible = true;
      }
    } else {
      derivedStatus = attNum >= maxA ? 'retry_exhausted' : 'failed';
      rowRetryEligible = attNum < maxA;
    }

    await persistAttemptEvent(
      buildMessageEventPayload({
        phone10,
        subId,
        retryKind,
        cronRunId,
        cronJobKey,
        source,
        templateIdEnvKey,
        templateId,
        messageId: null,
        ids,
        payloadSnippet: providerDebug || null,
        now,
        status: derivedStatus,
        retrySnap: snap,
        errText,
        retryGroupId: resolvedGroupId,
        attemptNumber: attNum,
        parentOid,
        attemptBatchOid,
        retrySourceLabel,
        retryEligible: rowRetryEligible,
        correlationId,
        canonicalRetryGroupId: canonicalOid,
        terminalFailureKind,
        retryExclusionReason: permExcl
      })
    );

    console.warn(
      '[WhatsApp] failure',
      maskPhone(phone10),
      `type=${retryKind}`,
      errText,
      providerDebug ? `provider=${providerDebug}` : ''
    );
    return { success: false, error: errText, retryGroupId: resolvedGroupId };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : 'unknown error';
    const now = new Date();
    try {
      if (!resolvedGroupId) {
        resolvedGroupId = await resolveRetryGroupId({
          retryGroupId: retryGroupIdOpt,
          messageKind: retryKind,
          cronRunId,
          source
        });
      }
      const parentOidInner = toOidMaybe(parentMessageEventId);
      let attemptBatchOidInner = toOidMaybe(attemptBatchIdOpt);
      if (!attemptBatchOidInner && attNum === 1 && cronRunId) {
        attemptBatchOidInner = toOidMaybe(cronRunId);
      }

      let subId = formSubmissionId;
      if (!subId) {
        const sub = await FormSubmission.findOne({ phone: phone10 }).select('_id').lean();
        subId = sub ? sub._id : null;
      }

      let snap = attNum > 1 ? attNum - 1 : null;
      if (attNum === 1) {
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
        snap = subBefore ? subBefore.whatsappRetryCount : null;
      }

      const immediateOnly = isImmediateOnlyStrategy(retryKind);
      const transientRetryable = isRetryableFailure(retryKind, { errorText: msg });
      const policy = getRetryPolicy(retryKind);
      const maxA = Number(policy.maxAttempts) || 3;
      let evtStatus = 'failed';
      let rowRetryEligible = true;
      let terminalFailureKind = null;
      let permExcl = null;
      if (immediateOnly) {
        evtStatus =
          (immediateOnly && attNum >= 2) || (!transientRetryable && immediateOnly) || attNum >= maxA
            ? 'retry_exhausted'
            : 'failed';
        rowRetryEligible = attNum === 1 && transientRetryable;
      } else if (isCampaignStrategy(retryKind)) {
        if (!transientRetryable) {
          evtStatus = 'failed';
          rowRetryEligible = false;
          terminalFailureKind = 'permanent';
          permExcl = RETRY_EXCLUSION_REASON.permanentFailure;
        } else if (attNum >= maxA) {
          evtStatus = 'retry_exhausted';
          rowRetryEligible = false;
        } else {
          evtStatus = 'failed';
          rowRetryEligible = true;
        }
      } else {
        evtStatus = attNum >= maxA ? 'retry_exhausted' : 'failed';
        rowRetryEligible = attNum < maxA;
      }

      await persistAttemptEvent(
        buildMessageEventPayload({
          phone10,
          subId,
          retryKind,
          cronRunId,
          cronJobKey,
          source,
          templateIdEnvKey,
          templateId,
          messageId: null,
          ids: {},
          payloadSnippet: null,
          now,
          status: evtStatus,
          retrySnap: snap,
          errText: msg,
          retryGroupId: resolvedGroupId,
          attemptNumber: attNum,
          parentOid: parentOidInner,
          attemptBatchOid: attemptBatchOidInner,
          retrySourceLabel,
          retryEligible: rowRetryEligible,
          correlationId,
          canonicalRetryGroupId: canonicalOid,
          terminalFailureKind,
          retryExclusionReason: permExcl
        })
      );
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
