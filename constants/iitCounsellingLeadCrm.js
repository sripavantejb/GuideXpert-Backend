const {
  CALL_STATUS,
  LEAD_STATUS,
  DEMO_STATUS,
  NIAT_STATUS,
  PAYMENT_STATUS,
  CALL_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  DEMO_STATUS_LABELS,
  NIAT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
} = require('./bdaLeadCrm');

const EVENT_TYPES = [
  'assignment',
  'call_status',
  'lead_status',
  'demo_status',
  'niat_status',
  'payment_status',
  'remark',
  'callback_date',
];

module.exports = {
  CALL_STATUS,
  LEAD_STATUS,
  DEMO_STATUS,
  NIAT_STATUS,
  PAYMENT_STATUS,
  EVENT_TYPES,
  CALL_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  DEMO_STATUS_LABELS,
  NIAT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
};
