import { Injectable } from '@nestjs/common';
import type { Paginated, ProviderQuoteListItem, Quote } from '@ustago/types';
import {
  type AcceptQuote,
  type CloseQuote,
  type CounterQuote,
  type CreateQuote,
  formatMoney,
  type ListProviderQuotesQuery,
  MAX_QUOTE_REVISIONS,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, forbidden, notFound, unprocessable } from '../common/http/errors.js';
import { toMinor, toMoneyOrNull } from '../common/money.js';
import {
  Prisma,
  type ProviderProfile,
  type Quote as QuoteRowBase,
  type QuoteStatus,
  type ServiceRequest,
} from '../generated/prisma/client.js';
import { JobsService } from '../jobs/jobs.service.js';
import { MatchingRepository } from '../matching/matching.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderStore } from '../providers/provider.store.js';
import { sourceStatuses, transitionFor } from '../service-requests/domain/service-request-lifecycle.js';
import { RequestStore } from '../service-requests/request.store.js';
import {
  categoryRefSelect,
  toCategoryRef,
  toLocation,
} from '../service-requests/service-request.mappers.js';
import {
  acceptAction,
  canCounter,
  counterAction,
  isQuoteOpen,
  OPEN_QUOTE_STATUSES,
  type Party,
  quoteTransition,
  revisionKindFor,
  turnOf,
} from './domain/quote-negotiation.js';
import { ProviderCardsService } from './provider-cards.service.js';
import { latestRevision, quoteInclude, toQuote, toQuoteRevision } from './quote.mappers.js';

type Tx = Prisma.TransactionClient;

const quoteNotFound = () => notFound('QUOTE_NOT_FOUND', 'Teklif bulunamadı.');
const opportunityNotFound = () =>
  notFound('OPPORTUNITY_NOT_FOUND', 'Bu iş size uygun değil veya artık açık değil.');
const providerNotActive = () =>
  forbidden(
    'PROVIDER_NOT_ACTIVE',
    'Bu özelliği kullanabilmek için usta hesabınızın onaylanması gerekiyor.',
  );
const notYourTurn = () =>
  conflict('NOT_YOUR_TURN', 'Karşı tarafın yanıtı bekleniyor.');
const quoteClosed = (status: QuoteStatus) =>
  conflict('QUOTE_CLOSED', 'Bu teklif artık açık değil.', { status });

const FILTERS: Record<NonNullable<ListProviderQuotesQuery['filter']>, QuoteStatus[]> = {
  WAITING: ['PENDING_CUSTOMER'],
  NEGOTIATING: ['PENDING_PROVIDER'],
  ACCEPTED: ['ACCEPTED'],
  CLOSED: ['REJECTED', 'WITHDRAWN', 'EXPIRED'],
};

interface Locked {
  request: ServiceRequest;
  quote: QuoteRowBase;
  party: Party;
  customerUserId: string;
  providerUserId: string;
}

