import { windowFor } from './when';

describe('windowFor', () => {
  const now = new Date(2026, 8, 30, 10, 30);

  it('has no window when the time is flexible', () => {
    expect(windowFor('FLEX', now)).toEqual({ start: null, end: null });
  });

  it('starts tomorrow morning and ends tomorrow evening', () => {
    const w = windowFor('TOMORROW', now);
    expect(new Date(w.start ?? '').getDate()).toBe(1);
    expect(new Date(w.start ?? '').getHours()).toBe(9);
    expect(new Date(w.end ?? '').getHours()).toBe(19);
  });

  it('keeps every window ordered', () => {
    for (const when of ['TODAY', 'TOMORROW', 'WEEK'] as const) {
      const w = windowFor(when, now);
      expect(Date.parse(w.end ?? '')).toBeGreaterThan(Date.parse(w.start ?? ''));
    }
  });

  it('keeps "Bugün" valid after 23:00', () => {
    const late = new Date(2026, 8, 30, 23, 30);
    const w = windowFor('TODAY', late);
    expect(Date.parse(w.end ?? '')).toBeGreaterThan(Date.parse(w.start ?? ''));
    expect(Date.parse(w.end ?? '') - late.getTime()).toBe(60 * 60_000);
  });
});
