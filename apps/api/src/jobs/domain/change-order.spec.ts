import { MAX_PRICE_MINOR } from '@ustago/validation';

import {
  answerTransition,
  canAnswerChangeOrder,
  canProposeChangeOrder,
  ChangeOrderAmountError,
  proposedTotal,
  totalAfterAccept,
} from './change-order.js';

describe('change orders', () => {
  it('can be proposed and answered only while the work is under way', () => {
    expect(canProposeChangeOrder('IN_PROGRESS')).toBe(true);
    for (const s of [
      'CREATED',
      'PROVIDER_ARRIVED',
      'AWAITING_COMPLETION_CONFIRMATION',
      'COMPLETED',
    ] as const) {
      expect(canProposeChangeOrder(s)).toBe(false);
      expect(canAnswerChangeOrder(s)).toBe(false);
    }
  });

  it('adds the extra to the current total, never touching the agreed price', () => {
    // Faz 3 demo: agreed 2.200 TL; +500 TL, then +300 TL.
    const agreed = 220000n;
    const first = proposedTotal(agreed, 50000n);
    expect(first).toBe(270000n);
    expect(totalAfterAccept(agreed, { previousTotalMinor: agreed, amountDeltaMinor: 50000n })).toBe(
      270000n,
    );
    expect(proposedTotal(first, 30000n)).toBe(300000n);
  });

  it('refuses zero, negative and over-the-ceiling amounts', () => {
    expect(() => proposedTotal(220000n, 0n)).toThrow(ChangeOrderAmountError);
    expect(() => proposedTotal(220000n, -100n)).toThrow(ChangeOrderAmountError);
    expect(() => proposedTotal(BigInt(MAX_PRICE_MINOR), 100n)).toThrow(ChangeOrderAmountError);
  });

  it('treats an order proposed against another total as stale', () => {
    expect(
      totalAfterAccept(270000n, { previousTotalMinor: 220000n, amountDeltaMinor: 30000n }),
    ).toBeNull();
  });

  it('answers only PENDING orders, once', () => {
    expect(answerTransition('PENDING', 'ACCEPT')).toBe('ACCEPTED');
    expect(answerTransition('PENDING', 'REJECT')).toBe('REJECTED');
    expect(answerTransition('PENDING', 'CANCEL')).toBe('CANCELLED');
    expect(answerTransition('ACCEPTED', 'ACCEPT')).toBeNull();
    expect(answerTransition('ACCEPTED', 'REJECT')).toBeNull();
    expect(answerTransition('REJECTED', 'ACCEPT')).toBeNull();
  });
});
