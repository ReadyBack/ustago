import { Injectable } from '@nestjs/common';
import type { Paginated, ServiceRequest, ServiceRequestListItem } from '@ustago/types';
import type {
  CancelServiceRequest,
  CreateServiceRequest,
  ListMyServiceRequestsQuery,
  UpdateServiceRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, unprocessable } from '../common/http/errors.js';
import { toMinor } from '../common/money.js';
import { Prisma, type ServiceRequestStatus } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { OPEN_QUOTE_STATUSES } from '../quotes/domain/quote-negotiation.js';
import {
  type EditableField,
  editableFields,
  forbiddenEdits,
  OPEN_STATUSES,
  sourceStatuses,
  transitionFor,
} from './domain/service-request-lifecycle.js';
import { RequestPhotosService } from './request-photos.service.js';
import { invalidRequestState, requestNotFound, RequestStore } from './request.store.js';
import {
  customerRequestInclude,
  listRequestInclude,
  toServiceRequest,
  toServiceRequestListItem,
} from './service-request.mappers.js';

type Tx = Prisma.TransactionClient;

/** Generous for a real household, tight enough to stop request spam. */
const REQUESTS_PER_HOUR = 20;

const GROUPS: Record<'OPEN' | 'AGREED' | 'CLOSED', ServiceRequestStatus[]> = {
  OPEN: ['DRAFT', ...OPEN_STATUSES],
  AGREED: ['MATCHED'],
  CLOSED: ['COMPLETED', 'CANCELLED', 'EXPIRED'],
};

/**
 * Customer side of service requests (docs/adr/0014): create (optionally as
 * a draft), edit within the lifecycle's rules, publish, cancel, list.
 * Every mutation locks the request row first (RequestStore.lock).
 */