/**
 * Quotes and negotiation (docs/adr/0014).
 *
 * Concurrency: every mutation locks the service request row first, then
 * the quote row (one lock order everywhere, so no deadlocks). That
 * serialises counter vs accept, accept vs accept of two different quotes,
 * and accept vs cancel. On top of the locks, state changes are conditional
 * updates and the database refuses a second accepted quote, a second job
 * for one request, and a duplicate quote per provider (unique indexes).
 * "The UI prevents it" is never relied on.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestStore,
    private readonly providers: ProviderStore,
    private readonly matching: MatchingRepository,
    private readonly jobs: JobsService,
    private readonly cards: ProviderCardsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Provider: first offer
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    requestId: string,
    input: CreateQuote,
    ipAddress: string | null,
  ): Promise<Quote> {
    const profile = await this.providers.findByUserId(user.id);
    if (profile.status !== 'ACTIVE') throw providerNotActive();
    if (input.validUntil && new Date(input.validUntil) <= new Date()) {
      throw unprocessable('INVALID_VALID_UNTIL', 'Geçerlilik tarihi gelecekte olmalı.');
    }

    let quoteId: string;
    try {
      quoteId = await this.prisma.$transaction(async (tx) => {
        const request = await this.requests.lock(tx, requestId);
        const provider = await tx.providerProfile.findUniqueOrThrow({ where: { id: profile.id } });
        if (provider.status !== 'ACTIVE') throw providerNotActive();
        // The same predicate as the opportunity feed: a provider cannot
        // quote on a request they could not see by guessing its id.
        if (!(await this.matching.isEligible(tx, provider.id, requestId))) {
          const existing = await tx.quote.findUnique({
            where: {
              serviceRequestId_providerId: { serviceRequestId: requestId, providerId: provider.id },
            },
          });
          if (existing) throw quoteExists(existing.id);
          throw opportunityNotFound();
        }
        this.requests.assertAcceptingQuotes(request);

        const quote = await tx.quote.create({
          data: {
            serviceRequestId: requestId,
            providerId: provider.id,
            status: 'PENDING_CUSTOMER',
            currency: request.currency,
          },
        });
        await tx.quoteRevision.create({
          data: {
            quoteId: quote.id,
            revisionNo: 1,
            kind: 'OFFER',
            authorUserId: user.id,
            totalMinor: toMinor(input.totalMinor),
            laborMinor: nullableMinor(input.laborMinor),
            materialMinor: nullableMinor(input.materialMinor),
            materialsIncluded: input.materialsIncluded ?? null,
            currency: request.currency,
            note: input.note ?? null,
            estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
            availableFrom: toDate(input.availableFrom),
            validUntil: toDate(input.validUntil),
          },
        });
        const to = transitionFor(request.status, 'QUOTE_RECEIVED', request.type);
        if (to && to !== request.status) {
          await tx.serviceRequest.update({
            where: { id: requestId, status: { in: [...sourceStatuses('QUOTE_RECEIVED')] } },
            data: { status: to, version: { increment: 1 } },
          });
        }
        if (request.type === 'NOW') {
          await tx.emergencyDispatchOffer.upsert({
            where: {
              serviceRequestId_providerId: { serviceRequestId: requestId, providerId: provider.id },
            },
            create: {
              serviceRequestId: requestId,
              providerId: provider.id,
              status: 'ACCEPTED',
              respondedAt: new Date(),
              expiresAt: request.expiresAt ?? new Date(),
            },
            update: { status: 'ACCEPTED', respondedAt: new Date() },
          });
        }
        await this.audit.recordIn(tx, {
          action: 'quote.created',
          actorId: user.id,
          entityType: 'quote',
          entityId: quote.id,
          ipAddress,
          metadata: {
            serviceRequestId: requestId,
            requestType: request.type,
            revisionNo: 1,
            totalMinor: input.totalMinor,
            // Kept for pricing analytics: how far quotes land from budgets.
            budgetMinor: request.budgetMinor === null ? null : Number(request.budgetMinor),
          },
        });
        const customer = await this.customerUserId(tx, request.customerId);
        await this.notifications.enqueueIn(tx, [
          {
            userId: customer,
            type: 'quote.created',
            title: request.type === 'NOW' ? 'Acil talebinize usta bulundu' : 'Yeni teklif geldi',
            body: `${provider.displayName}: ${formatMoney(input.totalMinor)} · ${request.title}`,
            data: { quoteId: quote.id, serviceRequestId: requestId },
          },
        ]);
        return quote.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.quote.findUnique({
          where: {
            serviceRequestId_providerId: { serviceRequestId: requestId, providerId: profile.id },
          },
        });
        throw quoteExists(existing?.id ?? null);
      }
      throw error;
    }
    return this.get(user, quoteId);
  }

  // -------------------------------------------------------------------------
  // Either party: counter, accept
  // -------------------------------------------------------------------------

  async counter(
    user: AuthUser,
    quoteId: string,
    input: CounterQuote,
    ipAddress: string | null,
  ): Promise<Quote> {
    await this.prisma.$transaction(async (tx) => {
      const { request, quote, party, customerUserId, providerUserId } = await this.lockForParty(
        tx,
        quoteId,
        user.id,
      );
      this.requests.assertAcceptingQuotes(request);
      if (party === 'PROVIDER') await this.assertProviderActive(tx, quote.providerId);
      if (!canCounter(request.type)) {
        throw conflict(
          'COUNTER_NOT_ALLOWED',
          'Acil (NOW) işlerde karşı teklif yok: teklifi kabul edin veya reddedin.',
        );
      }
      const action = counterAction(party);
      const to = quoteTransition(quote.status, action);
      if (!to) throw turnOf(quote.status) === null ? quoteClosed(quote.status) : notYourTurn();
      const revisions = await tx.quoteRevision.findMany({
        where: { quoteId },
        orderBy: { revisionNo: 'asc' },
      });
      const latest = latestRevision({ revisions });
      assertRevision(latest.revisionNo, input.expectedRevisionNo);
      if (revisions.length >= MAX_QUOTE_REVISIONS) {
        throw unprocessable(
          'NEGOTIATION_LIMIT_REACHED',
          'Pazarlık sınırına ulaşıldı. Son teklifi kabul edin veya reddedin.',
          { maxRevisions: MAX_QUOTE_REVISIONS },
        );
      }
      if (toMinor(input.totalMinor) === latest.totalMinor) {
        throw unprocessable(
          'COUNTER_SAME_PRICE',
          'Karşı teklif son fiyatla aynı. Aynı fiyatta anlaşmak için teklifi kabul edin.',
        );
      }

      await this.moveQuote(tx, quote, to);
      const revisionNo = latest.revisionNo + 1;
      await tx.quoteRevision.create({
        data: {
          quoteId,
          revisionNo,
          kind: revisionKindFor(action),
          authorUserId: user.id,
          totalMinor: toMinor(input.totalMinor),
          currency: quote.currency,
          note: input.note ?? null,
          // A provider's counter keeps the work details of their offer.
          ...(party === 'PROVIDER'
            ? {
                materialsIncluded: latest.materialsIncluded,
                estimatedDurationMinutes: latest.estimatedDurationMinutes,
                availableFrom: latest.availableFrom,
              }
            : {}),
        },
      });
      await this.audit.recordIn(tx, {
        action: 'quote.countered',
        actorId: user.id,
        entityType: 'quote',
        entityId: quoteId,
        ipAddress,
        metadata: { party, revisionNo, totalMinor: input.totalMinor },
      });
      await this.notifications.enqueueIn(tx, [
        {
          userId: party === 'CUSTOMER' ? providerUserId : customerUserId,
          type: 'quote.countered',
          title: 'Karşı teklif geldi',
          body: `${formatMoney(input.totalMinor)} · ${request.title}`,
          data: { quoteId, serviceRequestId: request.id },
        },
      ]);
    });
    return this.get(user, quoteId);
  }

  /**
   * Accepts the other side's latest price. In one transaction: the quote
   * becomes ACCEPTED with its accepted revision, every other open quote on
   * the request is REJECTED, the request becomes MATCHED and the job is
   * created with AGREED_PRICE = the accepted revision's total.
   */
  async accept(
    user: AuthUser,
    quoteId: string,
    input: AcceptQuote,
    ipAddress: string | null,
  ): Promise<Quote> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const { request, quote, party, customerUserId, providerUserId } =
          await this.lockForParty(tx, quoteId, user.id);
        if (request.status === 'MATCHED') {
          throw conflict('REQUEST_ALREADY_AGREED', 'Bu talep için zaten anlaşma sağlandı.');
        }
        this.requests.assertAcceptingQuotes(request);
        const to = quoteTransition(quote.status, acceptAction(party));
        if (!to) throw turnOf(quote.status) === null ? quoteClosed(quote.status) : notYourTurn();
        // Whoever accepts, the provider doing the job must still be approved.
        await this.assertProviderActive(tx, quote.providerId);
        const latest = await tx.quoteRevision.findFirstOrThrow({
          where: { quoteId },
          orderBy: { revisionNo: 'desc' },
        });
        assertRevision(latest.revisionNo, input.expectedRevisionNo);
        if (latest.validUntil && latest.validUntil <= new Date()) {
          throw conflict('QUOTE_EXPIRED', 'Bu teklifin geçerlilik süresi doldu.');
        }

        const now = new Date();
        const accepted = await tx.quote.updateMany({
          where: { id: quoteId, status: quote.status, version: quote.version },
          data: {
            status: to,
            acceptedRevisionId: latest.id,
            acceptedAt: now,
            version: { increment: 1 },
          },
        });
        if (accepted.count === 0) throw quoteChanged();

        const others = await tx.quote.findMany({
          where: {
            serviceRequestId: request.id,
            id: { not: quoteId },
            status: { in: [...OPEN_QUOTE_STATUSES] },
          },
          select: { id: true, provider: { select: { userId: true } } },
        });
        if (others.length > 0) {
          await tx.quote.updateMany({
            where: { id: { in: others.map((o) => o.id) } },
            data: { status: 'REJECTED', version: { increment: 1 } },
          });
        }

        const matched = transitionFor(request.status, 'QUOTE_ACCEPTED', request.type);
        if (!matched) throw conflict('INVALID_REQUEST_STATE', 'Talep artık açık değil.');
        const moved = await tx.serviceRequest.updateMany({
          where: {
            id: request.id,
            status: { in: [...sourceStatuses('QUOTE_ACCEPTED')] },
            version: request.version,
          },
          data: { status: matched, version: { increment: 1 } },
        });
        if (moved.count === 0) {
          throw conflict('REQUEST_ALREADY_AGREED', 'Bu talep için zaten anlaşma sağlandı.');
        }

        const job = await this.jobs.createIn(
          tx,
          {
            serviceRequest: request,
            quote: { id: quote.id, providerId: quote.providerId },
            revision: latest,
          },
          user.id,
        );
        if (request.type === 'NOW') {
          await tx.emergencyDispatchOffer.updateMany({
            where: { serviceRequestId: request.id, providerId: { not: quote.providerId } },
            data: { status: 'SUPERSEDED' },
          });
        }

        await this.audit.recordIn(tx, {
          action: 'quote.accepted',
          actorId: user.id,
          entityType: 'quote',
          entityId: quoteId,
          ipAddress,
          metadata: {
            party,
            serviceRequestId: request.id,
            acceptedRevisionNo: latest.revisionNo,
            agreedPriceMinor: Number(latest.totalMinor),
            otherQuotesRejected: others.length,
          },
        });
        if (others.length > 0) {
          await this.audit.recordIn(tx, {
            action: 'quote.rejected',
            actorId: user.id,
            entityType: 'service_request',
            entityId: request.id,
            ipAddress,
            metadata: { reason: 'other_quote_accepted', quoteIds: others.map((o) => o.id) },
          });
        }
        await this.audit.recordIn(tx, {
          action: 'job.created',
          actorId: user.id,
          entityType: 'job',
          entityId: job.id,
          ipAddress,
          metadata: {
            serviceRequestId: request.id,
            quoteId,
            agreedPriceMinor: Number(job.agreedPriceMinor),
            currency: job.currency,
          },
        });

        const price = formatMoney(Number(latest.totalMinor));
        await this.notifications.enqueueIn(tx, [
          {
            userId: party === 'CUSTOMER' ? providerUserId : customerUserId,
            type: 'quote.accepted',
            title: 'Anlaşma sağlandı',
            body: `${request.title} · ${price}`,
            data: { quoteId, jobId: job.id, serviceRequestId: request.id },
          },
          ...others.map((o) => ({
            userId: o.provider.userId,
            type: 'quote.rejected',
            title: 'Teklifiniz seçilmedi',
            body: `Müşteri "${request.title}" için başka bir teklifi kabul etti.`,
            data: { quoteId: o.id, serviceRequestId: request.id },
          })),
        ]);
      });
    } catch (error) {
      // Unique indexes (one accepted quote, one job per request) are the
      // last line of defence if two accepts ever got past the lock.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('REQUEST_ALREADY_AGREED', 'Bu talep için zaten anlaşma sağlandı.');
      }
      throw error;
    }
    return this.get(user, quoteId);
  }

  // -------------------------------------------------------------------------
  // Closing a thread without agreement
  // -------------------------------------------------------------------------

  async reject(
    user: AuthUser,
    quoteId: string,
    input: CloseQuote,
    ipAddress: string | null,
  ): Promise<Quote> {
    return this.close(user, quoteId, 'CUSTOMER', input, ipAddress);
  }

  async withdraw(
    user: AuthUser,
    quoteId: string,
    input: CloseQuote,
    ipAddress: string | null,
  ): Promise<Quote> {
    return this.close(user, quoteId, 'PROVIDER', input, ipAddress);
  }

  private async close(
    user: AuthUser,
    quoteId: string,
    as: Party,
    input: CloseQuote,
    ipAddress: string | null,
  ): Promise<Quote> {
    await this.prisma.$transaction(async (tx) => {
      const { request, quote, party, customerUserId, providerUserId } = await this.lockForParty(
        tx,
        quoteId,
        user.id,
      );
      if (party !== as) {
        throw forbidden(
          'QUOTE_ACTION_FORBIDDEN',
          as === 'CUSTOMER'
            ? 'Teklifi yalnızca müşteri reddedebilir.'
            : 'Teklifi yalnızca usta geri çekebilir.',
        );
      }
      const action = as === 'CUSTOMER' ? 'CUSTOMER_REJECT' : 'PROVIDER_WITHDRAW';
      const to = quoteTransition(quote.status, action);
      if (!to) throw quoteClosed(quote.status);
      await this.moveQuote(tx, quote, to);

      const stillOpen = await tx.quote.count({
        where: { serviceRequestId: request.id, status: { in: [...OPEN_QUOTE_STATUSES] } },
      });
      if (stillOpen === 0) {
        const back = transitionFor(request.status, 'LAST_QUOTE_CLOSED', request.type);
        if (back) {
          await tx.serviceRequest.update({
            where: { id: request.id, status: { in: [...sourceStatuses('LAST_QUOTE_CLOSED')] } },
            data: { status: back, version: { increment: 1 } },
          });
        }
      }
      await this.audit.recordIn(tx, {
        action: as === 'CUSTOMER' ? 'quote.rejected' : 'quote.withdrawn',
        actorId: user.id,
        entityType: 'quote',
        entityId: quoteId,
        ipAddress,
        metadata: { serviceRequestId: request.id, hasReason: input.reason !== undefined },
      });
      await this.notifications.enqueueIn(tx, [
        {
          userId: as === 'CUSTOMER' ? providerUserId : customerUserId,
          type: as === 'CUSTOMER' ? 'quote.rejected' : 'quote.withdrawn',
          title: as === 'CUSTOMER' ? 'Teklifiniz reddedildi' : 'Usta teklifini geri çekti',
          body: request.title,
          data: { quoteId, serviceRequestId: request.id },
        },
      ]);
    });
    return this.get(user, quoteId);
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** One thread, for its customer or its provider only (others: 404). */
  async get(user: AuthUser, quoteId: string): Promise<Quote> {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        ...quoteInclude,
        provider: { select: { userId: true } },
        serviceRequest: {
          select: {
            type: true,
            status: true,
            expiresAt: true,
            customer: { select: { userId: true } },
          },
        },
      },
    });
    if (!quote) throw quoteNotFound();
    const party: Party | null =
      quote.serviceRequest.customer.userId === user.id
        ? 'CUSTOMER'
        : quote.provider.userId === user.id
          ? 'PROVIDER'
          : null;
    if (!party) throw quoteNotFound();
    return toQuote(quote, await this.cards.card(quote.providerId), party);
  }

  /** "Gelen Teklifler": every quote on the customer's own request. */
  async listForRequest(user: AuthUser, requestId: string): Promise<Quote[]> {
    const request = await this.prisma.serviceRequest.findFirst({
      where: { id: requestId, customer: { userId: user.id } },
      select: { id: true },
    });
    if (!request) throw notFound('SERVICE_REQUEST_NOT_FOUND', 'Talep bulunamadı.');
    const quotes = await this.prisma.quote.findMany({
      where: { serviceRequestId: requestId },
      include: quoteInclude,
      orderBy: { id: 'asc' },
    });
    const cards = await this.cards.cards(quotes.map((q) => q.providerId));
    const rank = (s: QuoteStatus) => (s === 'ACCEPTED' ? 0 : isQuoteOpen(s) ? 1 : 2);
    return quotes
      .sort((a, b) => rank(a.status) - rank(b.status))
      .map((q) => {
        const card = cards.get(q.providerId);
        if (!card) throw new Error('Provider card missing');
        return toQuote(q, card, 'CUSTOMER');
      });
  }

  /** "Tekliflerim": the provider's own threads, never anyone else's. */
  async listMine(
    user: AuthUser,
    query: ListProviderQuotesQuery,
  ): Promise<Paginated<ProviderQuoteListItem>> {
    const profile = await this.providers.findByUserId(user.id);
    const rows = await this.prisma.quote.findMany({
      where: {
        providerId: profile.id,
        ...(query.filter ? { status: { in: FILTERS[query.filter] } } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: {
        revisions: { orderBy: { revisionNo: 'asc' } },
        job: { select: { id: true } },
        serviceRequest: {
          select: {
            id: true,
            type: true,
            status: true,
            title: true,
            budgetMinor: true,
            currency: true,
            category: { select: categoryRefSelect },
            province: { select: { id: true, name: true } },
            district: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((q) => ({
        id: q.id,
        status: q.status,
        turn: turnOf(q.status),
        latest: toQuoteRevision(latestRevision(q)),
        revisionCount: q.revisions.length,
        request: {
          id: q.serviceRequest.id,
          type: q.serviceRequest.type,
          status: q.serviceRequest.status,
          title: q.serviceRequest.title,
          category: toCategoryRef(q.serviceRequest.category),
          location: toLocation(q.serviceRequest),
          budget: toMoneyOrNull(q.serviceRequest.budgetMinor, q.serviceRequest.currency),
        },
        jobId: q.job?.id ?? null,
        updatedAt: q.updatedAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Locks request then quote and works out which side the caller is on.
   * A caller who is neither gets 404, exactly like a missing quote: other
   * providers cannot probe or touch someone else's negotiation.
   */
  private async lockForParty(tx: Tx, quoteId: string, userId: string): Promise<Locked> {
    const ref = await tx.quote.findUnique({
      where: { id: quoteId },
      select: { serviceRequestId: true },
    });
    if (!ref) throw quoteNotFound();
    const request = await this.requests.lock(tx, ref.serviceRequestId);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM quotes WHERE id = ${quoteId}::uuid FOR UPDATE`;
    if (!rows[0]) throw quoteNotFound();
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const [customerUserId, provider] = await Promise.all([
      this.customerUserId(tx, request.customerId),
      tx.providerProfile.findUniqueOrThrow({
        where: { id: quote.providerId },
        select: { userId: true },
      }),
    ]);
    const party: Party | null =
      customerUserId === userId ? 'CUSTOMER' : provider.userId === userId ? 'PROVIDER' : null;
    if (!party) throw quoteNotFound();
    return { request, quote, party, customerUserId, providerUserId: provider.userId };
  }

  private async moveQuote(tx: Tx, quote: QuoteRowBase, to: QuoteStatus): Promise<void> {
    const moved = await tx.quote.updateMany({
      where: { id: quote.id, status: quote.status, version: quote.version },
      data: { status: to, version: { increment: 1 } },
    });
    if (moved.count === 0) throw quoteChanged();
  }

  private async assertProviderActive(tx: Tx, providerId: string): Promise<ProviderProfile> {
    const provider = await tx.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    if (provider.status !== 'ACTIVE' || provider.deletedAt !== null) {
      throw conflict('PROVIDER_NOT_ACTIVE', 'Bu ustanın hesabı şu anda aktif değil.');
    }
    return provider;
  }

  private async customerUserId(tx: Tx, customerId: string): Promise<string> {
    const customer = await tx.customerProfile.findUniqueOrThrow({
      where: { id: customerId },
      select: { userId: true },
    });
    return customer.userId;
  }
}

function assertRevision(latest: number, expected: number): void {
  if (latest !== expected) {
    throw conflict(
      'QUOTE_REVISION_STALE',
      'Teklif siz bakarken değişti. Lütfen güncel fiyatı görüp tekrar deneyin.',
      { latestRevisionNo: latest },
    );
  }
}

const quoteChanged = () =>
  conflict('QUOTE_CHANGED', 'Teklif aynı anda değişti. Lütfen yenileyip tekrar deneyin.');

const quoteExists = (quoteId: string | null) =>
  conflict(
    'QUOTE_ALREADY_EXISTS',
    'Bu talebe zaten teklif verdiniz. Mevcut teklif üzerinden devam edin.',
    quoteId ? { quoteId } : undefined,
  );

function nullableMinor(value: number | null | undefined): bigint | null {
  return value === null || value === undefined ? null : toMinor(value);
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}
