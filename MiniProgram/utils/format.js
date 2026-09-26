// Mirrors Frontend/src/lib/time.ts's convention: Shift.start/end are ISO
// datetimes where only the wall-clock time (read in UTC) matters — the date
// part is a fixed placeholder, not the actual calendar day.
const DAY_SHORT = {
  MONDAY: 'MON',
  TUESDAY: 'TUE',
  WEDNESDAY: 'WED',
  THURSDAY: 'THU',
  FRIDAY: 'FRI',
  SATURDAY: 'SAT',
  SUNDAY: 'SUN',
};

function hhmm12(iso) {
  const d = new Date(iso);
  let h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ap = h < 12 ? 'AM' : 'PM';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

function timeRange(startIso, endIso) {
  return `${hhmm12(startIso)} – ${hhmm12(endIso)}`;
}

function dayShort(day) {
  return DAY_SHORT[day] || day;
}

module.exports = { hhmm12, timeRange, dayShort };
