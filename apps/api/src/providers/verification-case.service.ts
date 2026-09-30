import { Injectable } from '@nestjs/common';
import type {
  AdminVerificationCaseDetail,
  AdminVerificationCaseListItem,
  Paginated,
  ProviderVerificationCaseView,
  VerificationChecklistItem,
  VerificationDocumentRequirement,
  VerificationTimelineEntry,
} from '@ustago/types';
import type {
  ApproveVerificationRequest,
  ListVerificationCasesQuery,
  VerificationDecisionRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, forbidden, notFound, unprocessable } from '../common/http/errors.js';
import type {
  Prisma,
  ProviderProfile,
  ProviderVerificationCase,
  ProviderVerificationStatus,
  VerificationType,
} from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import {
  type NotificationDraft,
  NotificationsService,
} from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeOnboarding, REQUIRED_VERIFICATION_TYPES } from './domain/onboarding.js';
import { transitionFor as applicationTransition } from './domain/provider-lifecycle.js';
import { providerPolicy } from './domain/provider-policy.js';
import {
  canEditDocuments,
  type VerificationEvent,
  verificationSources,
  verificationTransition,
} from './domain/verification-case.js';
import { adminVerificationInclude, toProviderVerification } from './provider.mappers.js';
import { ProviderStore } from './provider.store.js';

type Tx = Prisma.TransactionClient;
type ActorType = 'PROVIDER' | 'ADMIN' | 'SYSTEM';

export const invalidVerificationTransition = (
  from: ProviderVerificationStatus,
  event: VerificationEvent,
) =>
  conflict(
    'PROVIDER_VERIFICATION_INVALID_TRANSITION',
    'Doğrulama başvurusunun şu anki durumunda bu işlem yapılamaz.',
    { status: from, event },
  );

const versionConflict = (current: number) =>
  conflict(
    'VERIFICATION_VERSION_CONFLICT',
    'Başvuru siz incelerken değişti. Sayfayı yenileyip tekrar deneyin.',
    { version: current },
  );

const caseNotFound = () =>
  notFound('VERIFICATION_CASE_NOT_FOUND', 'Doğrulama başvurusu bulunamadı.');

const EVENT_NAME: Record<VerificationEvent, string> = {
  UPLOAD: 'provider.verification.started',
  SUBMIT: 'provider.verification.submitted',
  START_REVIEW: 'provider.verification.review_started',
  APPROVE: 'provider.verification.approved',
  REQUEST_REVISION: 'provider.verification.revision_requested',
  REJECT: 'provider.verification.rejected',
  RESTART: 'provider.verification.restarted',
  SUSPEND: 'provider.verification.suspended',
  REINSTATE: 'provider.verification.reinstated',
};

/** Provider notifications (IN_APP + push outbox) per event. */
const NOTIFY: Partial<Record<VerificationEvent, { type: string; title: string; body: string }>> = {
  SUBMIT: {
    type: NotificationEvent.VERIFICATION_SUBMITTED,
    title: 'Başvurunuz alındı',
    body: 'Hesap doğrulama başvurunuz inceleme sırasına alındı.',
  },
  START_REVIEW: {
    type: NotificationEvent.VERIFICATION_UNDER_REVIEW,
    title: 'Başvurunuz incelemeye alındı',
    body: 'Ekibimiz belgelerinizi inceliyor.',
  },
  REQUEST_REVISION: {
    type: NotificationEvent.VERIFICATION_NEEDS_REVISION,
    title: 'Ek bilgi gerekli',
    body: 'Doğrulama başvurunuzda düzeltilmesi gereken noktalar var.',
  },
  APPROVE: {
    type: NotificationEvent.VERIFICATION_APPROVED,
    title: 'Hesabınız doğrulandı',
    body: 'Profilinizde artık "Kimliği/hesabı doğrulanmıştır" rozeti görünüyor.',
  },
  REJECT: {
    type: NotificationEvent.VERIFICATION_REJECTED,
    title: 'Başvurunuz reddedildi',
    body: 'Doğrulama başvurunuz onaylanmadı. Ayrıntılar Hesabımı Doğrula ekranında.',
  },
};

const LIVE_DOCUMENT = {
  status: { in: ['PENDING', 'APPROVED'] as ('PENDING' | 'APPROVED')[] },
};
const actorSelect = { select: { id: true, firstName: true, lastName: true } } as const;
const name = (u: { id: string; firstName: string; lastName: string } | null) =>
  u ? { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() } : null;

