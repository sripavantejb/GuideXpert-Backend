const IST_TZ = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';

const IST_FORMAT = {
  timeZone: IST_TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatIst(date) {
  return new Date(date).toLocaleString('en-IN', IST_FORMAT);
}

/** @param {string} hhmm "HH:mm" */
function parseHHmm(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

/**
 * IST wall time to UTC Date.
 * @param {number} y
 * @param {number} month 1-12
 * @param {number} day
 * @param {{ h: number, min: number }} hm
 */
function istWallToUtc(y, month, day, hm) {
  const iso = `${y}-${pad2(month)}-${pad2(day)}T${pad2(hm.h)}:${pad2(hm.min)}:00${IST_OFFSET}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Date} utcDate
 * @returns {{ y: number, month: number, day: number, dow: number }}
 */
function istYmdAndDow(utcDate) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    f.formatToParts(utcDate)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    dow: map[parts.weekday] ?? 0,
  };
}

/**
 * Move an IST calendar anchor by whole days (no DST in India).
 * @param {Date} utcDate
 * @param {number} deltaDays
 */
function addCalendarDaysIST(utcDate, deltaDays) {
  const { y, month, day } = istYmdAndDow(utcDate);
  const noonIst = new Date(`${y}-${pad2(month)}-${pad2(day)}T12:00:00${IST_OFFSET}`);
  return new Date(noonIst.getTime() + deltaDays * 86400000);
}

/**
 * @param {{ recurringWindows?: unknown[], joinEarlyMinutes?: number }} schedule
 * @param {Date} now
 * @param {{ scanDays?: number }} [opts]
 * @returns {{
 *   phase: 'allowed'|'too_early'|'no_windows',
 *   message?: string,
 *   joinOpensAt?: string,
 *   slotEnd?: string,
 *   slotStart?: string,
 *   joinOpensAtLabel?: string,
 *   slotEndLabel?: string,
 *   slotStartLabel?: string,
 * }}
 */
function evaluateLiveWindows(schedule, now = new Date(), opts = {}) {
  const scanDays = opts.scanDays ?? 14;
  const windowsIn = Array.isArray(schedule?.recurringWindows) ? schedule.recurringWindows : [];
  const joinEarlyMinutes =
    typeof schedule?.joinEarlyMinutes === 'number' && schedule.joinEarlyMinutes >= 0
      ? schedule.joinEarlyMinutes
      : 5;
  const earlyMs = joinEarlyMinutes * 60 * 1000;

  if (windowsIn.length === 0) {
    return {
      phase: 'no_windows',
      message:
        'Demo meet join is not configured yet. Please ask an administrator to set live windows under Admin → Demo meet schedule.',
    };
  }

  const recurringWindows = [];
  for (const w of windowsIn) {
    const dow = Number(w?.dayOfWeek);
    const startHHmm = typeof w?.startHHmm === 'string' ? w.startHHmm : '';
    const endHHmm = typeof w?.endHHmm === 'string' ? w.endHHmm : '';
    const sh = parseHHmm(startHHmm);
    const eh = parseHHmm(endHHmm);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6 || !sh || !eh) continue;
    recurringWindows.push({ dayOfWeek: dow, startHHmm, endHHmm, _sh: sh, _eh: eh });
  }

  if (recurringWindows.length === 0) {
    return {
      phase: 'no_windows',
      message: 'Demo meet live windows are invalid or empty. Please fix the schedule in Admin.',
    };
  }

  const t = now.getTime();
  /** @type {{ joinOpens: number, endUtc: number, startUtc: number }[]} */
  const instances = [];

  for (let dayOffset = 0; dayOffset < scanDays; dayOffset += 1) {
    const probe = addCalendarDaysIST(now, dayOffset);
    const { y, month, day, dow } = istYmdAndDow(probe);
    for (const w of recurringWindows) {
      if (w.dayOfWeek !== dow) continue;
      const startUtc = istWallToUtc(y, month, day, w._sh);
      const endUtc = istWallToUtc(y, month, day, w._eh);
      if (!startUtc || !endUtc || endUtc.getTime() <= startUtc.getTime()) continue;
      const joinOpens = startUtc.getTime() - earlyMs;
      instances.push({
        joinOpens,
        endUtc: endUtc.getTime(),
        startUtc: startUtc.getTime(),
      });
    }
  }

  instances.sort((a, b) => a.joinOpens - b.joinOpens);

  for (const inst of instances) {
    if (t >= inst.joinOpens && t < inst.endUtc) {
      return {
        phase: 'allowed',
        message: 'You may join the demo meet now (live session window).',
        joinOpensAt: new Date(inst.joinOpens).toISOString(),
        slotEnd: new Date(inst.endUtc).toISOString(),
        slotStart: new Date(inst.startUtc).toISOString(),
        joinOpensAtLabel: formatIst(new Date(inst.joinOpens)),
        slotEndLabel: formatIst(new Date(inst.endUtc)),
        slotStartLabel: formatIst(new Date(inst.startUtc)),
      };
    }
  }

  /** Next join: smallest joinOpens with joinOpens > t (between windows or before first). */
  let next = null;
  for (const inst of instances) {
    if (inst.joinOpens <= t) continue;
    if (!next || inst.joinOpens < next.joinOpens) next = inst;
  }

  if (!next) {
    return {
      phase: 'too_early',
      message:
        'No upcoming demo meet window was found in the schedule. Please contact support or try again later.',
      joinOpensAtLabel: '',
      slotEndLabel: '',
      slotStartLabel: '',
    };
  }

  return {
    phase: 'too_early',
    message: `The live demo session is not open yet. You can join from ${formatIst(new Date(next.joinOpens))} until ${formatIst(new Date(next.endUtc))} (India time).`,
    joinOpensAt: new Date(next.joinOpens).toISOString(),
    slotEnd: new Date(next.endUtc).toISOString(),
    slotStart: new Date(next.startUtc).toISOString(),
    joinOpensAtLabel: formatIst(new Date(next.joinOpens)),
    slotEndLabel: formatIst(new Date(next.endUtc)),
    slotStartLabel: formatIst(new Date(next.startUtc)),
  };
}

module.exports = {
  evaluateLiveWindows,
  parseHHmm,
  istYmdAndDow,
  istWallToUtc,
  addCalendarDaysIST,
  formatIst,
  IST_TZ,
};
