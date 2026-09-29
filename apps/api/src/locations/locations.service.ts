import { Injectable } from '@nestjs/common';
import type { District, Province } from '@ustago/types';

import { AuditService } from '../audit/audit.service.js';
import { notFound } from '../common/http/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PROVINCE_SELECT = { id: true, name: true, slug: true, isActive: true } as const;
const NOT_FOUND = () => notFound('PROVINCE_NOT_FOUND', 'İl bulunamadı.');

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All 81 provinces by plate code; `onlyActive` limits to open markets. */
  listProvinces(onlyActive: boolean): Promise<Province[]> {
    return this.prisma.province.findMany({
      where: onlyActive ? { isActive: true } : {},
      orderBy: { id: 'asc' },
      select: PROVINCE_SELECT,
    });
  }

  async listDistricts(provinceId: number): Promise<District[]> {
    if (!(await this.prisma.province.findUnique({ where: { id: provinceId } }))) throw NOT_FOUND();
    return this.prisma.district.findMany({
      where: { provinceId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, provinceId: true, name: true, slug: true, isActive: true },
    });
  }

  async setProvinceActive(
    actorId: string,
    provinceId: number,
    isActive: boolean,
    ipAddress: string | null,
  ): Promise<Province> {
    if (!(await this.prisma.province.findUnique({ where: { id: provinceId } }))) throw NOT_FOUND();
    return this.prisma.$transaction(async (tx) => {
      const province = await tx.province.update({
        where: { id: provinceId },
        data: { isActive },
        select: PROVINCE_SELECT,
      });
      await this.audit.recordIn(tx, {
        action: 'province.updated',
        actorId,
        entityType: 'province',
        entityId: String(provinceId),
        ipAddress,
        metadata: { isActive },
      });
      return province;
    });
  }
}
