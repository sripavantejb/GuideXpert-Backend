'use strict';

/**
 * Operational send window / quiet hours / daily limit (platform ops only).
 */

function parseHourMinute(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { hour: Math.max(0, Math.min(23, Math.floor(value))), minute: 0 };
  }
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  return {
    hour: Math.max(0, Math.min(23, Number(m[1]))),
    minute: Math.max(0, Math.min(59, Number(m[2]))),
  };
}

function minutesOfDay(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  } catch (_) {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

function inTimeRange(nowMinutes, start, end) {
  const s = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  if (s === e) return true; // full day
  if (s < e) return nowMinutes >= s && nowMinutes < e;
  // wraps midnight
  return nowMinutes >= s || nowMinutes < e;
}

/**
 * @returns {{ allowed: boolean, reasons: string[] }}
 */
function evaluateSendWindow(config = {}, now = new Date()) {
  const reasons = [];
  const tz = config.timezone || 'Asia/Kolkata';
  const nowMinutes = minutesOfDay(now, tz);

  if (config.quietHoursEnabled) {
    const qStart = parseHourMinute(config.quietHoursStart, { hour: 22, minute: 0 });
    const qEnd = parseHourMinute(config.quietHoursEnd, { hour: 8, minute: 0 });
    if (inTimeRange(nowMinutes, qStart, qEnd)) {
      reasons.push('quiet_hours');
    }
  }

  if (config.sendWindowEnabled) {
    const wStart = parseHourMinute(config.sendWindowStart, { hour: 9, minute: 0 });
    const wEnd = parseHourMinute(config.sendWindowEnd, { hour: 20, minute: 0 });
    if (!inTimeRange(nowMinutes, wStart, wEnd)) {
      reasons.push('outside_send_window');
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

module.exports = {
  parseHourMinute,
  minutesOfDay,
  inTimeRange,
  evaluateSendWindow,
};
