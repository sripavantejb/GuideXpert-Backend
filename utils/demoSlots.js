function getNextSaturday7PMIST() {
  const d = new Date();
  const day = d.getUTCDay();
  let days = (6 - day + 7) % 7;
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  if (days === 0 && utcHours >= 13.5) days = 7; // 7:00 PM IST = 13:30 UTC
  const sat = new Date(d);
  sat.setUTCDate(d.getUTCDate() + days);
  sat.setUTCHours(13, 30, 0, 0);
  return sat;
}

function getNextSunday3PMIST() {
  const d = new Date();
  const day = d.getUTCDay();
  let days = (7 - day) % 7;
  const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  if (days === 0 && utcHours >= 9.5) days = 7; // 3:00 PM IST = 09:30 UTC
  const sun = new Date(d);
  sun.setUTCDate(d.getUTCDate() + days);
  sun.setUTCHours(9, 30, 0, 0);
  return sun;
}

function formatSlotLabel(date) {
  const datePart = date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short'
  });
  const timePart = date.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `${datePart} — ${timePart}`;
}

function getDemoSlots() {
  const slot1 = {
    id: 'SATURDAY_7PM',
    label: formatSlotLabel(getNextSaturday7PMIST())
  };
  const slot2 = {
    id: 'SUNDAY_3PM',
    label: formatSlotLabel(getNextSunday3PMIST())
  };
  return { slot1, slot2 };
}

module.exports = { getDemoSlots };
