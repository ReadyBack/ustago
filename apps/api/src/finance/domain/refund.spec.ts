import {
  assertRefundable,
  RefundAmountError,
  refundableAmount,
  refundSource,
  splitRefund,
} from './refund.js';

describe('refund arithmetic', () => {
  it('never refunds more than was paid', () => {
    expect(refundableAmount(220000n, 0n)).toBe(220000n);
    expect(refundableAmount(220000n, 50000n)).toBe(170000n);
    expect(refundableAmount(220000n, 220000n)).toBe(0n);
    expect(() => assertRefundable(170001n, 170000n)).toThrow(RefundAmountError);
    expect(() => assertRefundable(0n, 170000n)).toThrow(RefundAmountError);
    expect(() => assertRefundable(170000n, 170000n)).not.toThrow();
  });

  it('splits a refund in proportion to the fee (demo: 500 of 2200 → 75 fee, 425 provider)', () => {
    expect(splitRefund({ paid: 220000n, fee: 33000n, refundedBefore: 0n, amount: 50000n })).toEqual(
      {
        feePortion: 7500n,
        providerPortion: 42500n,
      },
    );
  });

  it('partial refunds give back exactly the fee in total (1000 random cases)', () => {
    let s = 11;
    const r = (max: number) => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s % max;
    };
    for (let i = 0; i < 1000; i += 1) {
      const paid = BigInt(1 + r(1_000_000));
      const fee = (paid * BigInt(r(10001))) / 10000n;
      let refunded = 0n;
      let feeBack = 0n;
      while (refunded < paid) {
        const rest = paid - refunded;
        const amount = r(3) === 0 ? rest : 1n + (BigInt(r(1_000_000)) % rest);
        const part = splitRefund({ paid, fee, refundedBefore: refunded, amount });
        expect(part.feePortion).toBeGreaterThanOrEqual(0n);
        expect(part.providerPortion).toBeGreaterThanOrEqual(0n);
        expect(part.feePortion + part.providerPortion).toBe(amount);
        feeBack += part.feePortion;
        refunded += amount;
      }
      expect(feeBack).toBe(fee);
    }
  });

  it('takes the provider part from pending, then available, then debt', () => {
    expect(
      refundSource({
        providerPortion: 42500n,
        earningReleased: false,
        earningPendingBalance: 187000n,
        providerAvailable: 0n,
      }),
    ).toEqual({ fromPending: 42500n, fromAvailable: 0n, toDebt: 0n });
    expect(
      refundSource({
        providerPortion: 42500n,
        earningReleased: true,
        earningPendingBalance: 0n,
        providerAvailable: 100000n,
      }),
    ).toEqual({ fromPending: 0n, fromAvailable: 42500n, toDebt: 0n });
    // Already withdrawn: the rest becomes platform debt, no bank pull-back.
    expect(
      refundSource({
        providerPortion: 42500n,
        earningReleased: true,
        earningPendingBalance: 0n,
        providerAvailable: 10000n,
      }),
    ).toEqual({ fromPending: 0n, fromAvailable: 10000n, toDebt: 32500n });
  });

  it('rejects a refund above the payment', () => {
    expect(() => splitRefund({ paid: 100n, fee: 15n, refundedBefore: 90n, amount: 11n })).toThrow(
      RefundAmountError,
    );
  });
});
