import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminProviderDetail,
  AdminProviderListItem,
  AdminProviderVerification,
  Paginated,
  ProviderProfile,
  SignedUrl,
} from '@ustago/types';
import type { ListAdminProvidersQuery, ListAdminVerificationsQuery } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import {
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
  unprocessable,
} from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type {
  Prisma,
  ProviderStatus,
  TrustEventType,
  VerificationType,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeOnboarding, missingApprovals } from '../providers/domain/onboarding.js';
import {
  type ProviderEvent,
  sourceStatuses,
  transitionFor,
} from '../providers/domain/provider-lifecycle.js';
import {
  adminVerificationInclude,
  catalogInclude,
  toAdminVerification,
  toProviderProfile,
  toServiceAreaGroups,
  toServiceItems,
} from '../providers/provider.mappers.js';
import { invalidProviderState, ProviderStore } from '../providers/provider.store.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageUnavailableError,
} from '../storage/object-storage.js';

const verificationNotFound = () =>
  notFound('VERIFICATION_NOT_FOUND', 'Doğrulama kaydı bulunamadı.');
const providerNotFound = () => notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');

/** Trust signal recorded when an admin approves a document. */
const TRUST_EVENT_FOR: Partial<Record<VerificationType, TrustEventType>> = {
  IDENTITY: 'IDENTITY_VERIFIED',
  PROFESSIONAL_CERTIFICATE: 'CERTIFICATE_VERIFIED',
};

/**
 * Back-office review of provider applications and documents. Every
 * decision is a conditional update (first reviewer wins), recorded with
 * reviewer and time, and audited. Staff cannot review their own profile.
 */
