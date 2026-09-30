import { type ReconciliationInput, reconcile } from './reconciliation.js';

function base(): ReconciliationInput {
  return {
    ledger: new Map([
      ['payment:p1:captured', { amount: 220000n, feeCredit: 33000n }],
      ['earning:e1:released', { amount: 187000n, feeCredit: 0n }],
      ['refund:r1:requested', { amount: 50000n, feeCredit: 0n }],
      ['refund:r1:completed', { amount: 50000n, feeCredit: 0n }],
      ['payout:o1:reserved', { amount: 100000n, feeCredit: 0n }],
      ['payout:o1:paid', { amount: 100000n, feeCredit: 0n }],
      ['cash:c1:fee', { amount: 33000n, feeCredit: 33000n }],
    ]),
    payments: [
      {
        id: 'p1',
        status: 'PARTIALLY_REFUNDED',
        amount: 220000n,
        fee: 33000n,
        refundedSucceeded: 50000n,
      },
    ],
    earnings: [{ id: 'e1', paymentId: 'p1', status: 'AVAILABLE', gross: 220000n, fee: 33000n }],
    refunds: [{ id: 'r1', status: 'SUCCEEDED', amount: 50000n }],
    payouts: [{ id: 'o1', status: 'PAID', amount: 100000n }],
    cash: [{ id: 'c1', status: 'CONFIRMED', fee: 33000n }],
    unbalancedTransactions: [],
    negativeProviderAccounts: [],
  };
}

describe('reconciliation rules', () => {
  it('finds nothing in a consistent set', () => {
    expect(reconcile(base())).toEqual([]);
  });

  it('Faz 6: a payout with an unknown outcome is always reported', () => {
    const input = base();
    input.ledger.delete('payout:o1:paid');
    input.payouts = [{ id: 'o1', status: 'NEEDS_RECONCILIATION', amount: 100000n }];
    expect(reconcile(input).map((m) => m.kind)).toContain('PAYOUT_OUTCOME_UNKNOWN');
  });

  it.each([
    ['PAYMENT_WITHOUT_LEDGER', (i: ReconciliationInput) => i.ledger.delete('payment:p1:captured')],
    [
      'PAYMENT_FEE_MISMATCH',
      (i: ReconciliationInput) => (i.payments = i.payments.map((p) => ({ ...p, fee: 1n }))),
    ],
    [
      'PAYMENT_STATUS_MISMATCH',
      (i: ReconciliationInput) =>
        (i.payments = i.payments.map((p) => ({ ...p, status: 'SUCCEEDED' as const }))),
    ],
    ['PAYMENT_WITHOUT_EARNING', (i: ReconciliationInput) => (i.earnings = [])],
    ['EARNING_RELEASE_MISSING', (i: ReconciliationInput) => i.ledger.delete('earning:e1:released')],
    [
      'REFUND_COMPLETION_MISSING',
      (i: ReconciliationInput) => i.ledger.delete('refund:r1:completed'),
    ],
    ['PAYOUT_PAID_MISMATCH', (i: ReconciliationInput) => i.ledger.delete('payout:o1:paid')],
    [
      'PAYOUT_WITHOUT_RESERVATION',
      (i: ReconciliationInput) => i.ledger.delete('payout:o1:reserved'),
    ],
    ['CASH_FEE_MISSING', (i: ReconciliationInput) => i.ledger.delete('cash:c1:fee')],
    ['LEDGER_UNBALANCED', (i: ReconciliationInput) => i.unbalancedTransactions.push('t1')],
    [
      'NEGATIVE_PROVIDER_BALANCE',
      (i: ReconciliationInput) =>
        i.negativeProviderAccounts.push({
          accountId: 'a1',
          type: 'PROVIDER_AVAILABLE',
          balance: -1n,
        }),
    ],
  ])('reports %s', (kind, mutate) => {
    const input = base();
    mutate(input);
    expect(reconcile(input).map((m) => m.kind)).toContain(kind);
  });
});
