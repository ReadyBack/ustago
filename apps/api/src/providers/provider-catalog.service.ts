import { Injectable } from '@nestjs/common';
import type { ProviderServiceAreaGroup, ProviderServiceItem } from '@ustago/types';
import type {
  SetProviderServiceAreasRequest,
  SetProviderServicesRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { unprocessable } from '../common/http/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requiresNonEmptyCatalog } from './domain/provider-lifecycle.js';
import { catalogInclude, toServiceAreaGroups, toServiceItems } from './provider.mappers.js';
import { ProviderStore } from './provider.store.js';

/** What the provider does (categories) and where (districts). */
@Injectable()
export class ProviderCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
  ) {}

  async getServices(userId: string): Promise<ProviderServiceItem[]> {
    const profile = await this.store.findByUserId(userId);
    return toServiceItems(await this.loadServices(profile.id));
  }

  /**
   * Replaces the category list in one transaction. Only active categories
   * (with an active parent) can be picked; the composite primary key makes
   * duplicates impossible. An ACTIVE provider must keep at least one.
   */
  async setServices(
    userId: string,
    input: SetProviderServicesRequest,
    ipAddress: string | null,
  ): Promise<ProviderServiceItem[]> {
    const services = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      this.store.assertEditable(profile, 'SERVICES');
      if (input.categoryIds.length === 0 && requiresNonEmptyCatalog(profile.status)) {
        throw unprocessable(
          'PROVIDER_PROFILE_INCOMPLETE',
          'Onaylı bir usta en az bir hizmet kategorisi seçmelidir.',
        );
      }

      const available = await tx.serviceCategory.findMany({
        where: {
          id: { in: input.categoryIds },
          isActive: true,
          OR: [{ parentId: null }, { parent: { isActive: true } }],
        },
        select: { id: true },
      });
      const availableIds = new Set(available.map((c) => c.id));
      const unavailable = input.categoryIds.filter((id) => !availableIds.has(id));
      if (unavailable.length > 0) {
        throw unprocessable('CATEGORY_NOT_AVAILABLE', 'Seçilen kategori aktif değil veya yok.', {
          categoryIds: unavailable,
        });
      }

      const existing = await tx.providerService.findMany({
        where: { providerId: profile.id },
        select: { categoryId: true },
      });
      const before = new Set(existing.map((s) => s.categoryId));
      const removed = [...before].filter((id) => !availableIds.has(id));
      const added = input.categoryIds.filter((id) => !before.has(id));

      await tx.providerService.deleteMany({
        where: { providerId: profile.id, categoryId: { in: removed } },
      });
      await tx.providerService.createMany({
        data: added.map((categoryId) => ({ providerId: profile.id, categoryId })),
        skipDuplicates: true,
      });
      await this.reconcileNow(profile.id, tx);

      if (added.length > 0 || removed.length > 0) {
        await this.audit.recordIn(tx, {
          action: 'provider.services_updated',
          actorId: userId,
          entityType: 'provider_profile',
          entityId: profile.id,
          ipAddress,
          metadata: { added, removed },
        });
      }
      return this.loadServices(profile.id, tx);
    });
    return toServiceItems(services);
  }

  async getServiceAreas(userId: string): Promise<ProviderServiceAreaGroup[]> {
    const profile = await this.store.findByUserId(userId);
    return toServiceAreaGroups(await this.loadAreas(profile.id));
  }

  /**
   * Replaces the service districts. Every district must exist, be active
   * and belong to the province it was sent under. District-level areas
   * are the model for now; a radius-based area can be added next to it
   * later without changing this API.
   */
  async setServiceAreas(
    userId: string,
    input: SetProviderServiceAreasRequest,
    ipAddress: string | null,
  ): Promise<ProviderServiceAreaGroup[]> {
    const requested = input.areas.flatMap((a) =>
      a.districtIds.map((districtId) => ({ districtId, provinceId: a.provinceId })),
    );
    const areas = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      this.store.assertEditable(profile, 'SERVICE_AREAS');
      if (requested.length === 0 && requiresNonEmptyCatalog(profile.status)) {
        throw unprocessable(
          'PROVIDER_PROFILE_INCOMPLETE',
          'Onaylı bir usta en az bir hizmet bölgesi seçmelidir.',
        );
      }

      const districts = await tx.district.findMany({
        where: { id: { in: requested.map((r) => r.districtId) } },
        select: { id: true, provinceId: true, isActive: true },
      });
      const byId = new Map(districts.map((d) => [d.id, d]));
      const notFound = requested.filter((r) => !byId.get(r.districtId)?.isActive);
      if (notFound.length > 0) {
        throw unprocessable('DISTRICT_NOT_FOUND', 'Seçilen ilçe bulunamadı veya aktif değil.', {
          districtIds: notFound.map((r) => r.districtId),
        });
      }
      const mismatched = requested.filter(
        (r) => byId.get(r.districtId)?.provinceId !== r.provinceId,
      );
      if (mismatched.length > 0) {
        throw unprocessable('DISTRICT_PROVINCE_MISMATCH', 'İlçe seçilen ile ait değil.', {
          districtIds: mismatched.map((r) => r.districtId),
        });
      }

      const wanted = new Set(requested.map((r) => r.districtId));
      const existing = await tx.providerServiceArea.findMany({
        where: { providerId: profile.id },
        select: { districtId: true },
      });
      const before = new Set(existing.map((a) => a.districtId));
      const removed = [...before].filter((id) => !wanted.has(id));
      const added = [...wanted].filter((id) => !before.has(id));

      await tx.providerServiceArea.deleteMany({
        where: { providerId: profile.id, districtId: { in: removed } },
      });
      await tx.providerServiceArea.createMany({
        data: added.map((districtId) => ({ providerId: profile.id, districtId })),
        skipDuplicates: true,
      });
      await this.reconcileNow(profile.id, tx);

      if (added.length > 0 || removed.length > 0) {
        await this.audit.recordIn(tx, {
          action: 'provider.service_areas_updated',
          actorId: userId,
          entityType: 'provider_profile',
          entityId: profile.id,
          ipAddress,
          metadata: { added: added.length, removed: removed.length, total: wanted.size },
        });
      }
      return this.loadAreas(profile.id, tx);
    });
    return toServiceAreaGroups(areas);
  }

  /**
   * Keeps NOW flags consistent after a catalogue change: no NOW-capable
   * category left ends the NOW preference, and no open category × province
   * pair left ends availability.
   */
  private async reconcileNow(providerId: string, tx: Prisma.TransactionClient): Promise<void> {
    const profile = await tx.providerProfile.findUniqueOrThrow({ where: { id: providerId } });
    if (!profile.nowEnabled && !profile.isAvailableNow) return;
    const nowCapable = await this.store.hasNowCapableService(providerId, tx);
    const stillOpen = nowCapable && (await this.store.hasNowOpenPair(providerId, tx));
    const nowEnabled = profile.nowEnabled && nowCapable;
    const isAvailableNow = profile.isAvailableNow && stillOpen;
    if (nowEnabled !== profile.nowEnabled || isAvailableNow !== profile.isAvailableNow) {
      await tx.providerProfile.update({
        where: { id: providerId },
        data: { nowEnabled, isAvailableNow },
      });
    }
  }

  private async loadServices(providerId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.providerService.findMany({
      where: { providerId },
      include: catalogInclude.services.include,
    });
  }

  private async loadAreas(providerId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.providerServiceArea.findMany({
      where: { providerId },
      include: catalogInclude.serviceAreas.include,
    });
  }
}
