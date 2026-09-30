import type { Quote, QuoteProviderCard, QuoteRevision, ServiceRequestType } from '@ustago/types';
import { MAX_QUOTE_REVISIONS } from '@ustago/validation';

import { toMoney, toMoneyOrNull } from '../common/money.js';
import type { Prisma, QuoteRevision as RevisionRow } from '../generated/prisma/client.js';
import { allowedActions, authorOf, type Party, turnOf } from './domain/quote-negotiation.js';

export function toQuoteRevision(r: RevisionRow): QuoteRevision {
  return {
    id: r.id,
    revisionNo: r.revisionNo,
    kind: r.kind,
    by: authorOf(r.kind),
    total: toMoney(r.totalMinor, r.currency),
    labor: toMoneyOrNull(r.laborMinor, r.currency),
    material: toMoneyOrNull(r.materialMinor, r.currency),
    materialsIncluded: r.materialsIncluded,
    note: r.note,
    estimatedDurationMinutes: r.estimatedDurationMinutes,
    availableFrom: r.availableFrom?.toISOString() ?? null,
    validUntil: r.validUntil?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export const quoteInclude = {
  revisions: { orderBy: { revisionNo: 'asc' } },
  job: { select: { id: true } },
  serviceRequest: { select: { type: true, status: true, expiresAt: true } },
} satisfies Prisma.QuoteInclude;

export type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

export function latestRevision(q: { revisions: RevisionRow[] }): RevisionRow {
  const latest = q.revisions.at(-1);
  if (!latest) throw new Error('A quote always has at least one revision');
  return latest;
}

function requestOpenForQuotes(r: { status: string; expiresAt: Date | null }): boolean {
  const open = r.status === 'PUBLISHED' || r.status === 'MATCHING' || r.status === 'QUOTED';
  return open && (r.expiresAt === null || r.expiresAt > new Date());
}

/** A quote thread as seen by one of its two parties. */
export function toQuote(q: QuoteRow, card: QuoteProviderCard, viewer: Party): Quote {
  const latest = latestRevision(q);
  const requestType: ServiceRequestType = q.serviceRequest.type;
  return {
    id: q.id,
    serviceRequestId: q.serviceRequestId,
    requestType,
    status: q.status,
    turn: turnOf(q.status),
    provider: card,
    latest: toQuoteRevision(latest),
    revisions: q.revisions.map(toQuoteRevision),
    acceptedRevisionId: q.acceptedRevisionId,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
    jobId: q.job?.id ?? null,
    actions: allowedActions(
      q.status,
      viewer,
      requestType,
      requestOpenForQuotes(q.serviceRequest),
      q.revisions.length,
      MAX_QUOTE_REVISIONS,
    ),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}
