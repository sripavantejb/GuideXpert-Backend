/** Canonical IIT counselling group session slot ids (admin + public booking). */
const ALL_IIT_SLOT_IDS = ['WEDNESDAY_6PM', 'SATURDAY_6PM', 'SUNDAY_11AM'];

const IIT_SLOT_ID_TO_BOOKING_LABEL = {
  WEDNESDAY_6PM: 'Wednesday 6PM',
  SATURDAY_6PM: 'Saturday 6PM',
  SUNDAY_11AM: 'Sunday 11AM',
};

const IIT_BOOKING_LABEL_TO_SLOT_ID = Object.fromEntries(
  Object.entries(IIT_SLOT_ID_TO_BOOKING_LABEL).map(([id, label]) => [label, id])
);

const IIT_SLOT_ID_DISPLAY_LABEL = {
  WEDNESDAY_6PM: 'Wednesday • 6:00 PM',
  SATURDAY_6PM: 'Saturday • 6:00 PM',
  SUNDAY_11AM: 'Sunday • 11:00 AM',
};

module.exports = {
  ALL_IIT_SLOT_IDS,
  IIT_SLOT_ID_TO_BOOKING_LABEL,
  IIT_BOOKING_LABEL_TO_SLOT_ID,
  IIT_SLOT_ID_DISPLAY_LABEL,
};
