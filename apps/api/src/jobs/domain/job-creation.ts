import type { CurrencyCode, JobStatus } from '../../generated/prisma/client.js';

/** Every job starts here; later states (en route, started...) come in Faz 7. */
export const INITIAL_JOB_STATUS: JobStatus = 'CREATED';

export interface AcceptedDeal {
  serviceRequest: {
    id: string;
    customerId: string;
    categoryId: string;
    preferredStartAt: Date | null;
  };
  quote: { id: string; providerId: string };
  revision: { id: string; totalMinor: bigint; currency: CurrencyCode; availableFrom: Date | null };
}

/**
 * The job row for an accepted negotiation (docs/adr/0006, 0008, 0014).
 * AGREED_PRICE is the accepted revision's total, whoever proposed it; the
 * customer's budget plays no part. `currentTotalMinor` starts equal and
 * only moves through accepted change orders.
 */
export function jobFromAcceptedDeal(deal: AcceptedDeal) {
  if (deal.revision.totalMinor <= 0n) throw new RangeError('Agreed price must be positive');
  return {
    serviceRequestId: deal.serviceRequest.id,
    quoteId: deal.quote.id,
    acceptedRevisionId: deal.revision.id,
    customerId: deal.serviceRequest.customerId,
    providerId: deal.quote.providerId,
    categoryId: deal.serviceRequest.categoryId,
    status: INITIAL_JOB_STATUS,
    agreedPriceMinor: deal.revision.totalMinor,
    currentTotalMinor: deal.revision.totalMinor,
    currency: deal.revision.currency,
    scheduledStartAt: deal.revision.availableFrom ?? deal.serviceRequest.preferredStartAt,
  };
}
