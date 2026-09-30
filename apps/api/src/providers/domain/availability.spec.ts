import { describe, expect, it } from 'vitest';

import { computeAvailability, isInWeeklyHours } from './availability.js';

const TZ = 'Europe/Istanbul';
// 2026-09-30 is a Wednesday (weekday 3). 07:00Z = 10:00 in İstanbul (UTC+3).
const WED_10 = new Date('2026-09-30T07:00:00Z');
const WED_20 = new Date('2026-09-30T17:00:00Z');
const weekday9to18 = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 18 * 60,
}));

const base = {
  acceptingNewJobs: true,
  unavailableUntil: null,
  weeklyHours: weekday9to18,
  timeOff: [],
  now: WED_10,
  timeZone: TZ,
};

describe('computeAvailability', () => {
  it('is available inside weekly hours in Europe/Istanbul', () => {
    const r = computeAvailability(base);
    expect(r).toMatchObject({ state: 'AVAILABLE', receivesNewJobs: true, workingNow: true });
    expect(r.availableToday).toBe(true);
  });

  it('still receives quote requests outside hours, but is not working now', () => {
    const r = computeAvailability({ ...base, now: WED_20 });
    expect(r).toMatchObject({ state: 'OUTSIDE_HOURS', receivesNewJobs: true, workingNow: false });
    expect(r.availableToday).toBe(false);
  });

  it('treats empty hours as flexible', () => {
    expect(computeAvailability({ ...base, weeklyHours: [], now: WED_20 }).state).toBe('AVAILABLE');
  });

  it('"Yeni iş alma" wins over everything', () => {
    const r = computeAvailability({
      ...base,
      acceptingNewJobs: false,
      timeOff: [{ startsAt: new Date(0), endsAt: new Date('2027-01-01') }],
    });
    expect(r).toMatchObject({ state: 'PAUSED', receivesNewJobs: false, availableToday: false });
  });

  it('time off blocks new jobs; a cancelled time off does not', () => {
    const t = {
      startsAt: new Date('2026-09-29T00:00:00Z'),
      endsAt: new Date('2026-10-02T00:00:00Z'),
    };
    expect(computeAvailability({ ...base, timeOff: [t] })).toMatchObject({
      state: 'TIME_OFF',
      onTimeOff: true,
      receivesNewJobs: false,
    });
    expect(computeAvailability({ ...base, timeOff: [{ ...t, cancelledAt: WED_10 }] }).state).toBe(
      'AVAILABLE',
    );
  });

  it('"Bugün müsait değilim" expires by itself', () => {
    const until = new Date('2026-09-30T21:00:00Z');
    expect(computeAvailability({ ...base, unavailableUntil: until }).state).toBe(
      'UNAVAILABLE_TODAY',
    );
    expect(
      computeAvailability({
        ...base,
        unavailableUntil: until,
        now: new Date('2026-10-01T07:00:00Z'),
      }).state,
    ).toBe('AVAILABLE');
  });
});

describe('isInWeeklyHours', () => {
  it('uses half-open intervals', () => {
    expect(isInWeeklyHours(weekday9to18, 3, 9 * 60)).toBe(true);
    expect(isInWeeklyHours(weekday9to18, 3, 18 * 60)).toBe(false);
    expect(isInWeeklyHours(weekday9to18, 6, 12 * 60)).toBe(false);
  });
});
