import type { FunnelStep } from '@ustago/types';
import { describe, expect, it } from 'vitest';

import {
  formatDistanceKm,
  formatMedianPrice,
  formatMinutes,
  formatPercent,
  formatPrivateCount,
  formatRatio,
  funnelRows,
  isLaunchStatus,
  launchStatusPayload,
  parseCursor,
  parseOlderThan,
  parsePeriod,
  parseProvinceId,
} from './marketplace';

const step = (key: FunnelStep['key'], requests: number): FunnelStep => ({
  key,
  label: key,
  requests,
});

describe('funnelRows', () => {
  it('computes step-to-step and of-first conversion from the API counts', () => {
    const rows = funnelRows([
      step('created', 200),
      step('dispatched', 180),
      step('viewed', 90),
      step('quoted', 45),
      step('accepted', 15),
      step('started', 12),
      step('completed', 10),
    ]);
    expect(rows.map((r) => r.fromPreviousPercent)).toEqual([null, 90, 50, 50, 33.3, 80, 83.3]);
    expect(rows.map((r) => r.ofFirstPercent)).toEqual([100, 90, 45, 22.5, 7.5, 6, 5]);
    expect(rows[0]?.barPercent).toBe(100);
    expect(rows[6]?.barPercent).toBe(5);
  });

  it('never divides by zero: an empty step leaves the next conversion unknown', () => {
    const rows = funnelRows([step('created', 0), step('dispatched', 0), step('viewed', 0)]);
    expect(rows.map((r) => r.fromPreviousPercent)).toEqual([null, null, null]);
    expect(rows.map((r) => r.ofFirstPercent)).toEqual([null, null, null]);
    expect(rows.map((r) => r.barPercent)).toEqual([0, 0, 0]);
    expect(funnelRows([])).toEqual([]);
  });

  it('keeps the API numbers untouched', () => {
    const rows = funnelRows([step('created', 7), step('dispatched', 3)]);
    expect(rows.map((r) => r.requests)).toEqual([7, 3]);
  });
});

describe('formatting', () => {
  it('shows "<5" for counts hidden below the privacy threshold', () => {
    expect(formatPrivateCount(null)).toBe('<5');
    expect(formatPrivateCount(0)).toBe('0');
    expect(formatPrivateCount(1234)).toBe('1.234');
  });

  it('shows "—" for a percentage without a denominator', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(42.5)).toBe('%42,5');
    expect(formatPercent(0)).toBe('%0');
  });

  it('shows "Yetersiz veri" for a median price below the sample threshold', () => {
    expect(formatMedianPrice(null)).toBe('Yetersiz veri');
    expect(formatMedianPrice(125_000)).toBe('₺1.250');
  });

  it('formats ratios, minutes and approximate distances', () => {
    expect(formatRatio(null)).toBe('—');
    expect(formatRatio(2.345)).toBe('2,3');
    expect(formatMinutes(null)).toBe('—');
    expect(formatMinutes(45)).toBe('45 dk');
    expect(formatMinutes(60)).toBe('1 sa');
    expect(formatMinutes(190)).toBe('3 sa 10 dk');
    expect(formatMinutes(3120)).toBe('2 gün 4 sa');
    expect(formatMinutes(2880)).toBe('2 gün');
    expect(formatDistanceKm(null)).toBe('—');
    expect(formatDistanceKm(3.42)).toBe('≈ 3,4 km');
  });
});

describe('launch status', () => {
  it('maps each status to the PATCH /locations/provinces/:id body', () => {
    expect(launchStatusPayload('ACTIVE')).toEqual({ isActive: true, waitlistOpen: false });
    expect(launchStatusPayload('WAITLIST')).toEqual({ isActive: false, waitlistOpen: true });
    expect(launchStatusPayload('DISABLED')).toEqual({ isActive: false, waitlistOpen: false });
  });

  it('accepts only the three statuses', () => {
    expect(isLaunchStatus('WAITLIST')).toBe(true);
    expect(isLaunchStatus('waitlist')).toBe(false);
    expect(isLaunchStatus(undefined)).toBe(false);
  });
});

describe('query parsing', () => {
  it('accepts only 7, 30 or 90 days', () => {
    expect(parsePeriod('30', 7)).toBe(30);
    expect(parsePeriod(['90', '7'], 7)).toBe(90);
    expect(parsePeriod('14', 7)).toBe(7);
    expect(parsePeriod(undefined, 30)).toBe(30);
  });

  it('accepts plate codes 1–81 only', () => {
    expect(parseProvinceId('34')).toBe(34);
    expect(parseProvinceId('0')).toBeUndefined();
    expect(parseProvinceId('82')).toBeUndefined();
    expect(parseProvinceId('1; drop')).toBeUndefined();
  });

  it('keeps known age filters and safe cursors', () => {
    expect(parseOlderThan('240')).toBe(240);
    expect(parseOlderThan('7')).toBe(60);
    expect(parseCursor('0190a000-0000-7000-8000-00000000000a')).toBe(
      '0190a000-0000-7000-8000-00000000000a',
    );
    expect(parseCursor('a&b=c')).toBeUndefined();
  });
});
