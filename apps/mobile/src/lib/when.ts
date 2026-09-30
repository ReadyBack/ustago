export type When = 'FLEX' | 'TODAY' | 'TOMORROW' | 'WEEK';

/** Preferred time window for the chosen preset, in ISO strings. */
export function windowFor(
  when: When,
  now = new Date(),
): { start: string | null; end: string | null } {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  switch (when) {
    case 'FLEX':
      return { start: null, end: null };
    case 'TODAY': {
      // Late in the evening "today" still means the next hour, never an
      // end before the start (the server rejects that window).
      const end = at(0, 23);
      const latest = end > now ? end : new Date(now.getTime() + 60 * 60_000);
      return { start: now.toISOString(), end: latest.toISOString() };
    }
    case 'TOMORROW':
      return { start: at(1, 9).toISOString(), end: at(1, 19).toISOString() };
    case 'WEEK':
      return { start: now.toISOString(), end: at(7, 19).toISOString() };
  }
}
