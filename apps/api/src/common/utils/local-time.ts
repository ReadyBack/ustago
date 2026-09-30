/**
 * Wall-clock helpers for the marketplace time zone (Faz 7, docs/adr/0031).
 * Timestamps are stored in UTC; weekly hours and "today" are local
 * (Europe/Istanbul by default). Everything goes through Intl, so a zone
 * with daylight saving time would also work.
 */

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday, 1 = Monday ... 7 = Sunday. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    weekday: WEEKDAYS[parts['weekday'] ?? 'Mon'] ?? 1,
  };
}

/** Minutes since local midnight (0-1439). */
export function localMinuteOfDay(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** Offset of the zone from UTC at `date`, in minutes (Istanbul: +180). */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const floored = Math.floor(date.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - floored) / 60_000);
}

/** The instant of local midnight that starts the day `date` is in. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  const guess = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60_000);
}

/** Local midnight at the end of `date`'s day (start of the next day). */
export function endOfLocalDay(date: Date, timeZone: string): Date {
  const start = startOfLocalDay(date, timeZone);
  // 26 h later is always inside the next local day, even across a DST change.
  return startOfLocalDay(new Date(start.getTime() + 26 * 3_600_000), timeZone);
}