@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: RequestStore,
    private readonly photos: RequestPhotosService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async create(
    user: AuthUser,
    input: CreateServiceRequest,
    ipAddress: string | null,
  ): Promise<ServiceRequest> {
    const customerId = await this.store.customerProfileId(user.id);
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(customerId, input.idempotencyKey);
      if (existing) return existing;
    }
    await this.rateLimit.enforce({
      bucket: 'service-request:create',
      subject: user.id,
      limit: REQUESTS_PER_HOUR,
      windowSeconds: 3600,
    });
    const photos = await this.photos.inspect(user.id, input.photoUploadIds);

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const address = await tx.address.findFirst({
          where: { id: input.addressId, userId: user.id, deletedAt: null },
          select: { id: true, provinceId: true, districtId: true },
        });
        if (!address) throw unprocessable('ADDRESS_NOT_FOUND', 'Adres bulunamadı.');
        await this.store.assertServiceAvailable(
          tx,
          input.type,
          input.categoryId,
          address.provinceId,
          address.districtId,
        );

        const now = new Date();
        const status = input.publish
          ? (transitionFor('DRAFT', 'PUBLISH', input.type) ?? 'DRAFT')
          : 'DRAFT';
        const request = await tx.serviceRequest.create({
          data: {
            customerId,
            categoryId: input.categoryId,
            addressId: address.id,
            provinceId: address.provinceId,
            districtId: address.districtId,
            type: input.type,
            status,
            title: input.title,
            description: input.description,
            budgetMinor: input.budgetMinor === null ? null : toMinor(input.budgetMinor),
            currency: 'TRY',
            preferredStartAt: toDate(input.preferredStartAt),
            preferredEndAt: toDate(input.preferredEndAt),
            idempotencyKey: input.idempotencyKey ?? null,
            ...(input.publish
              ? { publishedAt: now, expiresAt: this.store.expiryFor(input.type, now) }
              : {}),
          },
        });
        await this.photos.attachIn(tx, request.id, photos, 0);
        // The description can hold personal details: never copied to audit.
        await this.audit.recordIn(tx, {
          action: 'service_request.created',
          actorId: user.id,
          entityType: 'service_request',
          entityId: request.id,
          ipAddress,
          metadata: {
            type: request.type,
            status: request.status,
            categoryId: request.categoryId,
            provinceId: request.provinceId,
            districtId: request.districtId,
            hasBudget: request.budgetMinor !== null,
            photoCount: photos.length,
          },
        });
        if (input.publish) await this.store.onPublished(tx, request, user.id);
        return request.id;
      });
      return this.view(id);
    } catch (error) {
      // Two identical "create" calls raced past the pre-check: return the winner.
      if (
        input.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByIdempotencyKey(customerId, input.idempotencyKey);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async get(userId: string, id: string): Promise<ServiceRequest> {
    const row = await this.prisma.serviceRequest.findFirst({
      where: { id, customer: { userId } },
      include: customerRequestInclude,
    });
    if (!row) throw requestNotFound();
    return toServiceRequest(row);
  }

  async listMine(
    userId: string,
    query: ListMyServiceRequestsQuery,
  ): Promise<Paginated<ServiceRequestListItem>> {
    const statuses = query.status ? [query.status] : query.group ? GROUPS[query.group] : undefined;
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        customer: { userId },
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: listRequestInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toServiceRequestListItem),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdateServiceRequest,
    ipAddress: string | null,
  ): Promise<ServiceRequest> {
    await this.prisma.$transaction(async (tx) => {
      const request = await this.store.lockOwned(tx, id, user.id);
      const quoteCount = await tx.quote.count({ where: { serviceRequestId: id } });
      const fields = Object.keys(input) as EditableField[];
      if (editableFields(request.status, quoteCount > 0).length === 0) {
        throw invalidRequestState(request.status);
      }
      const forbidden = forbiddenEdits(request.status, quoteCount > 0, fields);
      if (forbidden.length > 0) {
        throw conflict(
          'REQUEST_FIELD_LOCKED',
          quoteCount > 0
            ? 'Teklif geldikten sonra kategori ve adres değiştirilemez.'
            : 'Talebin şu anki durumunda bu alanlar değiştirilemez.',
          { fields: forbidden, status: request.status },
        );
      }

      let location: { addressId: string; provinceId: number; districtId: string } | undefined;
      if (input.addressId !== undefined) {
        const address = await tx.address.findFirst({
          where: { id: input.addressId, userId: user.id, deletedAt: null },
          select: { id: true, provinceId: true, districtId: true },
        });
        if (!address) throw unprocessable('ADDRESS_NOT_FOUND', 'Adres bulunamadı.');
        location = {
          addressId: address.id,
          provinceId: address.provinceId,
          districtId: address.districtId,
        };
      }
      if (input.categoryId !== undefined || location) {
        await this.store.assertServiceAvailable(
          tx,
          request.type,
          input.categoryId ?? request.categoryId,
          location?.provinceId ?? request.provinceId,
          location?.districtId ?? request.districtId,
        );
      }
      const start =
        input.preferredStartAt !== undefined
          ? toDate(input.preferredStartAt)
          : request.preferredStartAt;
      const end =
        input.preferredEndAt !== undefined ? toDate(input.preferredEndAt) : request.preferredEndAt;
      if (start && end && end < start) {
        throw unprocessable('INVALID_TIME_WINDOW', 'Bitiş zamanı başlangıçtan önce olamaz.');
      }

      await tx.serviceRequest.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.budgetMinor !== undefined
            ? { budgetMinor: input.budgetMinor === null ? null : toMinor(input.budgetMinor) }
            : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(location ?? {}),
          preferredStartAt: start,
          preferredEndAt: end,
          version: { increment: 1 },
        },
      });
      await this.audit.recordIn(tx, {
        action: 'service_request.updated',
        actorId: user.id,
        entityType: 'service_request',
        entityId: id,
        ipAddress,
        metadata: { fields },
      });
    });
    return this.get(user.id, id);
  }

  /**
   * DRAFT → PUBLISHED / MATCHING. Idempotent: publishing an already
   * published request returns it unchanged, and concurrent calls publish
   * (and notify providers) exactly once thanks to the row lock.
   */
  async publish(user: AuthUser, id: string, ipAddress: string | null): Promise<ServiceRequest> {
    await this.prisma.$transaction(async (tx) => {
      const request = await this.store.lockOwned(tx, id, user.id);
      if (request.status !== 'DRAFT') {
        if (request.publishedAt) return;
        throw invalidRequestState(request.status);
      }
      await this.store.assertServiceAvailable(
        tx,
        request.type,
        request.categoryId,
        request.provinceId,
        request.districtId,
      );
      const to = transitionFor(request.status, 'PUBLISH', request.type);
      if (!to) throw invalidRequestState(request.status);
      const now = new Date();
      const published = await tx.serviceRequest.update({
        where: { id, status: { in: [...sourceStatuses('PUBLISH')] } },
        data: {
          status: to,
          publishedAt: now,
          expiresAt: this.store.expiryFor(request.type, now),
          version: { increment: 1 },
        },
      });
      await this.audit.recordIn(tx, {
        action: 'service_request.published',
        actorId: user.id,
        entityType: 'service_request',
        entityId: id,
        ipAddress,
        metadata: { type: request.type },
      });
      await this.store.onPublished(tx, published, user.id);
    });
    return this.get(user.id, id);
  }

  /**
   * Open request → CANCELLED. Open quotes expire and their providers are
   * told. Serialised with accept by the request lock: whichever comes
   * second gets 409.
   */
  async cancel(
    user: AuthUser,
    id: string,
    input: CancelServiceRequest,
    ipAddress: string | null,
  ): Promise<ServiceRequest> {
    await this.prisma.$transaction(async (tx) => {
      const request = await this.store.lockOwned(tx, id, user.id);
      const to = transitionFor(request.status, 'CANCEL', request.type);
      if (!to) {
        throw invalidRequestState(
          request.status,
          request.status === 'MATCHED'
            ? 'Anlaşma sağlanmış bir talep bu ekrandan iptal edilemez.'
            : undefined,
        );
      }
      await tx.serviceRequest.update({
        where: { id, status: { in: [...sourceStatuses('CANCEL')] } },
        data: {
          status: to,
          cancelledAt: new Date(),
          cancelReason: input.reason ?? null,
          version: { increment: 1 },
        },
      });
      await this.closeOpenQuotes(tx, id, 'EXPIRED', 'service_request.cancelled');
      await tx.emergencyDispatchOffer.updateMany({
        where: { serviceRequestId: id, status: { in: ['SENT', 'SEEN'] } },
        data: { status: 'SUPERSEDED' },
      });
      await this.audit.recordIn(tx, {
        action: 'service_request.cancelled',
        actorId: user.id,
        entityType: 'service_request',
        entityId: id,
        ipAddress,
        metadata: { from: request.status, hasReason: input.reason !== undefined },
      });
    });
    return this.get(user.id, id);
  }

  private async closeOpenQuotes(
    tx: Tx,
    requestId: string,
    status: 'EXPIRED',
    reason: string,
  ): Promise<void> {
    const open = await tx.quote.findMany({
      where: { serviceRequestId: requestId, status: { in: [...OPEN_QUOTE_STATUSES] } },
      select: {
        id: true,
        provider: { select: { userId: true } },
        serviceRequest: { select: { title: true } },
      },
    });
    if (open.length === 0) return;
    await tx.quote.updateMany({
      where: { id: { in: open.map((q) => q.id) } },
      data: { status, version: { increment: 1 } },
    });
    await this.notifications.enqueueIn(
      tx,
      open.map((q) => ({
        userId: q.provider.userId,
        type: reason,
        title: 'Talep iptal edildi',
        body: `Müşteri "${q.serviceRequest.title}" talebini iptal etti.`,
        data: { quoteId: q.id, serviceRequestId: requestId },
      })),
    );
  }

  private async findByIdempotencyKey(
    customerId: string,
    idempotencyKey: string,
  ): Promise<ServiceRequest | null> {
    const row = await this.prisma.serviceRequest.findUnique({
      where: { customerId_idempotencyKey: { customerId, idempotencyKey } },
      include: customerRequestInclude,
    });
    return row ? toServiceRequest(row) : null;
  }

  private async view(id: string): Promise<ServiceRequest> {
    const row = await this.prisma.serviceRequest.findUniqueOrThrow({
      where: { id },
      include: customerRequestInclude,
    });
    return toServiceRequest(row);
  }
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}
