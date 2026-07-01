const mongoose = require('mongoose');

const ACTIVITY_VALUES = [
  'reaching_out_contacts',
  'shared_posters',
  'started_conversations',
  'identified_students',
  'started_counseling',
  'follow_ups',
  'generated_lead',
  'started_nat_application',
  'booked_nat_exam',
  'completed_sr',
  'not_started_yet',
];

const NEW_LEADS_VALUES = ['0', '1-2', '3-5', '5+'];
const NEW_NAT_VALUES = ['0', '1', '2-5', '5+'];
const SEAT_RESERVATION_VALUES = ['0', '1', '2-5', '5+'];
const CHALLENGE_VALUES = [
  'finding_students',
  'starting_conversations',
  'counseling_students',
  'follow_ups',
  'nat_conversions',
  'time_management',
  'confidence',
  'other',
];

const schema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    mobileNumber: { type: String, required: true, trim: true, match: /^\d{10}$/ },
    activities: {
      type: [{ type: String, enum: ACTIVITY_VALUES }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one activity must be selected.',
      },
    },
    newLeads: { type: String, required: true, enum: NEW_LEADS_VALUES },
    newNatApplications: { type: String, required: true, enum: NEW_NAT_VALUES },
    seatReservations: { type: String, required: true, enum: SEAT_RESERVATION_VALUES },
    biggestChallenge: { type: String, required: true, enum: CHALLENGE_VALUES },
    biggestChallengeOther: { type: String, trim: true, maxlength: 500, default: '' },
    slotDate: { type: String, required: true, trim: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    slotTime: { type: String, required: true, enum: ['15:00', '17:00'] },
  },
  { timestamps: true }
);

schema.index({ createdAt: -1 });
schema.index({ mobileNumber: 1 });

module.exports = mongoose.model('ProgressCheckInSubmission', schema);
module.exports.ACTIVITY_VALUES = ACTIVITY_VALUES;
module.exports.NEW_LEADS_VALUES = NEW_LEADS_VALUES;
module.exports.NEW_NAT_VALUES = NEW_NAT_VALUES;
module.exports.SEAT_RESERVATION_VALUES = SEAT_RESERVATION_VALUES;
module.exports.CHALLENGE_VALUES = CHALLENGE_VALUES;
