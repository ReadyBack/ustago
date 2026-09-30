import {
  balanceOf,
  cashFeeAssessed,
  credit,
  debit,
  earningReleased,
  LedgerError,
  type LedgerLine,
  payoutPaid,
  payoutReleased,
  payoutReserved,
  paymentCaptured,
  refundCompleted,
  refundRequested,
  reversalLines,
  trialBalance,
  validateLines,
} from './ledger.js';

const P = 'provider-1';

function balances(lines: LedgerLine[]) {
  const out: Record<string, bigint> = {};
  for (const l of lines) {
    const key = `${l.account.type}:${l.account.providerId ?? 'platform'}`;
    out[key] = (out[key] ?? 0n) + balanceOf(l.account.type, [l]);
  }
  return out;
}

describe('double-entry ledger', () => {
  it('refuses unbalanced, single-line, negative or mis-owned transactions', () => {
    const clearing = { type: 'PLATFORM_CLEARING' as const };
    const revenue = { type: 'PLATFORM_FEE_REVENUE' as const };
    expect(() => validateLines([debit(clearing, 100n), credit(revenue, 99n)])).toThrow(LedgerError);
    expect(() => validateLines([debit(clearing, 100n)])).toThrow(LedgerError);
    expect(() => validateLines([debit(clearing, -1n), credit(revenue, -1n)])).toThrow(LedgerError);
    expect(() =>
      validateLines([debit({ type: 'PROVIDER_PENDING' }, 1n), credit(revenue, 1n)]),
    ).toThrow(LedgerError);
    // Zero lines are dropped, not booked.
    expect(
      validateLines([debit(clearing, 5n), credit(revenue, 5n), credit(revenue, 0n)]),
    ).toHaveLength(2);
  });

  it('demo scenario A+D balances every account as expected', () => {
    const lines = [
      ...paymentCaptured({ providerId: P, gross: 220000n, fee: 33000n }).lines,
      ...paymentCaptured({ providerId: P, gross: 50000n, fee: 7500n }).lines,
      ...earningReleased({ providerId: P, amount: 229500n, debtToSettle: 0n }).lines,
      ...payoutReserved({ providerId: P, amount: 100000n }).lines,
      ...payoutPaid({ providerId: P, amount: 100000n }).lines,
    ];
    expect(
      trialBalance(lines.map((l) => ({ direction: l.direction, amount: l.amount }))).balanced,
    ).toBe(true);
    const b = balances(lines);
    expect(b['PLATFORM_CLEARING:platform']).toBe(170000n);
    expect(b['PLATFORM_FEE_REVENUE:platform']).toBe(40500n);
    expect(b[`PROVIDER_PENDING:${P}`]).toBe(0n);
    expect(b[`PROVIDER_AVAILABLE:${P}`]).toBe(129500n);
    expect(b[`PROVIDER_RESERVED:${P}`]).toBe(0n);
  });

  it('cash fee becomes debt and is settled from the next release', () => {
    const lines = [
      ...cashFeeAssessed({ providerId: P, fee: 33000n }).lines,
      ...paymentCaptured({ providerId: P, gross: 100000n, fee: 15000n }).lines,
      ...earningReleased({ providerId: P, amount: 85000n, debtToSettle: 33000n }).lines,
    ];
    const b = balances(lines);
    expect(b[`PROVIDER_PLATFORM_DEBT:${P}`]).toBe(0n);
    expect(b[`PROVIDER_AVAILABLE:${P}`]).toBe(52000n);
    expect(() => earningReleased({ providerId: P, amount: 1n, debtToSettle: 2n })).toThrow(
      LedgerError,
    );
  });

  it('a refund request and its reversal cancel out; completion closes the liability', () => {
    const req = refundRequested({
      providerId: P,
      amount: 50000n,
      feePortion: 7500n,
      source: { fromPending: 42500n, fromAvailable: 0n, toDebt: 0n },
    }).lines;
    const net = balances([...req, ...reversalLines(req)]);
    expect(Object.values(net).every((v) => v === 0n)).toBe(true);
    const done = balances([...req, ...refundCompleted(50000n).lines]);
    expect(done['REFUND_LIABILITY:platform']).toBe(0n);
    expect(() =>
      refundRequested({
        providerId: P,
        amount: 50000n,
        feePortion: 7500n,
        source: { fromPending: 1n, fromAvailable: 0n, toDebt: 0n },
      }),
    ).toThrow(LedgerError);
  });

  it('a failed payout gives the reservation back', () => {
    const b = balances([
      ...payoutReserved({ providerId: P, amount: 100000n }).lines,
      ...payoutReleased({ providerId: P, amount: 100000n }).lines,
    ]);
    expect(b[`PROVIDER_AVAILABLE:${P}`]).toBe(0n);
    expect(b[`PROVIDER_RESERVED:${P}`]).toBe(0n);
  });

  it('any random sequence of builders stays balanced (500 runs)', () => {
    let s = 3;
    const r = (max: number) => {
      s = (Math.imul(s, 22695477) + 1) >>> 0;
      return s % max;
    };
    for (let run = 0; run < 500; run += 1) {
      const lines: LedgerLine[] = [];
      for (let i = 0; i < 20; i += 1) {
        const amount = BigInt(1 + r(100000));
        const fee = (amount * BigInt(r(10001))) / 10000n;
        const pick = r(5);
        if (pick === 0) lines.push(...paymentCaptured({ providerId: P, gross: amount, fee }).lines);
        if (pick === 1) lines.push(...cashFeeAssessed({ providerId: P, fee: amount }).lines);
        if (pick === 2) lines.push(...payoutReserved({ providerId: P, amount }).lines);
        if (pick === 3) lines.push(...refundCompleted(amount).lines);
        if (pick === 4)
          lines.push(...earningReleased({ providerId: P, amount, debtToSettle: fee }).lines);
      }
      const t = trialBalance(lines.map((l) => ({ direction: l.direction, amount: l.amount })));
      expect(t.balanced).toBe(true);
    }
  });
});
