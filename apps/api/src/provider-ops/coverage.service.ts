import { Injectable } from '@nestjs/common';
import type { ProviderCoverage, ProviderServiceRegion } from '@ustago/types';
import type { SetProviderRegions, UpdateCoverageSettings } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { unprocessable } from '../common/http/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderStore } from '../providers/provider.store.js';

type Db = Prisma.TransactionClient | PrismaService;

const regionSelect = {
  id: true,
  kind: true,
  radiusKm: true,
  active: true,
  province: { select: { id: true, name: true } },
  centerDistrict: { select: { id: true, name: true } },
} satisfies Prisma.ProviderServiceRegionSelect;

type RegionRow = Prisma.ProviderServiceRegionGetPayload<{ select: typeof regionSelect }>;

export function toRegion(r: RegionRow): ProviderServiceRegion {
  return {
    id: r.id,
    kind: r.kind,
    province: r.province,
    centerDistrict: r.centerDistrict,
    radiusKm: r.radiusKm,
    active: r.active,
  };
}

/**
 * Where a provider works (docs/adr/0029): single districts (Faz 2), whole
 * provinces, a radius around a centre district, an optional maximum travel
 * distance and the "hizmet merkezi" district that distances are measured
 * from. A home address is never needed or stored for any of it.
 */
@Injectable()
export class CoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
  ) {}

  async getMine(userId: string): Promise<ProviderCoverage> {
    const profile = await this.store.findByUserId(userId);
    return this.coverageOf(profile.id);
  }

  async coverageOf(providerId: string, db: Db = this.prisma): Promise<ProviderCoverage> {
    const [profile, areas, regions] = await Promise.all([
      db.providerProfile.findUniqueOrThrow({
        where: { id: providerId },
        select: {
          maxTravelKm: true,
          serviceCenter: {
            select: { id: true, name: true, province: { select: { id: true, name: true } } },
          },
        },
      }),
      db.providerServiceArea.findMany({
        where: { providerId },
        select: {
          district: {
            select: { id: true, name: true, province: { select: { id: true, name: true } } },
          },
        },
        orderBy: [{ district: { provinceId: 'asc' } }, { district: { name: 'asc' } }],
      }),
      db.providerServiceRegion.findMany({
        where: { providerId, active: true },
        orderBy: [{ provinceId: 'asc' }, { createdAt: 'asc' }],
        select: regionSelect,
      }),
    ]);
    const groups = new Map<number, ProviderCoverage['districts'][number]>();
    for (const { district } of areas) {
      const g = groups.get(district.province.id) ?? { province: district.province, districts: [] };
      g.districts.push({ id: district.id, name: district.name });
      groups.set(district.province.id, g);
    }
    const center = profile.serviceCenter;
    return {
      districts: [...groups.values()],
      regions: regions.map(toRegion),
      maxTravelKm: profile.maxTravelKm,
      serviceCenter: center
        ? { province: center.province, district: { id: center.id, name: center.name } }
        : null,
    };
  }

  /** Replaces the wider regions (PROVINCE / RADIUS) in one transaction. */
  async setRegions(
    userId: string,
    input: SetProviderRegions,
    ipAddress: string | null,
  ): Promise<ProviderCoverage> {
    const providerId = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      this.store.assertEditable(profile, 'SERVICE_AREAS');

      const provinceIds = input.regions.flatMap((r) =>
        r.kind === 'PROVINCE' ? [r.provinceId] : [],
      );
      const centerIds = input.regions.flatMap((r) =>
        r.kind === 'RADIUS' ? [r.centerDistrictId] : [],
      );
      const [provinces, centers] = await Promise.all([
        tx.province.findMany({ where: { id: { in: provinceIds } }, select: { id: true } }),
        tx.district.findMany({
          where: { id: { in: centerIds } },
          select: { id: true, provinceId: true, latitude: true, longitude: true },
        }),
      ]);
      const knownProvinces = new Set(provinces.map((p) => p.id));
      const missingProvince = provinceIds.find((id) => !knownProvinces.has(id));
      if (missingProvince !== undefined) {
        throw unprocessable('PROVINCE_NOT_FOUND', 'İl bulunamadı.', {
          provinceId: missingProvince,
        });
      }
      const centerById = new Map(centers.map((c) => [c.id, c]));

      const data: Prisma.ProviderServiceRegionCreateManyInput[] = input.regions.map((r) => {
        if (r.kind === 'PROVINCE') {
          return { providerId: profile.id, kind: 'PROVINCE', provinceId: r.provinceId };
        }
        const c = centerById.get(r.centerDistrictId);
        if (!c) {
          throw unprocessable('DISTRICT_NOT_FOUND', 'Merkez ilçe bulunamadı.', {
            districtId: r.centerDistrictId,
          });
        }
        if (c.latitude === null || c.longitude === null) {
          throw unprocessable(
            'DISTRICT_HAS_NO_CENTRE',
            'Bu ilçenin yaklaşık merkezi tanımlı değil; ilçe bazında seçim yapın.',
            { districtId: c.id },
          );
        }
        return {
          providerId: profile.id,
          kind: 'RADIUS',
          provinceId: c.provinceId,
          centerDistrictId: c.id,
          radiusKm: r.radiusKm,
          centerLat: c.latitude,
          centerLng: c.longitude,
        };
      });

      // Regions are configuration, not history: the audit log keeps the change.
      await tx.providerServiceRegion.deleteMany({ where: { providerId: profile.id } });
      if (data.length > 0) await tx.providerServiceRegion.createMany({ data });
      await this.audit.recordIn(tx, {
        action: 'provider.service_regions_updated',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: profile.id,
        ipAddress,
        metadata: {
          regions: input.regions.map((r) =>
            r.kind === 'PROVINCE'
              ? { kind: r.kind, provinceId: r.provinceId }
              : { kind: r.kind, centerDistrictId: r.centerDistrictId, radiusKm: r.radiusKm },
          ),
        },
      });
      return profile.id;
    });
    return this.coverageOf(providerId);
  }

  async updateSettings(
    userId: string,
    input: UpdateCoverageSettings,
    ipAddress: string | null,
  ): Promise<ProviderCoverage> {
    const providerId = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      this.store.assertEditable(profile, 'SERVICE_AREAS');
      const center =
        input.serviceCenterDistrictId !== undefined
          ? input.serviceCenterDistrictId
          : profile.serviceCenterDistrictId;
      const maxTravel = input.maxTravelKm !== undefined ? input.maxTravelKm : profile.maxTravelKm;
      if (maxTravel !== null && center === null) {
        // A distance limit is measured from the service centre, so it needs one.
        throw unprocessable(
          'SERVICE_CENTER_REQUIRED',
          'Azami mesafe için önce hizmet merkezi ilçeni seç.',
        );
      }
      if (input.serviceCenterDistrictId) {
        const district = await tx.district.findUnique({
          where: { id: input.serviceCenterDistrictId },
          select: { id: true },
        });
        if (!district) throw unprocessable('DISTRICT_NOT_FOUND', 'İlçe bulunamadı.');
      }
      await tx.providerProfile.update({
        where: { id: profile.id },
        data: {
          ...(input.maxTravelKm !== undefined ? { maxTravelKm: input.maxTravelKm } : {}),
          ...(input.serviceCenterDistrictId !== undefined
            ? { serviceCenterDistrictId: input.serviceCenterDistrictId }
            : {}),
        },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.coverage_settings_updated',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: profile.id,
        ipAddress,
        metadata: { ...input },
      });
      return profile.id;
    });
    return this.coverageOf(providerId);
  }
}
