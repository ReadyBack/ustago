import { Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound, unprocessable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type {
  Prisma,
  ServiceRequest,
  ServiceRequestStatus,
  ServiceRequestType,
} from '../generated/prisma/client.js';
import { MarketplaceEventsService } from '../analytics/marketplace-events.service.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isNowOpen } from '../providers/domain/now-availability.js';
import { isCategoryLive } from '../providers/provider.mappers.js';
import { isOpen } from './domain/service-request-lifecycle.js';

type Tx = Prisma.TransactionClient;

export const requestNotFound = () => notFound('SERVICE_REQUEST_NOT_FOUND', 'Talep bulunamadı.');

export const invalidRequestState = (status: ServiceRequestStatus, message?: string) =>
  conflict('INVALID_REQUEST_STATE', message ?? 'Talebin şu anki durumunda bu işlem yapılamaz.', {
    status,
  });

/**
 * Shared persistence for the service request aggregate: the row lock every
 * request / quote mutation takes first (one lock order, no deadlocks, and
 * cancel, accept and counter on the same request are serialised), the
 * "is this service offered here" check and publication side effects.
 */
@Injectable()
export class RequestStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: DispatchService,
    private readonly events: MarketplaceEventsService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** SELECT ... FOR UPDATE on the request row. */
  async lock(tx: Tx, requestId: string): Promise<ServiceRequest> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    if (!rows[0]) throw requestNotFound();
    return tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  /** Locks a request the caller owns; anyone else gets the same 404. */
  async lockOwned(tx: Tx, requestId: string, userId: string): Promise<ServiceRequest> {
    const request = await this.lock(tx, requestId);
    await this.assertOwner(tx, request, userId);
    return request;
  }

  async assertOwner(db: Tx, request: { customerId: string }, userId: string): Promise<void> {
    const owner = await db.customerProfile.findUnique({
      where: { id: request.customerId },
      select: { userId: true },
    });
    if (owner?.userId !== userId) throw requestNotFound();
  }

  async customerProfileId(userId: string, db: Tx = this.prisma): Promise<string> {
    const profile = await db.customerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw unprocessable('CUSTOMER_PROFILE_MISSING', 'Müşteri profili bulunamadı.');
    }
    return profile.id;
  }

  /** Open and not past its expiry; otherwise 409 with a clear code. */
  assertAcceptingQuotes(request: ServiceRequest): void {
    if (!isOpen(request.status)) throw invalidRequestState(request.status);
    if (request.expiresAt && request.expiresAt <= new Date()) {
      throw conflict('REQUEST_EXPIRED', 'Bu talebin süresi doldu.', { status: 'EXPIRED' });
    }
  }

  /**
   * Is the service offered for this address? The category (and its parent)
   * must be live, the province open, the district active, the province ×
   * category switch not off, and for NOW the category must support NOW in
   * that province.
   */
  async assertServiceAvailable(
    tx: Tx,
    type: ServiceRequestType,
    categoryId: string,
    provinceId: number,
    districtId: string,
  ): Promise<void> {
    const [category, province, district, override] = await Promise.all([
      tx.serviceCategory.findUnique({
        where: { id: categoryId },
        select: {
          isActive: true,
          supportsNow: true,
          supportsQuote: true,
          parent: { select: { isActive: true } },
        },
      }),
      tx.province.findUnique({
        where: { id: provinceId },
        select: { isActive: true, waitlistOpen: true },
      }),
      tx.district.findUnique({ where: { id: districtId }, select: { isActive: true } }),
      tx.provinceCategory.findUnique({
        where: { provinceId_categoryId: { provinceId, categoryId } },
        select: { isActive: true, nowEnabled: true },
      }),
    ]);
    if (!category || !isCategoryLive(category)) {
      throw unprocessable('CATEGORY_NOT_AVAILABLE', 'Bu kategori şu anda hizmet vermiyor.');
    }
    // Faz 7 waitlist (docs/adr/0029): a closed province with the waitlist open
    // still takes quote requests; they are dispatched once it opens.
    const waitlisted =
      province !== null && !province.isActive && province.waitlistOpen && type === 'QUOTE';
    if (
      !(province?.isActive || waitlisted) ||
      !district?.isActive ||
      (override && !override.isActive)
    ) {
      throw unprocessable(
        'SERVICE_NOT_AVAILABLE_IN_AREA',
        'UstaGO bu bölgede bu hizmeti henüz sunmuyor.',
      );
    }
    if (type === 'QUOTE' && !category.supportsQuote) {
      throw unprocessable('CATEGORY_NOT_AVAILABLE', 'Bu kategori için teklif alınamıyor.');
    }
    if (
      type === 'NOW' &&
      !isNowOpen({
        provinceActive: province.isActive,
        categoryActive: true,
        categorySupportsNow: category.supportsNow,
        override,
      })
    ) {
      throw unprocessable(
        'NOW_NOT_AVAILABLE_IN_AREA',
        'Acil Usta bu bölgede bu kategori için henüz açık değil.',
      );
    }
  }

  /** Expiry set at publication: two weeks for quotes, one hour for NOW. */
  expiryFor(type: ServiceRequestType, from: Date): Date {
    const ms =
      type === 'NOW'
        ? this.env.NOW_REQUEST_TTL_MINUTES * 60_000
        : this.env.QUOTE_REQUEST_TTL_HOURS * 3_600_000;
    return new Date(from.getTime() + ms);
  }

  /**
   * After a request goes live, in the same transaction: the first dispatch
   * wave (docs/adr/0028) writes RequestDispatch rows and outbox
   * notifications, and for NOW the emergency offers. Nothing leaves before
   * the commit; later waves come from the dispatch sweep.
   */
  async onPublished(tx: Tx, request: ServiceRequest, actorId: string): Promise<void> {
    await tx.serviceRequest.update({
      where: { id: request.id },
      data: { nextDispatchAt: new Date() },
    });
    const matched = await this.dispatch.dispatchIn(tx, request.id, 'PUBLISHED');
    await this.events.recordIn(tx, {
      type: 'request_created',
      serviceRequestId: request.id,
      categoryId: request.categoryId,
      provinceId: request.provinceId,
      districtId: request.districtId,
      metadata: { requestType: request.type },
    });
    if (request.type === 'NOW') {
      await this.audit.recordIn(tx, {
        action: 'now.request_created',
        actorId,
        entityType: 'service_request',
        entityId: request.id,
        metadata: { categoryId: request.categoryId, districtId: request.districtId },
      });
      await this.audit.recordIn(tx, {
        action: 'now.provider_matched',
        actorId,
        entityType: 'service_request',
        entityId: request.id,
        metadata: { matchedProviders: matched, wave: 1 },
      });
    }
  }
}
