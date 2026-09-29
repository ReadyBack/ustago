import { Injectable } from '@nestjs/common';

import { conflict, notFound } from '../common/http/errors.js';
import type { Prisma, ProviderProfile, ProviderStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isNowOpen } from './domain/now-availability.js';
import type { OnboardingSnapshot } from './domain/onboarding.js';
import { canEdit, type ProviderSection } from './domain/provider-lifecycle.js';

type Tx = Prisma.TransactionClient;

export const providerNotFound = () =>
  notFound('PROVIDER_PROFILE_NOT_FOUND', 'Usta profili bulunamadı.');

export const invalidProviderState = (status: ProviderStatus, message?: string) =>
  conflict(
    'INVALID_PROVIDER_STATE',
    message ?? 'Başvurunun şu anki durumunda bu işlem yapılamaz.',
    { status },
  );

/**
 * Shared persistence helpers for the provider aggregate: row locks that
 * serialise edits against submit/approve, the onboarding snapshot and the
 * NOW availability check.
 */
@Injectable()
export class ProviderStore {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string, tx: Tx = this.prisma): Promise<ProviderProfile> {
    const profile = await tx.providerProfile.findFirst({ where: { userId, deletedAt: null } });
    if (!profile) throw providerNotFound();
    return profile;
  }

  /**
   * Locks the caller's provider row for the rest of the transaction
   * (SELECT ... FOR UPDATE), so a submit, an admin decision and an edit of
   * the same application never interleave.
   */
  async lockByUserId(tx: Tx, userId: string): Promise<ProviderProfile> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM provider_profiles
      WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
      FOR UPDATE`;
    const id = rows[0]?.id;
    if (!id) throw providerNotFound();
    return tx.providerProfile.findUniqueOrThrow({ where: { id } });
  }

  async lockById(tx: Tx, providerId: string): Promise<ProviderProfile> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM provider_profiles
      WHERE id = ${providerId}::uuid AND deleted_at IS NULL
      FOR UPDATE`;
    if (!rows[0]) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    return tx.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
  }

  assertEditable(profile: ProviderProfile, section: ProviderSection): void {
    if (!canEdit(profile.status, section)) {
      throw invalidProviderState(
        profile.status,
        profile.status === 'PENDING_REVIEW'
          ? 'Başvurunuz incelenirken bilgiler değiştirilemez.'
          : undefined,
      );
    }
  }

  async snapshot(profile: ProviderProfile, tx: Tx = this.prisma): Promise<OnboardingSnapshot> {
    const [user, activeServiceCount, activeAreaCount, verifications] = await Promise.all([
      tx.user.findUniqueOrThrow({
        where: { id: profile.userId },
        select: { phone: true, phoneVerifiedAt: true },
      }),
      tx.providerService.count({
        where: { providerId: profile.id, category: { isActive: true } },
      }),
      tx.providerServiceArea.count({
        where: { providerId: profile.id, district: { isActive: true } },
      }),
      tx.providerVerification.findMany({
        where: { providerId: profile.id },
        select: { type: true, status: true },
      }),
    ]);
    return {
      status: profile.status,
      statusReason: profile.statusReason,
      phoneVerified: user.phone !== null && user.phoneVerifiedAt !== null,
      displayName: profile.displayName,
      bio: profile.bio,
      yearsOfExperience: profile.yearsOfExperience,
      activeServiceCount,
      activeAreaCount,
      verifications,
    };
  }

  /** Does the provider have an active category that supports NOW? */
  async hasNowCapableService(providerId: string, tx: Tx = this.prisma): Promise<boolean> {
    const count = await tx.providerService.count({
      where: { providerId, category: { isActive: true, supportsNow: true } },
    });
    return count > 0;
  }

  /**
   * Is NOW open for at least one (service category × service-area province)
   * pair of this provider? Two queries, no N+1.
   */
  async hasNowOpenPair(providerId: string, tx: Tx = this.prisma): Promise<boolean> {
    const [services, areas] = await Promise.all([
      tx.providerService.findMany({
        where: { providerId },
        select: {
          category: { select: { id: true, isActive: true, supportsNow: true } },
        },
      }),
      tx.providerServiceArea.findMany({
        where: { providerId, district: { isActive: true } },
        select: { district: { select: { province: { select: { id: true, isActive: true } } } } },
      }),
    ]);
    const provinces = new Map(areas.map((a) => [a.district.province.id, a.district.province]));
    const categories = services.map((s) => s.category);
    if (provinces.size === 0 || categories.length === 0) return false;

    const overrides = await tx.provinceCategory.findMany({
      where: {
        provinceId: { in: [...provinces.keys()] },
        categoryId: { in: categories.map((c) => c.id) },
      },
    });
    const overrideOf = (p: number, c: string) =>
      overrides.find((o) => o.provinceId === p && o.categoryId === c) ?? null;

    for (const province of provinces.values()) {
      for (const category of categories) {
        if (
          isNowOpen({
            provinceActive: province.isActive,
            categoryActive: category.isActive,
            categorySupportsNow: category.supportsNow,
            override: overrideOf(province.id, category.id),
          })
        ) {
          return true;
        }
      }
    }
    return false;
  }
}
