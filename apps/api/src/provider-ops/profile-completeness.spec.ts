import { describe, expect, it } from 'vitest';

import { profileCompleteness } from './profile-completeness.js';

const empty = {
  hasPhoto: false,
  bioLength: 0,
  serviceCount: 0,
  areaCount: 0,
  portfolioCount: 0,
  weeklyHoursCount: 0,
  hasServiceCenter: false,
  verified: false,
};

describe('profileCompleteness', () => {
  it('is 0 for an empty profile and 100 when every item is done', () => {
    expect(profileCompleteness(empty).percent).toBe(0);
    expect(
      profileCompleteness({
        hasPhoto: true,
        bioLength: 40,
        serviceCount: 2,
        areaCount: 3,
        portfolioCount: 1,
        weeklyHoursCount: 5,
        hasServiceCenter: true,
        verified: true,
      }).percent,
    ).toBe(100);
  });

  it('needs both hours and a service centre for availability', () => {
    const r = profileCompleteness({ ...empty, weeklyHoursCount: 5 });
    expect(r.items.find((i) => i.key === 'availability')?.done).toBe(false);
  });

  it('never mentions ranking', () => {
    const text = JSON.stringify(profileCompleteness(empty));
    expect(text).not.toMatch(/sıra|rank/i);
  });
});
