import { Injectable } from '@nestjs/common';
import type { ProviderOnboardingStatus, ProviderProfile } from '@ustago/types';
import type {
  CreateProviderProfileRequest,
  UpdateProviderAvailabilityRequest,
  UpdateProviderProfileRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, unprocessable } from '../common/http/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeOnboarding, isProfileComplete, MIN_BIO_LENGTH } from './domain/onboarding.js';
import {
  canBeAvailableNow,
  canEdit,
  requiresNonEmptyCatalog,
  transitionFor,
} from './domain/provider-lifecycle.js';
import { toProviderProfile } from './provider.mappers.js';
import { invalidProviderState, ProviderStore } from './provider.store.js';

/** The provider's own profile, onboarding progress, submission and NOW settings. */
@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lets an existing account start offering services: opens a DRAFT
   * provider profile and grants the PROVIDER role in one transaction. The
   * account keeps its CUSTOMER role (ADR-0005).
   */
  async becomeProvider(
    userId: string,
    input: CreateProviderProfileRequest,
    ipAddress: string | null,
  ): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.providerProfile.findUnique({ where: { userId } });
      if (existing) {
        throw conflict('PROVIDER_PROFILE_EXISTS', 'Bu hesabın zaten bir usta profili var.');
      }
      const created = await tx.providerProfile.create({
        data: {
          userId,
          displayName: input.displayName,
          type: input.type,
          bio: input.bio ?? null,
          yearsOfExperience: input.yearsOfExperience ?? null,
        },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId, role: 'PROVIDER' } },
        create: { userId, role: 'PROVIDER' },
        update: {},
      });
      await this.audit.recordIn(tx, {
        action: 'provider.profile_created',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: created.id,
        ipAddress,
      });
      return created;
    });
    return toProviderProfile(profile);
  }

  async getMine(userId: string): Promise<ProviderProfile> {
    return toProviderProfile(await this.store.findByUserId(userId));
  }

  async updateMine(
    userId: string,
    input: UpdateProviderProfileRequest,
    ipAddress: string | null,
  ): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const current = await this.store.lockByUserId(tx, userId);
      this.store.assertEditable(current, 'PROFILE');
      // An approved, publicly listed provider cannot drop the profile
      // information approval required (same rule as services and areas).
      if (
        requiresNonEmptyCatalog(current.status) &&
        !isProfileComplete({
          displayName: input.displayName ?? current.displayName,
          bio: input.bio === undefined ? current.bio : input.bio,
          yearsOfExperience:
            input.yearsOfExperience === undefined
              ? current.yearsOfExperience
              : input.yearsOfExperience,
        })
      ) {
        throw unprocessable(
          'PROVIDER_PROFILE_INCOMPLETE',
          `Onaylı bir ustanın profili eksiksiz kalmalıdır (tanıtım en az ${MIN_BIO_LENGTH} karakter, deneyim yılı dolu).`,
        );
      }
      const updated = await tx.providerProfile.update({ where: { id: current.id }, data: input });
      await this.audit.recordIn(tx, {
        action: 'provider.profile_updated',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: current.id,
        ipAddress,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
    return toProviderProfile(profile);
  }

  async onboarding(userId: string): Promise<ProviderOnboardingStatus> {
    const profile = await this.store.findByUserId(userId);
    return computeOnboarding(await this.store.snapshot(profile));
  }

  /**
   * DRAFT → PENDING_REVIEW after a server-side completeness check. Submitting
   * again while the application is already under review is a no-op (safe
   * client retries); the row lock makes concurrent submits serialise.
   */
  async submit(userId: string, ipAddress: string | null): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const current = await this.store.lockByUserId(tx, userId);
      if (current.status === 'PENDING_REVIEW') return current;
      const next = transitionFor(current.status, 'SUBMIT');
      if (!next) {
        throw invalidProviderState(
          current.status,
          current.status === 'REJECTED'
            ? 'Reddedilen başvuruyu düzenleyip yeniden başvurun (POST /providers/me/reapply).'
            : undefined,
        );
      }
      const onboarding = computeOnboarding(await this.store.snapshot(current, tx));
      if (onboarding.missingSteps.length > 0) {
        throw unprocessable(
          'PROVIDER_ONBOARDING_INCOMPLETE',
          'Başvuru göndermeden önce eksik adımları tamamlayın.',
          { missingSteps: onboarding.missingSteps },
        );
      }
      const updated = await tx.providerProfile.update({
        where: { id: current.id },
        data: { status: next, submittedAt: new Date(), statusReason: null },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.application_submitted',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: current.id,
        ipAddress,
        metadata: { from: current.status, to: next },
      });
      return updated;
    });
    return toProviderProfile(profile);
  }

  /** REJECTED → DRAFT so the provider can fix the application and submit again. */
  async reapply(userId: string, ipAddress: string | null): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const current = await this.store.lockByUserId(tx, userId);
      const next = transitionFor(current.status, 'REAPPLY');
      if (!next) throw invalidProviderState(current.status);
      const updated = await tx.providerProfile.update({
        where: { id: current.id },
        data: { status: next, statusReason: null },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.reapplied',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: current.id,
        ipAddress,
      });
      return updated;
    });
    return toProviderProfile(profile);
  }

  /**
   * nowEnabled is a preference that may be saved during onboarding;
   * isAvailableNow makes the provider dispatchable and needs an ACTIVE
   * provider with at least one category × province where NOW is open.
   */
  async updateAvailability(
    userId: string,
    input: UpdateProviderAvailabilityRequest,
    ipAddress: string | null,
  ): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const current = await this.store.lockByUserId(tx, userId);
      const nowEnabled = input.nowEnabled ?? current.nowEnabled;
      // Turning NOW off always also ends availability.
      let isAvailableNow = nowEnabled ? (input.isAvailableNow ?? current.isAvailableNow) : false;

      if (input.nowEnabled !== undefined && input.nowEnabled !== current.nowEnabled) {
        if (!canEdit(current.status, 'NOW_PREFERENCE')) throw invalidProviderState(current.status);
        if (nowEnabled && !(await this.store.hasNowCapableService(current.id, tx))) {
          throw unprocessable(
            'NOW_CATEGORY_NOT_SUPPORTED',
            'Acil Usta için en az bir acil hizmet destekleyen kategori seçmelisiniz.',
          );
        }
      }

      // An explicit "make me available" is checked even when it would be a
      // no-op, so the client learns why it did not happen.
      if (input.isAvailableNow === true && !current.isAvailableNow) {
        if (!canBeAvailableNow(current.status)) {
          throw conflict(
            'PROVIDER_NOT_ACTIVE',
            'Müsaitlik yalnızca onaylanmış ustalar için açılabilir.',
            { status: current.status },
          );
        }
        if (!nowEnabled) {
          throw unprocessable('NOW_NOT_AVAILABLE', 'Önce Acil Usta tercihini açın.');
        }
        if (!(await this.store.hasNowOpenPair(current.id, tx))) {
          throw unprocessable(
            'NOW_NOT_AVAILABLE',
            'Hizmet verdiğiniz bölge ve kategorilerde Acil Usta henüz açık değil.',
          );
        }
      }
      if (!canBeAvailableNow(current.status)) isAvailableNow = false;

      if (nowEnabled === current.nowEnabled && isAvailableNow === current.isAvailableNow) {
        return current;
      }
      const updated = await tx.providerProfile.update({
        where: { id: current.id },
        data: { nowEnabled, isAvailableNow },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.availability_changed',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: current.id,
        ipAddress,
        metadata: { nowEnabled, isAvailableNow },
      });
      return updated;
    });
    return toProviderProfile(profile);
  }
}
