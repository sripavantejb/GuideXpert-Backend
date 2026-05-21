const CALL_STATUS = ['not_called', 'connected', 'not_connected'];
const LEAD_STATUS = ['interested', 'not_interested', 'callback_pending', 'converted', 'lost'];
const DEMO_STATUS = ['not_scheduled', 'scheduled', 'attended', 'not_attended'];
const NIAT_STATUS = ['not_registered', 'registered'];
const PAYMENT_STATUS = ['none', 'initiated', 'paid'];

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

const CALL_STATUS_LABELS = {
  not_called: 'Not Called',
  connected: 'Connected',
  not_connected: 'Not Connected',
};

const LEAD_STATUS_LABELS = {
  interested: 'Interested',
  not_interested: 'Not Interested',
  callback_pending: 'Callback Pending',
  converted: 'Converted',
  lost: 'Lost',
};

const DEMO_STATUS_LABELS = {
  not_scheduled: 'Not Scheduled',
  scheduled: 'Scheduled',
  attended: 'Attended',
  not_attended: 'Not Attended',
};

const NIAT_STATUS_LABELS = {
  not_registered: 'Not Registered',
  registered: 'Registered',
};

const PAYMENT_STATUS_LABELS = {
  none: 'None',
  initiated: 'Initiated',
  paid: 'Paid',
};

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
