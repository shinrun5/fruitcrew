// Every DateTime column that represents a wall-clock time (shift/requirement/
// availability start-end, etc.) is stored anchored to 1970-01-01 and read
// back in UTC — these two are the shared read/write pair for that.

/** The DateTime columns hold a wall-clock time (e.g. 11:30); read the clock face in UTC. */
export function toHHMM(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" -> the 1970-01-01 wall-clock DateTime the rest of the app stores (matches toHHMM). */
export function toClock(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}
