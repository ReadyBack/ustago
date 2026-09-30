import { Inject, Injectable, Logger } from '@nestjs/common';
import type { UploadIntentResponse } from '@ustago/types';
import type { ImageUploadIntent } from '@ustago/validation';

import type { AuthUser } from '../common/auth/auth-user.js';
import { uuidv7 } from '../common/crypto/uuid.js';
import { notFound, serviceUnavailable, unprocessable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { Prisma, UploadPurpose } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { detectMimeType, extensionFor, SIGNATURE_BYTES } from '../storage/file-signature.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageUnavailableError,
} from '../storage/object-storage.js';

type Tx = Prisma.TransactionClient;

/** Purposes handled here, with the storage key prefix of each. */
export type ProviderImagePurpose = Extract<UploadPurpose, 'PORTFOLIO_IMAGE' | 'PROFILE_PHOTO'>;

const KEY_PREFIX: Record<ProviderImagePurpose, string> = {
  PORTFOLIO_IMAGE: 'portfolio',
  PROFILE_PHOTO: 'profile-photos',
};

const UPLOADS_PER_HOUR = 60;

export interface InspectedImage {
  uploadId: string;
  storageKey: string;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
}

export const invalidImage = (message: string, details?: unknown) =>
  unprocessable('INVALID_IMAGE', message, details);
export const uploadNotFound = () => notFound('UPLOAD_NOT_FOUND', 'Yükleme bulunamadı.');
export const storageUnavailable = () =>
  serviceUnavailable('STORAGE_UNAVAILABLE', 'Fotoğraf yükleme şu anda kullanılamıyor.');

/**
 * Provider images (portfolio and profile photo) on private object storage
 * (docs/adr/0011), the same flow as request photos: a short-lived signed
 * PUT, then a server-side check of owner, expiry, size and the real type
 * from the magic bytes (JPEG/PNG only; SVG, HTML, PDF are refused and
 * deleted). Files are only ever served through signed GET URLs.
 */
@Injectable()
export class ImageUploadsService {
  private readonly logger = new Logger(ImageUploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rateLimit: RateLimitService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get maxBytes(): number {
    return this.env.MEDIA_IMAGE_MAX_BYTES;
  }

  async createIntent(
    user: AuthUser,
    purpose: ProviderImagePurpose,
    input: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    const maxSizeBytes = this.maxBytes;
    if (input.sizeBytes > maxSizeBytes) throw invalidImage('Fotoğraf çok büyük.', { maxSizeBytes });
    await this.rateLimit.enforce({
      bucket: 'provider-image:user',
      subject: user.id,
      limit: UPLOADS_PER_HOUR,
      windowSeconds: 3600,
    });
    const storageKey = `${KEY_PREFIX[purpose]}/${user.id}/${uuidv7()}.${extensionFor(input.mimeType)}`;
    let signed;
    try {
      signed = await this.storage.createUploadUrl(storageKey, {
        contentType: input.mimeType,
        maxBytes: maxSizeBytes,
        expiresInSeconds: this.env.UPLOAD_URL_TTL_SECONDS,
      });
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    const intent = await this.prisma.uploadIntent.create({
      data: {
        userId: user.id,
        purpose,
        storageKey,
        declaredMimeType: input.mimeType,
        declaredSize: input.sizeBytes,
        maxSizeBytes,
        originalFileName: input.fileName ?? null,
        expiresAt: signed.expiresAt,
      },
    });
    return {
      uploadId: intent.id,
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
      maxSizeBytes,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /**
   * Checks uploads before they are attached: owned by the caller, of this
   * purpose, unconsumed, unexpired, present, within the size limit and
   * really JPEG/PNG. A bad file is deleted from storage.
   */
  async inspect(
    userId: string,
    purpose: ProviderImagePurpose,
    uploadIds: readonly string[],
  ): Promise<InspectedImage[]> {
    if (uploadIds.length === 0) return [];
    const intents = await this.prisma.uploadIntent.findMany({
      where: { id: { in: [...uploadIds] }, userId, purpose, consumedAt: null },
    });
    const byId = new Map(intents.map((i) => [i.id, i]));
    const result: InspectedImage[] = [];
    for (const id of uploadIds) {
      const intent = byId.get(id);
      if (!intent) throw uploadNotFound();
      if (intent.expiresAt <= new Date()) {
        throw unprocessable('UPLOAD_EXPIRED', 'Yükleme süresi doldu. Lütfen yeniden yükleyin.');
      }
      let info;
      try {
        info = await this.storage.head(intent.storageKey);
      } catch (error) {
        if (error instanceof StorageUnavailableError) throw storageUnavailable();
        throw error;
      }
      if (!info) throw unprocessable('UPLOAD_NOT_COMPLETED', 'Fotoğraf henüz yüklenmemiş.');
      if (info.size === 0 || info.size > intent.maxSizeBytes) {
        await this.deleteQuietly(intent.storageKey);
        throw invalidImage('Fotoğraf boş veya izin verilen boyutu aşıyor.');
      }
      const detected = detectMimeType(
        await this.storage.readPrefix(intent.storageKey, SIGNATURE_BYTES),
      );
      if (
        (detected !== 'image/jpeg' && detected !== 'image/png') ||
        detected !== intent.declaredMimeType
      ) {
        await this.deleteQuietly(intent.storageKey);
        throw invalidImage('Fotoğraf JPEG veya PNG olmalı.');
      }
      result.push({
        uploadId: id,
        storageKey: intent.storageKey,
        mimeType: detected,
        sizeBytes: info.size,
      });
    }
    return result;
  }

  /** Marks an upload used, once (a concurrent second use fails with 404). */
  async consumeIn(tx: Tx, uploadId: string): Promise<void> {
    const consumed = await tx.uploadIntent.updateMany({
      where: { id: uploadId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw uploadNotFound();
  }

  /**
   * Signed GET URL, or null when storage is disabled or fails: a profile
   * page still renders without its pictures.
   */
  async signedUrl(key: string | null | undefined, ttlSeconds: number): Promise<string | null> {
    if (!key) return null;
    try {
      return (await this.storage.createDownloadUrl(key, ttlSeconds)).url;
    } catch (error) {
      if (!(error instanceof StorageUnavailableError)) {
        this.logger.warn(
          `Could not sign an image URL: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }

  /** Best effort: a leftover object is garbage, never a visible file. */
  async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not delete a stored object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