/**
 * Provider account verification (Faz 6, docs/adr/0023). The case wraps the
 * Faz 2 per-document reviews into one submission an admin approves as a
 * whole. Decisions are optimistic-locked on the case version and serialised
 * by the provider row lock, so an approve racing a reject has exactly one
 * winner. Every change writes an append-only event, an audit entry and,
 * where the provider should know, a notification in the same transaction.
 *
 * Only the MANUAL method exists: no automated identity check, no external
 * KYC service. `method` and `externalReference` are there for a future
 * provider (docs/decisions/kyc-provider-selection.md).
 */
@Injectable()
export class VerificationCaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------

  /** Document types this provider must have on file (platform + categories). */
  async requiredTypes(providerId: string, tx: Tx = this.prisma): Promise<VerificationType[]> {
    const rows = await tx.categoryProviderRequirement.findMany({
      where: {
        deactivatedAt: null,
        category: {
          OR: [
            { providers: { some: { providerId } } },
            { children: { some: { providers: { some: { providerId } } } } },
          ],
        },
      },
      select: { documentType: true },
    });
    return [...new Set([...REQUIRED_VERIFICATION_TYPES, ...rows.map((r) => r.documentType)])];
  }

  private async caseOf(providerId: string, tx: Tx): Promise<ProviderVerificationCase | null> {
    return tx.providerVerificationCase.findUnique({ where: { providerId } });
  }

  /** Creates the case lazily; no row means NOT_STARTED. */
  private async ensureCase(providerId: string, tx: Tx): Promise<ProviderVerificationCase> {
    return tx.providerVerificationCase.upsert({
      where: { providerId },
      create: { providerId, status: 'NOT_STARTED' },
      update: {},
    });
  }

  /**
   * Applies one event: conditional update on (status, version), event row,
   * audit entry and notification. Throws 409 on an invalid transition or a
   * stale version.
   */
  private async apply(
    tx: Tx,
    current: ProviderVerificationCase,
    event: VerificationEvent,
    actor: { type: ActorType; id: string | null },
    extra: {
      expectedVersion?: number;
      data?: Prisma.ProviderVerificationCaseUncheckedUpdateManyInput;
      reasonCode?: string | null;
      userVisibleReason?: string | null;
      internalNote?: string | null;
      ipAddress?: string | null;
      providerUserId: string;
      /** Intermediate steps of a legacy path do not notify the provider. */
      silent?: boolean;
    },
  ): Promise<ProviderVerificationCase> {
    const to = verificationTransition(current.status, event);
    if (!to) throw invalidVerificationTransition(current.status, event);
    if (extra.expectedVersion !== undefined && extra.expectedVersion !== current.version) {
      throw versionConflict(current.version);
    }
    const { count } = await tx.providerVerificationCase.updateMany({
      where: {
        id: current.id,
        version: current.version,
        status: { in: [...verificationSources(event)] },
      },
      data: { ...extra.data, status: to, version: { increment: 1 } },
    });
    if (count === 0) throw versionConflict(current.version);
    await tx.providerVerificationEvent.create({
      data: {
        caseId: current.id,
        providerId: current.providerId,
        event: EVENT_NAME[event],
        fromStatus: current.status,
        toStatus: to,
        actorType: actor.type,
        actorId: actor.id,
        reasonCode: extra.reasonCode ?? null,
        userVisibleReason: extra.userVisibleReason ?? null,
        internalNote: extra.internalNote ?? null,
      },
    });
    await this.audit.recordIn(tx, {
      action: EVENT_NAME[event],
      actorId: actor.id,
      entityType: 'provider_profile',
      entityId: current.providerId,
      ipAddress: extra.ipAddress ?? null,
      metadata: {
        caseId: current.id,
        from: current.status,
        to,
        ...(extra.reasonCode ? { reasonCode: extra.reasonCode } : {}),
      },
    });
    const note = extra.silent ? undefined : NOTIFY[event];
    if (note) {
      const draft: NotificationDraft = {
        userId: extra.providerUserId,
        type: note.type,
        title: note.title,
        body: extra.userVisibleReason ? `${note.body} ${extra.userVisibleReason}` : note.body,
        data: { providerId: current.providerId },
      };
      await this.notifications.enqueueIn(tx, [draft]);
    }
    return tx.providerVerificationCase.findUniqueOrThrow({ where: { id: current.id } });
  }

  // -------------------------------------------------------------------------
  // Provider side
  // -------------------------------------------------------------------------

  /**
   * Called in the document upload transaction (provider row locked): links
   * the document to the case and starts or restarts it. Refuses while an
   * admin has the submission.
   */
  async onDocumentUpload(tx: Tx, profile: ProviderProfile, userId: string): Promise<string> {
    let current = await this.ensureCase(profile.id, tx);
    if (!canEditDocuments(current.status)) {
      throw conflict(
        'VERIFICATION_LOCKED',
        current.status === 'SUSPENDED'
          ? 'Hesabınız askıdayken belge yüklenemez.'
          : 'Başvurunuz incelenirken belge değiştirilemez.',
        { status: current.status },
      );
    }
    const actor = { type: 'PROVIDER' as const, id: userId };
    if (current.status === 'NOT_STARTED') {
      current = await this.apply(tx, current, 'UPLOAD', actor, { providerUserId: userId });
    } else if (current.status === 'REJECTED') {
      current = await this.apply(tx, current, 'RESTART', actor, { providerUserId: userId });
      // A rejected application is reopened for editing too (Faz 2 REAPPLY).
      const reopened = applicationTransition(profile.status, 'REAPPLY');
      if (reopened) {
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: { status: reopened, statusReason: null },
        });
      }
    }
    return current.id;
  }

  async view(userId: string): Promise<ProviderVerificationCaseView> {
    const profile = await this.store.findByUserId(userId);
    return this.viewOf(profile);
  }

  private async viewOf(profile: ProviderProfile): Promise<ProviderVerificationCaseView> {
    const [row, required, documents, snapshot, suspension] = await Promise.all([
      this.prisma.providerVerificationCase.findUnique({
        where: { providerId: profile.id },
        include: { events: { orderBy: { createdAt: 'asc' }, take: 100 } },
      }),
      this.requiredTypes(profile.id),
      this.prisma.providerVerification.findMany({
        where: { providerId: profile.id },
        orderBy: { submittedAt: 'desc' },
      }),
      this.store.snapshot(profile),
      this.prisma.providerSuspension.findFirst({
        where: { providerId: profile.id, status: { in: ['ACTIVE', 'EXPIRED_PENDING_REVIEW'] } },
      }),
    ]);
    const status = row?.status ?? 'NOT_STARTED';
    const onboarding = computeOnboarding(snapshot);
    const currentOf = (type: VerificationType) => {
      const latest = documents.find((d) => d.type === type);
      return latest ? toProviderVerification(latest) : null;
    };
    const optional: VerificationType[] = (
      ['PROFESSIONAL_CERTIFICATE', 'BUSINESS_DOCUMENT', 'OTHER'] as VerificationType[]
    ).filter((t) => !required.includes(t));
    const docs: VerificationDocumentRequirement[] = [
      ...required.map((type) => ({
        type,
        required: true,
        reason:
          type === 'IDENTITY'
            ? 'Tüm ustalar için zorunlu.'
            : 'Hizmet verdiğiniz bir kategori bu belgeyi istiyor.',
        current: currentOf(type),
      })),
      ...optional.map((type) => ({
        type,
        required: false,
        reason: 'İsteğe bağlı; müşterilere güven verir.',
        current: currentOf(type),
      })),
    ];
    const docsDone = required.every((t) =>
      documents.some((d) => d.type === t && (d.status === 'PENDING' || d.status === 'APPROVED')),
    );
    const checklist: VerificationChecklistItem[] = [
      { key: 'PROFILE', label: 'Profil bilgileri', done: onboarding.profileComplete },
      { key: 'SERVICES', label: 'Hizmet kategorileri', done: onboarding.servicesComplete },
      { key: 'SERVICE_AREAS', label: 'Hizmet bölgeleri', done: onboarding.serviceAreasComplete },
      { key: 'DOCUMENTS', label: 'Zorunlu belgeler', done: docsDone },
      {
        key: 'SUBMIT',
        label: 'İncelemeye gönder',
        done: ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED'].includes(status),
      },
    ];
    const canSubmit =
      verificationTransition(status, 'SUBMIT') !== null &&
      checklist.slice(0, 4).every((c) => c.done) &&
      onboarding.phoneVerified &&
      profile.accountStatus !== 'SUSPENDED' &&
      profile.accountStatus !== 'BANNED' &&
      profile.status !== 'SUSPENDED';
    const policy = providerPolicy({
      applicationStatus: profile.status,
      verificationStatus: status,
      accountStatus: profile.accountStatus,
    });
    return {
      status,
      providerStatus: profile.status,
      accountStatus: profile.accountStatus,
      method: 'MANUAL',
      submittedAt: row?.submittedAt?.toISOString() ?? null,
      submissionCount: row?.submissionCount ?? 0,
      decidedAt: row?.decidedAt?.toISOString() ?? null,
      verifiedAt: row?.verifiedAt?.toISOString() ?? null,
      // Only what was written for the provider; never the internal note.
      userVisibleReason:
        status === 'NEEDS_REVISION' || status === 'REJECTED'
          ? (row?.userVisibleReason ?? null)
          : null,
      reasonCode:
        status === 'NEEDS_REVISION' || status === 'REJECTED'
          ? (row?.decisionReasonCode ?? null)
          : null,
      checklist,
      documents: docs,
      canSubmit,
      canEditDocuments: canEditDocuments(status) && profile.status !== 'SUSPENDED',
      capabilities: {
        listed: policy.listed,
        canQuote: policy.canQuote,
        canTakeNowJobs: policy.canTakeNowJobs,
        canRequestPayout: policy.canRequestPayout,
        showVerifiedBadge: policy.showVerifiedBadge,
        restrictions: policy.restrictions,
      },
      activeSuspension: suspension
        ? {
            id: suspension.id,
            level:
              suspension.level === 'BANNED'
                ? 'BANNED'
                : suspension.level === 'LIMITED'
                  ? 'LIMITED'
                  : 'SUSPENDED',
            status: suspension.status,
            reasonCode: suspension.reasonCode,
            userVisibleReason: suspension.userVisibleReason,
            startsAt: suspension.startsAt.toISOString(),
            expiresAt: suspension.expiresAt?.toISOString() ?? null,
            createdAt: suspension.createdAt.toISOString(),
          }
        : null,
      timeline: (row?.events ?? []).map((e): VerificationTimelineEntry => ({
        id: e.id,
        event: e.event,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType as VerificationTimelineEntry['actorType'],
        userVisibleReason: e.userVisibleReason,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Sends the case for review. A DRAFT application is submitted with it
   * (Faz 2 DRAFT → PENDING_REVIEW); an ACTIVE provider stays ACTIVE and
   * keeps working while the case is reviewed. Re-submitting a case already
   * submitted is a no-op (safe client retry).
   */
  async submit(userId: string, ipAddress: string | null): Promise<ProviderVerificationCaseView> {
    await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      const current = await this.ensureCase(profile.id, tx);
      if (current.status === 'SUBMITTED' || current.status === 'UNDER_REVIEW') return;
      if (profile.accountStatus === 'SUSPENDED' || profile.accountStatus === 'BANNED') {
        throw forbidden('PROVIDER_SUSPENDED', 'Hesabınız askıdayken başvuru gönderilemez.');
      }
      const view = await this.viewOf(profile);
      if (!view.canSubmit) {
        throw unprocessable(
          'VERIFICATION_INCOMPLETE',
          'Göndermeden önce eksik adımları ve zorunlu belgeleri tamamlayın.',
          {
            missing: view.checklist.filter((c) => !c.done && c.key !== 'SUBMIT').map((c) => c.key),
          },
        );
      }
      const now = new Date();
      await this.apply(
        tx,
        current,
        'SUBMIT',
        { type: 'PROVIDER', id: userId },
        {
          providerUserId: userId,
          ipAddress,
          data: {
            submittedAt: now,
            submissionCount: { increment: 1 },
            userVisibleReason: null,
            decisionReasonCode: null,
          },
        },
      );
      const next = applicationTransition(profile.status, 'SUBMIT');
      if (next) {
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: { status: next, submittedAt: now, statusReason: null },
        });
        await this.audit.recordIn(tx, {
          action: 'provider.application_submitted',
          actorId: userId,
          entityType: 'provider_profile',
          entityId: profile.id,
          ipAddress,
          metadata: { from: profile.status, to: next, via: 'verification' },
        });
      }
    });
    return this.view(userId);
  }

  /** Faz 2 POST /providers/me/submit also submits the verification case. */
  async submitWithApplication(
    tx: Tx,
    profile: ProviderProfile,
    userId: string,
    ipAddress: string | null,
  ) {
    const current = await this.ensureCase(profile.id, tx);
    if (verificationTransition(current.status, 'SUBMIT') === null) return;
    await this.apply(
      tx,
      current,
      'SUBMIT',
      { type: 'PROVIDER', id: userId },
      {
        providerUserId: userId,
        ipAddress,
        data: { submittedAt: new Date(), submissionCount: { increment: 1 } },
      },
    );
  }

  // -------------------------------------------------------------------------
  // Admin side
  // -------------------------------------------------------------------------

  async list(query: ListVerificationCasesQuery): Promise<Paginated<AdminVerificationCaseListItem>> {
    const fifo = query.status === 'SUBMITTED' || query.status === 'UNDER_REVIEW';
    const rows = await this.prisma.providerVerificationCase.findMany({
      where: { status: query.status, provider: { deletedAt: null } },
      orderBy: fifo ? [{ submittedAt: 'asc' }, { id: 'asc' }] : [{ id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        reviewer: actorSelect,
        provider: {
          select: {
            id: true,
            displayName: true,
            status: true,
            accountStatus: true,
            user: { select: { firstName: true, lastName: true } },
            _count: { select: { verifications: true } },
          },
        },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((c) => ({
        providerId: c.providerId,
        displayName: c.provider.displayName,
        contactName: `${c.provider.user.firstName} ${c.provider.user.lastName}`.trim(),
        status: c.status,
        providerStatus: c.provider.status,
        accountStatus: c.provider.accountStatus,
        submittedAt: c.submittedAt?.toISOString() ?? null,
        submissionCount: c.submissionCount,
        documentCount: c.provider._count.verifications,
        reviewedBy: name(c.reviewer),
        updatedAt: c.updatedAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async detail(providerId: string): Promise<AdminVerificationCaseDetail> {
    const p = await this.prisma.providerProfile.findFirst({
      where: { id: providerId, deletedAt: null },
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
        services: { select: { category: { select: { name: true } } } },
        serviceAreas: {
          select: { district: { select: { name: true, province: { select: { name: true } } } } },
        },
        verifications: { include: adminVerificationInclude, orderBy: { submittedAt: 'desc' } },
        verificationCase: {
          include: {
            reviewer: actorSelect,
            decider: actorSelect,
            events: { orderBy: { createdAt: 'asc' }, take: 200, include: { actor: actorSelect } },
          },
        },
      },
    });
    if (!p) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    const c = p.verificationCase;
    const status = c?.status ?? 'NOT_STARTED';
    // Same file uploaded by another provider: a signal for the reviewer.
    const hashes = p.verifications.map((v) => v.sha256).filter((h): h is string => h !== null);
    const dupes = hashes.length
      ? await this.prisma.providerVerification.findMany({
          where: { sha256: { in: hashes }, providerId: { not: p.id } },
          select: { sha256: true },
        })
      : [];
    const dupeSet = new Set(dupes.map((d) => d.sha256));
    const [required, view] = await Promise.all([this.requiredTypes(p.id), this.viewOf(p)]);
    return {
      providerId: p.id,
      userId: p.userId,
      displayName: p.displayName,
      contact: {
        firstName: p.user.firstName,
        lastName: p.user.lastName,
        phoneMasked: p.user.phone
          ? `${p.user.phone.slice(0, 5)}*****${p.user.phone.slice(-2)}`
          : null,
      },
      status,
      providerStatus: p.status,
      accountStatus: p.accountStatus,
      method: 'MANUAL',
      source: c?.source ?? 'WORKFLOW',
      submittedAt: c?.submittedAt?.toISOString() ?? null,
      submissionCount: c?.submissionCount ?? 0,
      reviewStartedAt: c?.reviewStartedAt?.toISOString() ?? null,
      reviewedBy: name(c?.reviewer ?? null),
      decidedAt: c?.decidedAt?.toISOString() ?? null,
      decisionBy: name(c?.decider ?? null),
      decisionReasonCode: c?.decisionReasonCode ?? null,
      userVisibleReason: c?.userVisibleReason ?? null,
      internalNote: c?.internalNote ?? null,
      verifiedAt: c?.verifiedAt?.toISOString() ?? null,
      version: c?.version ?? 0,
      categories: p.services.map((s) => s.category.name),
      areas: p.serviceAreas.map((a) => `${a.district.province.name} / ${a.district.name}`),
      checklist: view.checklist,
      documents: p.verifications.map((v) => ({
        ...toProviderVerification(v),
        rejectionReason: v.rejectionReason,
        sha256: v.sha256,
        scanStatus: v.scanStatus,
        duplicateOfOtherProvider: v.sha256 !== null && dupeSet.has(v.sha256),
      })),
      requiredDocumentTypes: required,
      timeline: (c?.events ?? []).map((e) => ({
        id: e.id,
        event: e.event,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType as 'PROVIDER' | 'ADMIN' | 'SYSTEM',
        userVisibleReason: e.userVisibleReason,
        createdAt: e.createdAt.toISOString(),
        actor: name(e.actor),
        reasonCode: e.reasonCode,
        internalNote: e.internalNote,
      })),
      actions: {
        startReview: verificationTransition(status, 'START_REVIEW') !== null,
        approve: verificationTransition(status, 'APPROVE') !== null,
        requestRevision: verificationTransition(status, 'REQUEST_REVISION') !== null,
        reject: verificationTransition(status, 'REJECT') !== null,
      },
    };
  }

  /** Runs `fn` with the provider row locked and the case loaded. */
  private async decide(
    actor: AuthUser,
    providerId: string,
    fn: (tx: Tx, profile: ProviderProfile, current: ProviderVerificationCase) => Promise<void>,
  ): Promise<AdminVerificationCaseDetail> {
    await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockById(tx, providerId);
      if (profile.userId === actor.id) {
        throw forbidden('CANNOT_REVIEW_SELF', 'Kendi usta başvurunuzu inceleyemezsiniz.');
      }
      const current = await this.caseOf(providerId, tx);
      if (!current) throw caseNotFound();
      await fn(tx, profile, current);
    });
    return this.detail(providerId);
  }

  async startReview(
    actor: AuthUser,
    providerId: string,
    expectedVersion: number,
    ipAddress: string | null,
  ) {
    return this.decide(actor, providerId, async (tx, profile, current) => {
      await this.apply(
        tx,
        current,
        'START_REVIEW',
        { type: 'ADMIN', id: actor.id },
        {
          expectedVersion,
          ipAddress,
          providerUserId: profile.userId,
          data: { reviewStartedAt: new Date(), reviewedByAdminId: actor.id },
        },
      );
    });
  }

  /**
   * UNDER_REVIEW → VERIFIED. Pending documents of the submission are
   * approved with it and a pending Faz 2 application goes ACTIVE.
   */
  async approve(
    actor: AuthUser,
    providerId: string,
    input: ApproveVerificationRequest,
    ipAddress: string | null,
  ) {
    return this.decide(actor, providerId, async (tx, profile, current) => {
      const required = await this.requiredTypes(providerId, tx);
      const docs = await tx.providerVerification.findMany({
        where: { providerId, ...LIVE_DOCUMENT },
        select: { type: true },
      });
      const missing = required.filter((t) => !docs.some((d) => d.type === t));
      if (missing.length > 0) {
        throw unprocessable('VERIFICATION_REQUIRED', 'Zorunlu belgeler eksik.', {
          missingVerificationTypes: missing,
        });
      }
      const now = new Date();
      await this.apply(
        tx,
        current,
        'APPROVE',
        { type: 'ADMIN', id: actor.id },
        {
          expectedVersion: input.expectedVersion,
          ipAddress,
          internalNote: input.internalNote ?? null,
          providerUserId: profile.userId,
          data: {
            decidedAt: now,
            decisionByAdminId: actor.id,
            decisionReasonCode: null,
            userVisibleReason: null,
            internalNote: input.internalNote ?? null,
            verifiedAt: now,
          },
        },
      );
      await this.approvePendingDocuments(tx, providerId, profile.userId, actor.id, now, ipAddress);
      await this.activateApplication(tx, profile, actor.id, now, ipAddress);
    });
  }

  /** UNDER_REVIEW → NEEDS_REVISION; a pending application goes back to DRAFT. */
  async requestRevision(
    actor: AuthUser,
    providerId: string,
    input: VerificationDecisionRequest,
    ipAddress: string | null,
  ) {
    return this.decide(actor, providerId, async (tx, profile, current) => {
      const now = new Date();
      await this.apply(
        tx,
        current,
        'REQUEST_REVISION',
        { type: 'ADMIN', id: actor.id },
        {
          expectedVersion: input.expectedVersion,
          ipAddress,
          reasonCode: input.reasonCode,
          userVisibleReason: input.userVisibleReason,
          internalNote: input.internalNote ?? null,
          providerUserId: profile.userId,
          data: {
            decidedAt: now,
            decisionByAdminId: actor.id,
            decisionReasonCode: input.reasonCode,
            userVisibleReason: input.userVisibleReason,
            internalNote: input.internalNote ?? null,
          },
        },
      );
      await this.rejectDocuments(tx, providerId, input, actor.id, now, ipAddress);
      if (profile.status === 'PENDING_REVIEW') {
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: {
            status: 'DRAFT',
            reviewedAt: now,
            reviewedById: actor.id,
            statusReason: input.userVisibleReason,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'provider.revision_requested',
          actorId: actor.id,
          entityType: 'provider_profile',
          entityId: profile.id,
          ipAddress,
          metadata: { from: 'PENDING_REVIEW', to: 'DRAFT', reasonCode: input.reasonCode },
        });
      }
    });
  }

  /** UNDER_REVIEW → REJECTED; a pending application is rejected with it. */
  async reject(
    actor: AuthUser,
    providerId: string,
    input: VerificationDecisionRequest,
    ipAddress: string | null,
  ) {
    return this.decide(actor, providerId, async (tx, profile, current) => {
      const now = new Date();
      await this.apply(
        tx,
        current,
        'REJECT',
        { type: 'ADMIN', id: actor.id },
        {
          expectedVersion: input.expectedVersion,
          ipAddress,
          reasonCode: input.reasonCode,
          userVisibleReason: input.userVisibleReason,
          internalNote: input.internalNote ?? null,
          providerUserId: profile.userId,
          data: {
            decidedAt: now,
            decisionByAdminId: actor.id,
            decisionReasonCode: input.reasonCode,
            userVisibleReason: input.userVisibleReason,
            internalNote: input.internalNote ?? null,
            verifiedAt: null,
          },
        },
      );
      await this.rejectDocuments(tx, providerId, input, actor.id, now, ipAddress);
      if (profile.status === 'PENDING_REVIEW') {
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: {
            status: 'REJECTED',
            reviewedAt: now,
            reviewedById: actor.id,
            statusReason: input.userVisibleReason,
            isAvailableNow: false,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'provider.rejected',
          actorId: actor.id,
          entityType: 'provider_profile',
          entityId: profile.id,
          ipAddress,
          metadata: { from: 'PENDING_REVIEW', to: 'REJECTED', reasonCode: input.reasonCode },
        });
      } else {
        // An already ACTIVE provider stays listed but loses NOW and payouts.
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: { isAvailableNow: false },
        });
      }
    });
  }

  /**
   * Faz 2 admin approval of the application (PATCH /admin/providers/:id/approve)
   * keeps working: it walks the case to VERIFIED with the same rules and
   * records every step, so both paths end in the same state.
   */
  async syncLegacyApproval(tx: Tx, profile: ProviderProfile, adminId: string, now: Date) {
    let current = await this.ensureCase(profile.id, tx);
    const actor = { type: 'ADMIN' as const, id: adminId };
    const base = { providerUserId: profile.userId };
    if (current.status === 'VERIFIED') return;
    if (verificationTransition(current.status, 'SUBMIT')) {
      current = await this.apply(tx, current, 'SUBMIT', actor, {
        ...base,
        silent: true,
        data: { submittedAt: now, submissionCount: { increment: 1 } },
      });
    }
    if (verificationTransition(current.status, 'START_REVIEW')) {
      current = await this.apply(tx, current, 'START_REVIEW', actor, {
        ...base,
        silent: true,
        data: { reviewStartedAt: now, reviewedByAdminId: adminId },
      });
    }
    await this.apply(tx, current, 'APPROVE', actor, {
      ...base,
      data: { decidedAt: now, decisionByAdminId: adminId, verifiedAt: now },
    });
  }

  /** Faz 2 rejection of the application also rejects the open case. */
  async syncLegacyRejection(tx: Tx, profile: ProviderProfile, adminId: string, reason: string) {
    let current = await this.caseOf(profile.id, tx);
    if (!current) return;
    const actor = { type: 'ADMIN' as const, id: adminId };
    const base = { providerUserId: profile.userId };
    if (current.status === 'SUBMITTED') {
      current = await this.apply(tx, current, 'START_REVIEW', actor, {
        ...base,
        silent: true,
        data: { reviewStartedAt: new Date(), reviewedByAdminId: adminId },
      });
    }
    if (current.status !== 'UNDER_REVIEW') return;
    await this.apply(tx, current, 'REJECT', actor, {
      ...base,
      reasonCode: 'OTHER',
      userVisibleReason: reason,
      data: {
        decidedAt: new Date(),
        decisionByAdminId: adminId,
        decisionReasonCode: 'OTHER',
        userVisibleReason: reason,
      },
    });
  }

  /** VERIFIED → SUSPENDED (badge off) inside a suspension transaction. */
  async suspendCase(tx: Tx, providerId: string, providerUserId: string, adminId: string | null) {
    const current = await this.caseOf(providerId, tx);
    if (current?.status !== 'VERIFIED') return;
    await this.apply(
      tx,
      current,
      'SUSPEND',
      { type: adminId ? 'ADMIN' : 'SYSTEM', id: adminId },
      {
        providerUserId,
      },
    );
  }

  /** SUSPENDED → VERIFIED when the suspension ends. */
  async reinstateCase(tx: Tx, providerId: string, providerUserId: string, adminId: string | null) {
    const current = await this.caseOf(providerId, tx);
    if (current?.status !== 'SUSPENDED') return;
    await this.apply(
      tx,
      current,
      'REINSTATE',
      { type: adminId ? 'ADMIN' : 'SYSTEM', id: adminId },
      {
        providerUserId,
      },
    );
  }

  private async approvePendingDocuments(
    tx: Tx,
    providerId: string,
    providerUserId: string,
    adminId: string,
    now: Date,
    ipAddress: string | null,
  ) {
    const pending = await tx.providerVerification.findMany({
      where: { providerId, status: 'PENDING' },
      select: { id: true, type: true },
    });
    if (pending.length === 0) return;
    await tx.providerVerification.updateMany({
      where: { id: { in: pending.map((d) => d.id) }, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedAt: now, reviewedById: adminId, rejectionReason: null },
    });
    for (const d of pending) {
      const trust =
        d.type === 'IDENTITY'
          ? 'IDENTITY_VERIFIED'
          : d.type === 'PROFESSIONAL_CERTIFICATE'
            ? 'CERTIFICATE_VERIFIED'
            : null;
      if (trust) {
        await tx.trustEvent.create({
          data: {
            subjectId: providerUserId,
            subjectRole: 'PROVIDER',
            type: trust,
            occurredAt: now,
            metadata: { verificationId: d.id },
          },
        });
      }
      await this.audit.recordIn(tx, {
        action: 'verification.approved',
        actorId: adminId,
        entityType: 'provider_verification',
        entityId: d.id,
        ipAddress,
        metadata: { providerId, type: d.type, via: 'case' },
      });
    }
  }

  private async rejectDocuments(
    tx: Tx,
    providerId: string,
    input: VerificationDecisionRequest,
    adminId: string,
    now: Date,
    ipAddress: string | null,
  ) {
    const ids = input.rejectDocumentIds ?? [];
    if (ids.length === 0) return;
    const { count } = await tx.providerVerification.updateMany({
      where: { id: { in: ids }, providerId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedAt: now,
        reviewedById: adminId,
        rejectionReason: input.userVisibleReason,
      },
    });
    if (count !== ids.length) {
      throw unprocessable(
        'VERIFICATION_DOCUMENT_INVALID',
        'Seçilen belgelerden biri bu ustaya ait değil veya zaten incelenmiş.',
      );
    }
    for (const id of ids) {
      await this.audit.recordIn(tx, {
        action: 'verification.rejected',
        actorId: adminId,
        entityType: 'provider_verification',
        entityId: id,
        ipAddress,
        metadata: { providerId, reasonCode: input.reasonCode, via: 'case' },
      });
    }
  }

  private async activateApplication(
    tx: Tx,
    profile: ProviderProfile,
    adminId: string,
    now: Date,
    ipAddress: string | null,
  ) {
    const next = applicationTransition(profile.status, 'APPROVE');
    if (!next) return;
    await tx.providerProfile.update({
      where: { id: profile.id },
      data: {
        status: next,
        approvedAt: now,
        reviewedAt: now,
        reviewedById: adminId,
        statusReason: null,
      },
    });
    await this.audit.recordIn(tx, {
      action: 'provider.approved',
      actorId: adminId,
      entityType: 'provider_profile',
      entityId: profile.id,
      ipAddress,
      metadata: { from: profile.status, to: next, via: 'verification' },
    });
  }
}
