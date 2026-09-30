import { Injectable } from '@nestjs/common';
import type { UploadIntentResponse } from '@ustago/types';
import type { ImageUploadIntent } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { notFound } from '../common/http/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ImageUploadsService, storageUnavailable } from './image-uploads.service.js';

/**
 * Lifetime of signed URLs for images shown on profiles and cards. Longer
 * than document URLs because they are embedded in pages that stay open;
 * the objects stay private and the key is never exposed.
 */
export const PUBLIC_IMAGE_URL_TTL_SECONDS = 3600;

export const providerNotFound = () => notFound('PROVIDER_NOT_FOUND', 'Usta profili bulunamadı.');

/**
 * Provider profile photo (Faz 7). `ProviderProfile.photoStorageKey` points
 * at a private object; every reader turns it into a signed URL with
 * `photoUrl()`.
 */
@Injectable()
export class ProviderMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: ImageUploadsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Signed URL of a provider's profile photo, or null (no photo, or
   * storage unavailable). Use this for every customer-facing card/profile.
   */
  photoUrl(photoStorageKey: string | null | undefined): Promise<string | null> {
    return this.uploads.signedUrl(photoStorageKey, PUBLIC_IMAGE_URL_TTL_SECONDS);
  }

  /** Batch variant: provider id → signed URL (or null). */
  async photoUrls(
    rows: readonly { id: string; photoStorageKey: string | null }[],
  ): Promise<Map<string, string | null>> {
    const urls = await Promise.all(rows.map((r) => this.photoUrl(r.photoStorageKey)));
    return new Map(rows.map((r, i) => [r.id, urls[i] ?? null]));
  }

  async createPhotoUploadIntent(
    user: AuthUser,
    input: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    await this.ownProvider(user.id);
    return this.uploads.createIntent(user, 'PROFILE_PHOTO', input);
  }

  async setPhoto(
    user: AuthUser,
    uploadId: string,
    ipAddress: string | null,
  ): Promise<{ photoUrl: string }> {
    const provider = await this.ownProvider(user.id);
    const [image] = await this.uploads.inspect(user.id, 'PROFILE_PHOTO', [uploadId]);
    if (!image) throw new Error('inspect returned no image');
    const previous = await this.prisma.$transaction(async (tx) => {
      await this.uploads.consumeIn(tx, image.uploadId);
      const [locked] = await tx.$queryRaw<{ photo_storage_key: string | null }[]>`
        SELECT photo_storage_key FROM provider_profiles WHERE id = ${provider.id}::uuid FOR UPDATE`;
      await tx.providerProfile.update({
        where: { id: provider.id },
        data: { photoStorageKey: image.storageKey },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.photo_updated',
        actorId: user.id,
        entityType: 'provider_profile',
        entityId: provider.id,
        ipAddress,
        metadata: { uploadId: image.uploadId, mimeType: image.mimeType },
      });
      return locked?.photo_storage_key ?? null;
    });
    if (previous && previous !== image.storageKey) await this.uploads.deleteQuietly(previous);
    const photoUrl = await this.photoUrl(image.storageKey);
    // Saved, but storage stopped answering between the check and signing.
    if (!photoUrl) throw storageUnavailable();
    return { photoUrl };
  }

  async deletePhoto(user: AuthUser, ipAddress: string | null): Promise<void> {
    const provider = await this.ownProvider(user.id);
    const previous = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ photo_storage_key: string | null }[]>`
        SELECT photo_storage_key FROM provider_profiles WHERE id = ${provider.id}::uuid FOR UPDATE`;
      const key = locked?.photo_storage_key ?? null;
      if (!key) return null;
      await tx.providerProfile.update({
        where: { id: provider.id },
        data: { photoStorageKey: null },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.photo_removed',
        actorId: user.id,
        entityType: 'provider_profile',
        entityId: provider.id,
        ipAddress,
      });
      return key;
    });
    if (previous) await this.uploads.deleteQuietly(previous);
  }

  private async ownProvider(userId: string): Promise<{ id: string }> {
    const provider = await this.prisma.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw providerNotFound();
    return provider;
  }
}
