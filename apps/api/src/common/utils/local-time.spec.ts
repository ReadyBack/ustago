import { describe, expect, it } from 'vitest';

import { endOfLocalDay, localMinuteOfDay, localParts, startOfLocalDay } from './local-time.js';

const TZ = 'Europe/Istanbul';

describe('local time (Europe/Istanbul, UTC+3)', () => {
  it('reads the local wall clock and ISO weekday', () => {
    // 2026-10-05 is a Monday; 21:30 UTC is 00:30 on Tuesday in Istanbul.
    const p = localParts(new Date('2026-10-05T21:30:00Z'), TZ);
    expect(p).toMatchObject({ day: 6, hour: 0, minute: 30, weekday: 2 });
    expect(localMinuteOfDay(new Date('2026-10-05T06:15:00Z'), TZ)).toBe(9 * 60 + 15);
  });

  it('finds local midnight around the UTC date line', () => {
    expect(startOfLocalDay(new Date('2026-10-05T22:00:00Z'), TZ).toISOString()).toBe(
      '2026-10-05T21:00:00.000Z',
    );
    expect(endOfLocalDay(new Date('2026-10-05T10:00:00Z'), TZ).toISOString()).toBe(
      '2026-10-05T21:00:00.000Z',
    );
  });

  it('handles a zone with daylight saving time', () => {
    // Berlin switches to CET on 2026-10-25.
    expect(startOfLocalDay(new Date('2026-10-25T12:00:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-10-24T22:00:00.000Z',
    );
  });
});