@Injectable()
export class AdminProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * The review queue. PENDING_REVIEW is served oldest submission first
   * (fair FIFO); other filters newest first. Cursor = last item's id.
   */
  async list(query: ListAdminProvidersQuery): Promise<Paginated<AdminProviderListItem>> {
    const orderBy: Prisma.ProviderProfileOrderByWithRelationInput[] =
      query.status === 'PENDING_REVIEW'
        ? [{ submittedAt: 'asc' }, { id: 'asc' }]
        : [{ id: 'desc' }];
    const rows = await this.prisma.providerProfile.findMany({
      where: { deletedAt: null, status: query.status },
      orderBy,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        user: { select: { firstName: true, lastName: true } },
        _count: { select: { verifications: { where: { status: 'PENDING' } } } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((p) => ({
        id: p.id,
        userId: p.userId,
        displayName: p.displayName,
        type: p.type,
        status: p.status,
        submittedAt: p.submittedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        contactName: `${p.user.firstName} ${p.user.lastName}`.trim(),
        pendingVerifications: p._count.verifications,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async detail(providerId: string): Promise<AdminProviderDetail> {
    const p = await this.prisma.providerProfile.findFirst({
      where: { id: providerId, deletedAt: null },
      include: {
        ...catalogInclude,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            phoneVerifiedAt: true,
          },
        },
        verifications: { include: adminVerificationInclude, orderBy: { submittedAt: 'desc' } },
      },
    });
    if (!p) throw providerNotFound();
    const onboarding = computeOnboarding(await this.store.snapshot(p));
    return {
      id: p.id,
      userId: p.userId,
      displayName: p.displayName,
      type: p.type,
      status: p.status,
      statusReason: p.statusReason,
      bio: p.bio,
      yearsOfExperience: p.yearsOfExperience,
      nowEnabled: p.nowEnabled,
      isAvailableNow: p.isAvailableNow,
      submittedAt: p.submittedAt?.toISOString() ?? null,
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      approvedAt: p.approvedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      contact: {
        firstName: p.user.firstName,
        lastName: p.user.lastName,
        email: p.user.email,
        phone: p.user.phone,
        phoneVerifiedAt: p.user.phoneVerifiedAt?.toISOString() ?? null,
      },
      services: toServiceItems(p.services),
      serviceAreas: toServiceAreaGroups(p.serviceAreas),
      verifications: p.verifications.map(toAdminVerification),
      onboarding,
    };
  }

  async verificationsOf(providerId: string): Promise<AdminProviderVerification[]> {
    if (
      !(await this.prisma.providerProfile.findFirst({ where: { id: providerId, deletedAt: null } }))
    ) {
      throw providerNotFound();
    }
    const rows = await this.prisma.providerVerification.findMany({
      where: { providerId },
      include: adminVerificationInclude,
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toAdminVerification);
  }

  /** Document queue across providers, oldest first for PENDING. */
  async verificationQueue(
    query: ListAdminVerificationsQuery,
  ): Promise<Paginated<AdminProviderVerification>> {
    const rows = await this.prisma.providerVerification.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy:
        query.status === 'PENDING' ? [{ submittedAt: 'asc' }, { id: 'asc' }] : [{ id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: adminVerificationInclude,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminVerification),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * A short-lived signed URL to view a private document. Every access is
   * audited (KVKK: who looked at whose identity document, when).
   */
  async documentUrl(
    actor: AuthUser,
    verificationId: string,
    ipAddress: string | null,
  ): Promise<SignedUrl> {
    const v = await this.prisma.providerVerification.findUnique({
      where: { id: verificationId },
      include: { provider: { select: { userId: true } } },
    });
    if (!v) throw verificationNotFound();
    if (!v.documentKey) throw notFound('DOCUMENT_NOT_FOUND', 'Bu kayda bağlı belge yok.');
    let signed;
    try {
      signed = await this.storage.createDownloadUrl(
        v.documentKey,
        this.env.DOCUMENT_URL_TTL_SECONDS,
      );
    } catch (error) {
      if (error instanceof StorageUnavailableError) {
        throw serviceUnavailable('STORAGE_UNAVAILABLE', 'Belge deposu şu anda kullanılamıyor.');
      }
      throw error;
    }
    await this.audit.record({
      action: 'verification.document_accessed',
      actorId: actor.id,
      entityType: 'provider_verification',
      entityId: v.id,
      ipAddress,
      metadata: { providerId: v.providerId, type: v.type },
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async approveVerification(actor: AuthUser, id: string, ipAddress: string | null) {
    return this.decideVerification(actor, id, 'APPROVED', null, ipAddress);
  }

  async rejectVerification(actor: AuthUser, id: string, reason: string, ipAddress: string | null) {
    return this.decideVerification(actor, id, 'REJECTED', reason, ipAddress);
  }

  private async decideVerification(
    actor: AuthUser,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | null,
    ipAddress: string | null,
  ): Promise<AdminProviderVerification> {
    const row = await this.prisma.$transaction(async (tx) => {
      const v = await tx.providerVerification.findUnique({
        where: { id },
        include: { provider: { select: { userId: true } } },
      });
      if (!v) throw verificationNotFound();
      this.assertNotSelf(actor, v.provider.userId);

      // Conditional update: of two admins deciding at once, one wins and
      // the other gets VERIFICATION_ALREADY_REVIEWED.
      const now = new Date();
      const { count } = await tx.providerVerification.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: decision,
          reviewedAt: now,
          reviewedById: actor.id,
          rejectionReason: decision === 'REJECTED' ? reason : null,
        },
      });
      if (count === 0) {
        throw conflict('VERIFICATION_ALREADY_REVIEWED', 'Bu belge zaten incelendi.', {
          status: v.status,
        });
      }

      const trustEvent = decision === 'APPROVED' ? TRUST_EVENT_FOR[v.type] : undefined;
      if (trustEvent) {
        await tx.trustEvent.create({
          data: {
            subjectId: v.provider.userId,
            subjectRole: 'PROVIDER',
            type: trustEvent,
            occurredAt: now,
            metadata: { verificationId: v.id },
          },
        });
      }
      await this.audit.recordIn(tx, {
        action: decision === 'APPROVED' ? 'verification.approved' : 'verification.rejected',
        actorId: actor.id,
        entityType: 'provider_verification',
        entityId: v.id,
        ipAddress,
        metadata: { providerId: v.providerId, type: v.type, ...(reason ? { reason } : {}) },
      });
      return tx.providerVerification.findUniqueOrThrow({
        where: { id },
        include: adminVerificationInclude,
      });
    });
    return toAdminVerification(row);
  }

  /**
   * PENDING_REVIEW → ACTIVE, only when every required document is approved
   * and the application is still complete.
   */
  async approveProvider(
    actor: AuthUser,
    id: string,
    ipAddress: string | null,
  ): Promise<ProviderProfile> {
    return this.transition(actor, id, 'APPROVE', null, ipAddress, async (profile, tx) => {
      const snapshot = await this.store.snapshot(profile, tx);
      const missing = missingApprovals(snapshot.verifications);
      if (missing.length > 0) {
        throw unprocessable(
          'VERIFICATION_REQUIRED',
          'Onay için zorunlu belgelerin onaylanmış olması gerekir.',
          { missingVerificationTypes: missing },
        );
      }
      const onboarding = computeOnboarding(snapshot);
      const blocking = onboarding.missingSteps.filter((s) => s !== 'REQUIRED_VERIFICATIONS');
      if (blocking.length > 0) {
        throw unprocessable('PROVIDER_PROFILE_INCOMPLETE', 'Başvuruda eksik adımlar var.', {
          missingSteps: blocking,
        });
      }
    });
  }

  async rejectProvider(actor: AuthUser, id: string, reason: string, ipAddress: string | null) {
    return this.transition(actor, id, 'REJECT', reason, ipAddress);
  }

  async suspendProvider(actor: AuthUser, id: string, reason: string, ipAddress: string | null) {
    return this.transition(actor, id, 'SUSPEND', reason, ipAddress);
  }

  async reinstateProvider(actor: AuthUser, id: string, ipAddress: string | null) {
    return this.transition(actor, id, 'REINSTATE', null, ipAddress);
  }

  /**
   * One path for every admin status change: lock the row, ask the
   * lifecycle policy, run extra checks, then a conditional update on the
   * expected source status.
   */
  private async transition(
    actor: AuthUser,
    providerId: string,
    event: Extract<ProviderEvent, 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE'>,
    reason: string | null,
    ipAddress: string | null,
    guard?: (
      profile: Awaited<ReturnType<ProviderStore['lockById']>>,
      tx: Prisma.TransactionClient,
    ) => Promise<void>,
  ): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const current = await this.store.lockById(tx, providerId);
      this.assertNotSelf(actor, current.userId);
      const next = transitionFor(current.status, event);
      if (!next) throw invalidProviderState(current.status);
      await guard?.(current, tx);

      const now = new Date();
      const data: Prisma.ProviderProfileUncheckedUpdateManyInput = {
        status: next,
        reviewedAt: now,
        reviewedById: actor.id,
        statusReason: reason,
        ...(event === 'APPROVE' ? { approvedAt: now } : {}),
        // Leaving ACTIVE always ends dispatchability.
        ...(next !== 'ACTIVE' ? { isAvailableNow: false } : {}),
      };
      const { count } = await tx.providerProfile.updateMany({
        where: { id: current.id, status: { in: [...sourceStatuses(event)] as ProviderStatus[] } },
        data,
      });
      if (count === 0) throw invalidProviderState(current.status);

      await this.audit.recordIn(tx, {
        action: `provider.${AUDIT_VERB[event]}`,
        actorId: actor.id,
        entityType: 'provider_profile',
        entityId: current.id,
        ipAddress,
        metadata: { from: current.status, to: next, ...(reason ? { reason } : {}) },
      });
      return tx.providerProfile.findUniqueOrThrow({ where: { id: current.id } });
    });
    return toProviderProfile(profile);
  }

  private assertNotSelf(actor: AuthUser, subjectUserId: string): void {
    if (actor.id === subjectUserId) {
      throw forbidden('CANNOT_REVIEW_SELF', 'Kendi usta başvurunuzu inceleyemezsiniz.');
    }
  }
}

const AUDIT_VERB = {
  APPROVE: 'approved',
  REJECT: 'rejected',
  SUSPEND: 'suspended',
  REINSTATE: 'reinstated',
} as const;
