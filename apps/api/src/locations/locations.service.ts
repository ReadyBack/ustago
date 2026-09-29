import { Injectable } from '@nestjs/common';
import type { District, Province, ProvinceCategorySetting } from '@ustago/types';
import type { UpdateProvinceCategoryRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { notFound, unprocessable } from '../common/http/errors.js';
import { effectiveProvinceCategory } from '../providers/domain/now-availability.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PROVINCE_SELECT = { id: true, name: true, slug: true, isActive: true } as const;
const NOT_FOUND = () => notFound('PROVINCE_NOT_FOUND', 'İl bulunamadı.');
const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  isActive: true,
  supportsNow: true,
  sortOrder: true,
  parent: { select: { isActive: true } },
} as const;

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  supportsNow: boolean;
  parent: { isActive: boolean } | null;
}

function toSetting(
  provinceId: number,
  category: CategoryRow,
  override: { isActive: boolean; nowEnabled: boolean } | null,
): ProvinceCategorySetting {
  const categoryActive = category.isActive && (category.parent?.isActive ?? true);
  const effective = effectiveProvinceCategory(
    { isActive: categoryActive, supportsNow: category.supportsNow },
    override,
  );
  return {
    provinceId,
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      supportsNow: category.supportsNow,
    },
    ...effective,
  };
}

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

  async listDistricts(provinceId: number, includeInactive = false): Promise<District[]> {
    if (!(await this.prisma.province.findUnique({ where: { id: provinceId } }))) throw NOT_FOUND();
    return this.prisma.district.findMany({
      where: includeInactive ? { provinceId } : { provinceId, isActive: true },
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

  /**
   * Category settings in a province: the category defaults merged with the
   * admin's ProvinceCategory override. Public callers see only categories
   * that are effectively open there; admins can list all of them.
   */
  async listProvinceCategories(
    provinceId: number,
    includeInactive: boolean,
  ): Promise<ProvinceCategorySetting[]> {
    if (!(await this.prisma.province.findUnique({ where: { id: provinceId } }))) throw NOT_FOUND();
    const [categories, overrides] = await Promise.all([
      this.prisma.serviceCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: CATEGORY_SELECT,
      }),
      this.prisma.provinceCategory.findMany({ where: { provinceId } }),
    ]);
    const byCategory = new Map(overrides.map((o) => [o.categoryId, o]));
    const settings = categories.map((c) => toSetting(provinceId, c, byCategory.get(c.id) ?? null));
    return includeInactive ? settings : settings.filter((s) => s.isActive);
  }

  /**
   * Admin override for one category in one province ("Adana: Klima açık,
   * NOW açık"). NOW can only be enabled for NOW-capable categories.
   * Providers are not touched here: dispatch always re-evaluates the
   * category × province pair, so closing NOW takes effect immediately.
   */
  async setProvinceCategory(
    actorId: string,
    provinceId: number,
    categoryId: string,
    input: UpdateProvinceCategoryRequest,
    ipAddress: string | null,
  ): Promise<ProvinceCategorySetting> {
    if (!(await this.prisma.province.findUnique({ where: { id: provinceId } }))) throw NOT_FOUND();
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: categoryId },
      select: CATEGORY_SELECT,
    });
    if (!category) throw notFound('CATEGORY_NOT_FOUND', 'Kategori bulunamadı.');
    if (input.nowEnabled && !category.supportsNow) {
      throw unprocessable(
        'NOW_CATEGORY_NOT_SUPPORTED',
        'Bu kategori Acil Usta (NOW) hizmetini desteklemiyor.',
      );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.provinceCategory.upsert({
        where: { provinceId_categoryId: { provinceId, categoryId } },
        create: { provinceId, categoryId, ...input },
        update: input,
      });
      await this.audit.recordIn(tx, {
        action: 'province_category.updated',
        actorId,
        entityType: 'province_category',
        entityId: `${provinceId}:${categoryId}`,
        ipAddress,
        metadata: { provinceId, categoryId, ...input },
      });
      return saved;
    });
    return toSetting(provinceId, category, row);
  }
}
