import { Injectable } from '@nestjs/common';
import type { ServiceCategory, ServiceCategoryNode } from '@ustago/types';
import type { CreateCategoryRequest, UpdateCategoryRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { badRequest, conflict, notFound } from '../common/http/errors.js';
import type { ServiceCategory as CategoryRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const NOT_FOUND = () => notFound('CATEGORY_NOT_FOUND', 'Kategori bulunamadı.');
const ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }] as const;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Active top-level categories with their active sub-categories. */
  async listActiveTree(): Promise<ServiceCategoryNode[]> {
    const roots = await this.prisma.serviceCategory.findMany({
      where: { parentId: null, isActive: true },
      orderBy: [...ORDER],
      include: { children: { where: { isActive: true }, orderBy: [...ORDER] } },
    });
    return roots.map((root) => ({ ...toCategory(root), children: root.children.map(toCategory) }));
  }

  async getActiveBySlug(slug: string): Promise<ServiceCategoryNode> {
    // A sub-category is only visible while its parent is active too.
    const category = await this.prisma.serviceCategory.findFirst({
      where: {
        slug,
        isActive: true,
        OR: [{ parentId: null }, { parent: { isActive: true } }],
      },
      include: { children: { where: { isActive: true }, orderBy: [...ORDER] } },
    });
    if (!category) throw NOT_FOUND();
    return { ...toCategory(category), children: category.children.map(toCategory) };
  }

  /** Categories are at most two levels deep (category → sub-category). */
  async create(
    actorId: string,
    input: CreateCategoryRequest,
    ipAddress: string | null,
  ): Promise<ServiceCategory> {
    if (input.parentId) {
      const parent = await this.prisma.serviceCategory.findUnique({
        where: { id: input.parentId },
      });
      if (!parent) throw badRequest('PARENT_NOT_FOUND', 'Üst kategori bulunamadı.');
      if (parent.parentId) {
        throw badRequest('CATEGORY_TOO_DEEP', 'Kategoriler en fazla iki seviye olabilir.');
      }
    }
    if (await this.prisma.serviceCategory.findUnique({ where: { slug: input.slug } })) {
      throw conflict('CATEGORY_SLUG_TAKEN', 'Bu slug başka bir kategoride kullanılıyor.');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const category = await tx.serviceCategory.create({
        data: {
          slug: input.slug,
          name: input.name,
          parentId: input.parentId ?? null,
          description: input.description ?? null,
          icon: input.icon ?? null,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
          supportsNow: input.supportsNow,
          supportsQuote: input.supportsQuote,
        },
      });
      await this.audit.recordIn(tx, {
        action: 'category.created',
        actorId,
        entityType: 'service_category',
        entityId: category.id,
        ipAddress,
        metadata: { slug: category.slug },
      });
      return category;
    });
    return toCategory(created);
  }

  async update(
    actorId: string,
    id: string,
    input: UpdateCategoryRequest,
    ipAddress: string | null,
  ): Promise<ServiceCategory> {
    if (!(await this.prisma.serviceCategory.findUnique({ where: { id } }))) throw NOT_FOUND();
    const updated = await this.prisma.$transaction(async (tx) => {
      const category = await tx.serviceCategory.update({ where: { id }, data: input });
      await this.audit.recordIn(tx, {
        action: 'category.updated',
        actorId,
        entityType: 'service_category',
        entityId: id,
        ipAddress,
        metadata: { changes: Object.keys(input) },
      });
      return category;
    });
    return toCategory(updated);
  }
}

function toCategory(c: CategoryRow): ServiceCategory {
  return {
    id: c.id,
    parentId: c.parentId,
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    supportsNow: c.supportsNow,
    supportsQuote: c.supportsQuote,
  };
}
