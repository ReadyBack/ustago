import { feeFor, incrementalFee, MoneyError, mulDivHalfUp, percentOf, splitGross } from './fee.js';

const DEV = { bps: 1500, fixedFeeMinor: 0n, minFeeMinor: null, maxFeeMinor: null };

describe('platform fee arithmetic', () => {
  it('computes the demo numbers exactly (no floats)', () => {
    expect(feeFor(220000n, DEV)).toBe(33000n);
    expect(feeFor(270000n, DEV)).toBe(40500n);
    expect(incrementalFee(0n, 220000n, DEV)).toBe(33000n);
    expect(incrementalFee(220000n, 50000n, DEV)).toBe(7500n);
    expect(splitGross(270000n, 40500n)).toEqual({ gross: 270000n, fee: 40500n, net: 229500n });
  });

  it('rounds HALF_UP to the kuruş', () => {
    // 1 kuruş × 15 % = 0,15 → 0 ; 3 kuruş × 15 % = 0,45 → 0 ; 4 × 15 % = 0,6 → 1
    expect(percentOf(1n, 1500)).toBe(0n);
    expect(percentOf(3n, 1500)).toBe(0n);
    expect(percentOf(4n, 1500)).toBe(1n);
    // exactly half rounds up: 10 × 5 % = 0,5 → 1
    expect(percentOf(10n, 500)).toBe(1n);
    expect(mulDivHalfUp(5n, 1n, 2n)).toBe(3n);
    expect(mulDivHalfUp(7n, 1n, 2n)).toBe(4n);
  });

  it('supports fixed, minimum and maximum fees without passing the gross', () => {
    const policy = { bps: 1000, fixedFeeMinor: 500n, minFeeMinor: 2000n, maxFeeMinor: 30000n };
    expect(feeFor(10000n, policy)).toBe(2000n); // 500 + 1000 → min 2000
    expect(feeFor(100000n, policy)).toBe(10500n);
    expect(feeFor(1000000n, policy)).toBe(30000n); // capped
    expect(feeFor(1000n, policy)).toBe(1000n); // never more than gross
    expect(feeFor(0n, policy)).toBe(0n);
  });

  it('a minimum fee is charged once across split payments', () => {
    const policy = { bps: 0, fixedFeeMinor: 0n, minFeeMinor: 1000n, maxFeeMinor: null };
    expect(incrementalFee(0n, 5000n, policy) + incrementalFee(5000n, 5000n, policy)).toBe(1000n);
  });

  it('rejects invalid input', () => {
    expect(() => percentOf(100n, 10001)).toThrow(MoneyError);
    expect(() => percentOf(100n, 1.5)).toThrow(MoneyError);
    expect(() => incrementalFee(0n, 0n, DEV)).toThrow(MoneyError);
    expect(() => splitGross(100n, 101n)).toThrow(MoneyError);
    expect(() => mulDivHalfUp(-1n, 1n, 1n)).toThrow(MoneyError);
  });
});

/** Tiny deterministic PRNG so the property runs are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

describe('fee properties (1000 random cases each)', () => {
  it('fees of split payments always add up to the fee of the total', () => {
    const r = rng(42);
    for (let i = 0; i < 1000; i += 1) {
      const policy = {
        bps: r(10001),
        fixedFeeMinor: BigInt(r(3)) * 100n,
        minFeeMinor: r(2) ? BigInt(r(5000)) : null,
        maxFeeMinor: r(2) ? BigInt(5000 + r(100000)) : null,
      };
      const parts = Array.from({ length: 1 + r(4) }, () => BigInt(1 + r(500000)));
      let before = 0n;
      let sum = 0n;
      for (const p of parts) {
        const fee = incrementalFee(before, p, policy);
        expect(fee).toBeGreaterThanOrEqual(0n);
        expect(fee).toBeLessThanOrEqual(p);
        sum += fee;
        before += p;
      }
      expect(sum).toBe(feeFor(before, policy));
    }
  });

  it('gross = fee + net and 0 ≤ fee ≤ gross', () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i += 1) {
      const gross = BigInt(1 + r(10_000_000));
      const fee = feeFor(gross, {
        bps: r(10001),
        fixedFeeMinor: 0n,
        minFeeMinor: null,
        maxFeeMinor: null,
      });
      const split = splitGross(gross, fee);
      expect(split.fee + split.net).toBe(gross);
      expect(split.net).toBeGreaterThanOrEqual(0n);
    }
  });
});
