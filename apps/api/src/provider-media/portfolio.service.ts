import { Injectable } from '@nestjs/common';
import type { PortfolioItem, UploadIntentResponse } from '@ustago/types';
import {
  type CreatePortfolioItem,
  type ImageUploadIntent,
  MAX_PORTFOLIO_ITEMS,
  MAX_PORTFOLIO_MEDIA_PER_ITEM,
  type ReorderPortfolio,
  type UpdatePortfolioItem,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { notFound, unprocessable } from '../common/http/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImageUploadsService } from './image-uploads.service.js';
import { PUBLIC_IMAGE_URL_TTL_SECONDS, providerNotFound } from './provider-media.service.js';

const itemNotFound = () => notFound('PORTFOLIO_ITEM_NOT_FOUND', 'Portföy öğesi bulunamadı.');

const portfolioInclude = {
  category: { select: { id: true, slug: true, name: true, icon: true } },
  media: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, kind: true, mimeType: true, storageKey: true },
  },
} satisfies Prisma.ProviderPortfolioItemInclude;

type ItemRow = Prisma.ProviderPortfolioItemGetPayload<{ include: typeof portfolioInclude }>;

const ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

/**
 * Provider portfolio (Faz 7): past work with photos, shown on the public
 * profile. Each item needs the upload checklist (`consentConfirmed`: no
 * customer faces, addresses, documents or plates; the provider may publish
 * the photos). Items are soft-deleted; their files are removed from
 * storage best effort. Another provider's item is a 404.
 */
