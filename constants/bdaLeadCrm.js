/** CRM enums for IIT counselling leads (admin + BDA portal). Includes legacy values for existing rows. */

const CALL_STATUS = [
  'not_called',
  'call_connected',
  'not_connected',
  'busy',
  'switched_off',
  'not_reachable',
  'wrong_number',
  'call_back_later',
  // legacy
  'connected',
];

const LEAD_STATUS = [
  'interested',
  'not_interested',
  'maybe',
  'callback_pending',
  'call_back_needed',
  'converted',
  'lost',
];

const DEMO_STATUS = [
  'not_scheduled',
  'demo_scheduled',
  'scheduled',
  'attended',
  'not_attended',
  'rescheduled',
];

const NIAT_STATUS = [
  'not_registered',
  'registered',
  'registration_initiated',
];

const PAYMENT_STATUS = [
  'not_paid',
  'payment_initiated',
  'amount_paid',
  'partially_paid',
  // legacy
  'none',
  'initiated',
  'paid',
];

const CALL_STATUS_LABELS = {
  not_called: 'Not Called',
  call_connected: 'Call Connected',
  connected: 'Call Connected',
  not_connected: 'Not Connected',
  busy: 'Busy',
  switched_off: 'Switched Off',
  not_reachable: 'Not Reachable',
  wrong_number: 'Wrong Number',
  call_back_later: 'Call Back Later',
};

const LEAD_STATUS_LABELS = {
  interested: 'Interested',
  not_interested: 'Not Interested',
  maybe: 'Maybe',
  callback_pending: 'Callback Pending',
  call_back_needed: 'Call Back Needed',
  converted: 'Converted',
  lost: 'Lost',
};

const DEMO_STATUS_LABELS = {
  not_scheduled: 'Not Scheduled',
  demo_scheduled: 'Demo Scheduled',
  scheduled: 'Demo Scheduled',
  attended: 'Demo Attended',
  not_attended: 'Demo Not Attended',
  rescheduled: 'Rescheduled',
};

const NIAT_STATUS_LABELS = {
  not_registered: 'Not Registered',
  registered: 'Registered',
  registration_initiated: 'Registration Initiated',
};

const PAYMENT_STATUS_LABELS = {
  not_paid: 'Not Paid',
  payment_initiated: 'Payment Initiated',
  amount_paid: 'Amount Paid',
  partially_paid: 'Partially Paid',
  none: 'Not Paid',
  initiated: 'Payment Initiated',
  paid: 'Amount Paid',
};

function normalizeCallStatus(v) {
  if (v === 'connected') return 'call_connected';
  return v || 'not_called';
}

function normalizePaymentStatus(v) {
  if (v === 'none') return 'not_paid';
  if (v === 'initiated') return 'payment_initiated';
  if (v === 'paid') return 'amount_paid';
  return v || 'not_paid';
}

function normalizeDemoStatus(v) {
  if (v === 'scheduled') return 'demo_scheduled';
  return v || 'not_scheduled';
}

module.exports = {
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
  normalizeCallStatus,
  normalizePaymentStatus,
  normalizeDemoStatus,
};
