// Calendar rules for subscriptions. Tiffin is India-only, so "today" and "tomorrow" mean
// Indian (IST) calendar dates. Dates are always 'YYYY-MM-DD' strings: a JavaScript Date carries
// a time zone and can move a calendar date by one day when it is converted.
const TIME_ZONE = 'Asia/Kolkata';
const CUTOFF_MINUTES = 21 * 60; // 9 PM IST: tomorrow's deliveries are locked

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// The IST calendar date and minutes past midnight at a moment (default: now).
function istNow(at = new Date()) {
  const p = Object.fromEntries(formatter.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

// Calendar arithmetic, done in UTC so no local time zone can interfere.
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ISO weekday: 1 = Monday … 7 = Sunday (the same numbering as Postgres `extract(isodow …)`).
function isoWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

// The first date a customer can still change (start, skip, pause, un-skip). Before 9 PM that is
// tomorrow; from 9 PM, tomorrow is locked, so it is the day after.
function firstOpenDate(now = istNow()) {
  return addDays(now.date, now.minutes >= CUTOFF_MINUTES ? 2 : 1);
}

// 'YYYY-MM-DD' strings sort like the dates they name, so plain comparison works.
function isLocked(date, now = istNow()) {
  return date < firstOpenDate(now);
}

module.exports = { TIME_ZONE, CUTOFF_MINUTES, istNow, addDays, isoWeekday, firstOpenDate, isLocked };
