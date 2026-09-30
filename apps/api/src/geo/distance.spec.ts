import { describe, expect, it } from 'vitest';

import {
  approxDistance,
  boundingBox,
  coarsen,
  HaversineDistanceCalculator,
  roundApproxKm,
} from './distance.js';

const calc = new HaversineDistanceCalculator();
const ADANA = { lat: 36.9862, lng: 35.3253 };
const MERSIN = { lat: 36.8121, lng: 34.6415 };
const ISTANBUL = { lat: 41.0138, lng: 28.9497 };
const ANKARA = { lat: 39.9199, lng: 32.8543 };

describe('HaversineDistanceCalculator', () => {
  it('is zero for the same point and symmetric', () => {
    expect(calc.distanceKm(ADANA, ADANA)).toBe(0);
    expect(calc.distanceKm(ADANA, MERSIN)).toBeCloseTo(calc.distanceKm(MERSIN, ADANA), 9);
  });

  it('matches known straight-line distances between city centres', () => {
    // Adana–Mersin ≈ 64 km, İstanbul–Ankara ≈ 350 km (straight line, not road).
    expect(calc.distanceKm(ADANA, MERSIN)).toBeGreaterThan(60);
    expect(calc.distanceKm(ADANA, MERSIN)).toBeLessThan(68);
    expect(calc.distanceKm(ISTANBUL, ANKARA)).toBeGreaterThan(340);
    expect(calc.distanceKm(ISTANBUL, ANKARA)).toBeLessThan(360);
  });

  it('says it is a straight-line calculator', () => {
    expect(calc.kind).toBe('STRAIGHT_LINE');
  });
});

describe('display rounding', () => {
  it('never shows 0 km or false precision', () => {
    expect(roundApproxKm(0)).toBe(1);
    expect(roundApproxKm(0.3)).toBe(1);
    expect(roundApproxKm(3.26)).toBe(3.5);
    expect(roundApproxKm(12.4)).toBe(12);
    expect(roundApproxKm(-5)).toBe(1);
    expect(roundApproxKm(Number.NaN)).toBe(1);
  });

  it('always marks the distance approximate', () => {
    expect(approxDistance(12.4)).toEqual({ km: 12, approximate: true });
    expect(approxDistance(null)).toBeNull();
  });

  it('coarsens coordinates to about a kilometre', () => {
    expect(coarsen(36.98765)).toBe(36.99);
    expect(coarsen(35.32111)).toBe(35.32);
  });

  it('builds a bounding box that contains points within the radius', () => {
    const box = boundingBox(ADANA, 70);
    expect(MERSIN.lat).toBeGreaterThan(box.minLat);
    expect(MERSIN.lng).toBeGreaterThan(box.minLng);
    const small = boundingBox(ADANA, 10);
    expect(MERSIN.lng).toBeLessThan(small.minLng);
  });
});
