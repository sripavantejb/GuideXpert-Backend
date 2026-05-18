/**
 * Shared IST slot-day cohort helpers for WhatsApp ops analytics.
 * Events are attributed to the submission's step3Data.slotDate IST calendar day only
 * (no createdAt-based cohort fallback — avoids cross-day / orphan leakage).
 */

const { parseOpsProductQuery, matchWhatsAppEventsByOpsProduct } = require('../utils/whatsappOpsProduct');

const IST_OFFSET_MINUTES = 330;

function parseIsoDateOnly(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return { y, m, d, iso: s };
}

function istDayRangeFromIso(dateIso) {
  const p = parseIsoDateOnly(dateIso);
  if (!p) return null;
  const startUtcMs = Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0, 0) - IST_OFFSET_MINUTES * 60 * 1000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000 - 1;
  return { from: new Date(startUtcMs), to: new Date(endUtcMs), isoDate: p.iso };
}

/** IST calendar YYYY-MM-DD for a slot instant (matches analytics slotDayIst). */
function slotDayIstFromInstant(slotDate) {
  const t = new Date(slotDate);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * @param {string|null|undefined} messageKindFilter
 * @param {{ strictSlotDay?: boolean }} [options] strictSlotDay default true — slotDayIst only when submission has slotDate
 * @returns {object[]}
 */
function annotateEventsWithSlotDayPipeline(messageKindFilter, options = {}) {
  const strictSlotDay = options.strictSlotDay !== false;
  const match = {
    ...(messageKindFilter ? { messageKind: messageKindFilter } : {}),
    ...matchWhatsAppEventsByOpsProduct(parseOpsProductQuery(options.opsProduct))
  };
  return [
    { $match: match },
    {
      $addFields: {
        lineageId: {
          $ifNull: ['$canonicalRetryGroupId', '$retryGroupId']
        }
      }
    },
    {
      $lookup: {
        from: 'formsubmissions',
        localField: 'formSubmissionId',
        foreignField: '_id',
        pipeline: [{ $project: { step3Data: 1, phone: 1 } }],
        as: 'subDoc'
      }
    },
    {
      $addFields: {
        slotDateFromSub: {
          $ifNull: [
            '$cohortSlotInstantUtc',
            {
              $cond: [
                { $gt: [{ $size: '$subDoc' }, 0] },
                { $arrayElemAt: ['$subDoc.step3Data.slotDate', 0] },
                null
              ]
            }
          ]
        }
      }
    },
    {
      $addFields: {
        hasSubmissionSlot: { $ne: ['$slotDateFromSub', null] },
        cohortFallback: {
          $and: [
            { $eq: [{ $ifNull: ['$cohortSlotInstantUtc', null] }, null] },
            { $lte: [{ $size: '$subDoc' }, 0] }
          ]
        }
      }
    },
    {
      $addFields: {
        slotDayIst: strictSlotDay
          ? {
              $cond: [
                '$hasSubmissionSlot',
                {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$slotDateFromSub',
                    timezone: 'Asia/Kolkata'
                  }
                },
                null
              ]
            }
          : {
              $cond: [
                { $ne: ['$slotDateFromSub', null] },
                {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$slotDateFromSub',
                    timezone: 'Asia/Kolkata'
                  }
                },
                {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$createdAt',
                    timezone: 'Asia/Kolkata'
                  }
                }
              ]
            }
      }
    }
  ];
}

module.exports = {
  IST_OFFSET_MINUTES,
  parseIsoDateOnly,
  istDayRangeFromIso,
  slotDayIstFromInstant,
  annotateEventsWithSlotDayPipeline
};
