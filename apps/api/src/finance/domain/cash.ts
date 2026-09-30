import type { CashSettlementStatus } from '../../generated/prisma/enums.js';

/**
 * "Ustaya doğrudan ödeme" (docs/adr/0020). UstaGO never sees the money,
 * so it is only recorded as paid when BOTH sides confirm; one button never
 * settles it. Either side can say it did not happen, which stops the flow
 * (DISPUTED) and an admin records the outcome. No side is picked
 * automatically.
 */

export type CashParty = 'CUSTOMER' | 'PROVIDER';

export type CashDecision =
  | { kind: 'MOVE'; to: CashSettlementStatus; confirmed: boolean }
  | { kind: 'ALREADY_DONE' }
  | { kind: 'INVALID' };

export function decideCashConfirm(current: CashSettlementStatus, party: CashParty): CashDecision {
  switch (current) {
    case 'AWAITING_CONFIRMATION':
      return {
        kind: 'MOVE',
        to: party === 'CUSTOMER' ? 'CUSTOMER_CONFIRMED' : 'PROVIDER_CONFIRMED',
        confirmed: false,
      };
    case 'CUSTOMER_CONFIRMED':
      return party === 'CUSTOMER'
        ? { kind: 'ALREADY_DONE' }
        : { kind: 'MOVE', to: 'CONFIRMED', confirmed: true };
    case 'PROVIDER_CONFIRMED':
      return party === 'PROVIDER'
        ? { kind: 'ALREADY_DONE' }
        : { kind: 'MOVE', to: 'CONFIRMED', confirmed: true };
    case 'CONFIRMED':
      return { kind: 'ALREADY_DONE' };
    default:
      return { kind: 'INVALID' };
  }
}

/** Either side may dispute until the settlement is confirmed by both. */
export function canDisputeCash(current: CashSettlementStatus): boolean {
  return (
    current === 'AWAITING_CONFIRMATION' ||
    current === 'CUSTOMER_CONFIRMED' ||
    current === 'PROVIDER_CONFIRMED'
  );
}

export function hasConfirmed(current: CashSettlementStatus, party: CashParty): boolean {
  if (current === 'CONFIRMED') return true;
  return party === 'CUSTOMER' ? current === 'CUSTOMER_CONFIRMED' : current === 'PROVIDER_CONFIRMED';
}