@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: ImageUploadsService,
    private readonly audit: AuditService,
  ) {}

  async createUploadIntent(
    user: AuthUser,
    input: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    await this.ownProviderId(user.id);
    return this.uploads.createIntent(user, 'PORTFOLIO_IMAGE', input);
  }

  async listMine(user: AuthUser): Promise<PortfolioItem[]> {
    const providerId = await this.ownProviderId(user.id);
    return this.list(providerId);
  }

  /**
   * Public portfolio of a provider. The caller decides whether the provider
   * is publicly listed (PublicProvidersService does).
   */
  async publicPortfolio(providerId: string): Promise<PortfolioItem[]> {
    return this.list(providerId);
  }

  async create(
    user: AuthUser,
    input: CreatePortfolioItem,
    ipAddress: string | null,
  ): Promise<PortfolioItem> {
    const providerId = await this.ownProviderId(user.id);
    // The schema already requires the literal; kept as a server-side guard.
    if (input.consentConfirmed !== true) {
      throw unprocessable('PORTFOLIO_CONSENT_REQUIRED', 'Fotoğrafların paylaşım onayı gerekli.');
    }
    if (input.uploadIds.length > MAX_PORTFOLIO_MEDIA_PER_ITEM) {
      throw unprocessable(
        'PORTFOLIO_MEDIA_LIMIT',
        `Bir öğeye en fazla ${MAX_PORTFOLIO_MEDIA_PER_ITEM} fotoğraf eklenebilir.`,
      );
    }
    const categoryId = await this.checkCategory(input.categoryId);
    const images = await this.uploads.inspect(user.id, 'PORTFOLIO_IMAGE', input.uploadIds);
    const id = await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent creates so the item limit cannot be overrun.
      await tx.$queryRaw`SELECT id FROM provider_profiles WHERE id = ${providerId}::uuid FOR UPDATE`;
      const live = await tx.providerPortfolioItem.aggregate({
        where: { providerId, deletedAt: null },
        _count: { _all: true },
        _max: { sortOrder: true },
      });
      if (live._count._all >= MAX_PORTFOLIO_ITEMS) {
        throw unprocessable(
          'PORTFOLIO_LIMIT_REACHED',
          `Portföyde en fazla ${MAX_PORTFOLIO_ITEMS} öğe olabilir.`,
          { max: MAX_PORTFOLIO_ITEMS },
        );
      }
      const item = await tx.providerPortfolioItem.create({
        data: {
          providerId,
          categoryId,
          title: input.title,
          description: input.description ?? null,
          sortOrder: (live._max.sortOrder ?? -1) + 1,
          consentConfirmedAt: new Date(),
        },
      });
      for (const [index, image] of images.entries()) {
        await this.uploads.consumeIn(tx, image.uploadId);
        await tx.portfolioMedia.create({
          data: {
            itemId: item.id,
            uploadIntentId: image.uploadId,
            storageKey: image.storageKey,
            kind: 'IMAGE',
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            sortOrder: index,
          },
        });
      }
      await this.audit.recordIn(tx, {
        action: 'portfolio.item_created',
        actorId: user.id,
        entityType: 'provider_portfolio_item',
        entityId: item.id,
        ipAddress,
        metadata: { providerId, mediaCount: images.length, consentConfirmed: true },
      });
      return item.id;
    });
    return this.getOne(providerId, id);
  }

  async update(
    user: AuthUser,
    id: string,
    input: UpdatePortfolioItem,
    ipAddress: string | null,
  ): Promise<PortfolioItem> {
    const providerId = await this.ownProviderId(user.id);
    await this.findOwn(providerId, id);
    const categoryId =
      input.categoryId === undefined ? undefined : await this.checkCategory(input.categoryId);
    await this.prisma.$transaction(async (tx) => {
      await tx.providerPortfolioItem.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(categoryId !== undefined ? { categoryId } : {}),
        },
      });
      await this.audit.recordIn(tx, {
        action: 'portfolio.item_updated',
        actorId: user.id,
        entityType: 'provider_portfolio_item',
        entityId: id,
        ipAddress,
        metadata: { providerId, changed: Object.keys(input) },
      });
    });
    return this.getOne(providerId, id);
  }

  async remove(user: AuthUser, id: string, ipAddress: string | null): Promise<void> {
    const providerId = await this.ownProviderId(user.id);
    const item = await this.findOwn(providerId, id);
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.providerPortfolioItem.updateMany({
        where: { id, providerId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (deleted.count === 0) throw itemNotFound();
      await this.audit.recordIn(tx, {
        action: 'portfolio.item_deleted',
        actorId: user.id,
        entityType: 'provider_portfolio_item',
        entityId: id,
        ipAddress,
        metadata: { providerId, mediaCount: item.media.length },
      });
    });
    // Rows stay (soft delete, audit trail); the files are removed.
    await Promise.all(item.media.map((m) => this.uploads.deleteQuietly(m.storageKey)));
  }

  /** The full list of live items in the new order (a stale list is refused). */
  async reorder(
    user: AuthUser,
    input: ReorderPortfolio,
    ipAddress: string | null,
  ): Promise<PortfolioItem[]> {
    const providerId = await this.ownProviderId(user.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM provider_profiles WHERE id = ${providerId}::uuid FOR UPDATE`;
      const live = await tx.providerPortfolioItem.findMany({
        where: { providerId, deletedAt: null },
        select: { id: true },
      });
      const liveIds = new Set(live.map((i) => i.id));
      if (input.itemIds.some((itemId) => !liveIds.has(itemId))) throw itemNotFound();
      if (input.itemIds.length !== liveIds.size) {
        throw unprocessable(
          'PORTFOLIO_ORDER_INCOMPLETE',
          'Sıralama için portföydeki tüm öğeleri gönderin.',
          { expected: liveIds.size },
        );
      }
      for (const [index, itemId] of input.itemIds.entries()) {
        await tx.providerPortfolioItem.update({
          where: { id: itemId },
          data: { sortOrder: index },
        });
      }
      await this.audit.recordIn(tx, {
        action: 'portfolio.reordered',
        actorId: user.id,
        entityType: 'provider_profile',
        entityId: providerId,
        ipAddress,
        metadata: { itemIds: input.itemIds },
      });
    });
    return this.list(providerId);
  }

  private async list(providerId: string): Promise<PortfolioItem[]> {
    const rows = await this.prisma.providerPortfolioItem.findMany({
      where: { providerId, deletedAt: null },
      include: portfolioInclude,
      orderBy: [...ORDER],
      take: MAX_PORTFOLIO_ITEMS,
    });
    return Promise.all(rows.map((r) => this.toItem(r)));
  }

  private async getOne(providerId: string, id: string): Promise<PortfolioItem> {
    return this.toItem(await this.findOwn(providerId, id));
  }

  private async findOwn(providerId: string, id: string): Promise<ItemRow> {
    const row = await this.prisma.providerPortfolioItem.findFirst({
      where: { id, providerId, deletedAt: null },
      include: portfolioInclude,
    });
    if (!row) throw itemNotFound();
    return row;
  }

  private async toItem(row: ItemRow): Promise<PortfolioItem> {
    const urls = await Promise.all(
      row.media.map((m) => this.uploads.signedUrl(m.storageKey, PUBLIC_IMAGE_URL_TTL_SECONDS)),
    );
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      sortOrder: row.sortOrder,
      // A picture that cannot be signed right now is left out, not broken.
      media: row.media.flatMap((m, i) => {
        const url = urls[i];
        return url ? [{ id: m.id, kind: 'IMAGE' as const, mimeType: m.mimeType, url }] : [];
      }),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async checkCategory(categoryId: string | null | undefined): Promise<string | null> {
    if (!categoryId) return null;
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) throw unprocessable('CATEGORY_NOT_FOUND', 'Kategori bulunamadı.');
    return category.id;
  }

  private async ownProviderId(userId: string): Promise<string> {
    const provider = await this.prisma.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw providerNotFound();
    return provider.id;
  }
}
