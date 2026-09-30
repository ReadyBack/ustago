import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SignedUrl, UploadIntentResponse } from '@ustago/types';
import type { CreateRequestPhotoUpload } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { uuidv7 } from '../common/crypto/uuid.js';
import { notFound, serviceUnavailable, unprocessable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { MatchingRepository } from '../matching/matching.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { detectMimeType, extensionFor, SIGNATURE_BYTES } from '../storage/file-signature.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageUnavailableError,
} from '../storage/object-storage.js';

type Tx = Prisma.TransactionClient;

const PHOTO_URL_TTL_SECONDS = 300;
const UPLOADS_PER_HOUR = 30;

const invalidPhoto = (message: string, details?: unknown) =>
  unprocessable('INVALID_REQUEST_PHOTO', message, details);
const uploadNotFound = () => notFound('UPLOAD_NOT_FOUND', 'Yükleme bulunamadı.');
const photoNotFound = () => notFound('PHOTO_NOT_FOUND', 'Fotoğraf bulunamadı.');
const storageUnavailable = () =>
  serviceUnavailable('STORAGE_UNAVAILABLE', 'Fotoğraf yükleme şu anda kullanılamıyor.');

export interface InspectedPhoto {
  uploadId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Optional request photos, on the same private storage and signed-URL flow
 * as verification documents (docs/adr/0011) but with their own purpose,
 * key prefix and JPEG/PNG-only rule. Photos are never public: every view
 * gets a 5-minute signed URL after an authorisation check.
 */
@Injectable()
export class RequestPhotosService {
  private readonly logger = new Logger(RequestPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingRepository,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async createUploadIntent(
    user: AuthUser,
    input: CreateRequestPhotoUpload,
  ): Promise<UploadIntentResponse> {
    const maxSizeBytes = this.env.REQUEST_PHOTO_MAX_BYTES;
    if (input.sizeBytes > maxSizeBytes) throw invalidPhoto('Fotoğraf çok büyük.', { maxSizeBytes });
    await this.rateLimit.enforce({
      bucket: 'request-photo:user',
      subject: user.id,
      limit: UPLOADS_PER_HOUR,
      windowSeconds: 3600,
    });
    const storageKey = `request-photos/${user.id}/${uuidv7()}.${extensionFor(input.mimeType)}`;
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
        purpose: 'SERVICE_REQUEST_PHOTO',
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
   * Checks uploads before the request transaction: owned by the caller,
   * unconsumed, unexpired, present in storage, within the size limit and
   * really JPEG/PNG (magic bytes). Bad files are deleted.
   */
  async inspect(userId: string, uploadIds: readonly string[]): Promise<InspectedPhoto[]> {
    if (uploadIds.length === 0) return [];
    const intents = await this.prisma.uploadIntent.findMany({
      where: {
        id: { in: [...uploadIds] },
        userId,
        purpose: 'SERVICE_REQUEST_PHOTO',
        consumedAt: null,
      },
    });
    const byId = new Map(intents.map((i) => [i.id, i]));
    const result: InspectedPhoto[] = [];
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
        throw invalidPhoto('Fotoğraf boş veya izin verilen boyutu aşıyor.');
      }
      const detected = detectMimeType(
        await this.storage.readPrefix(intent.storageKey, SIGNATURE_BYTES),
      );
      if ((detected !== 'image/jpeg' && detected !== 'image/png') || detected !== intent.declaredMimeType) {
        await this.deleteQuietly(intent.storageKey);
        throw invalidPhoto('Fotoğraf JPEG veya PNG olmalı.');
      }
      result.push({ uploadId: id, storageKey: intent.storageKey, mimeType: detected, sizeBytes: info.size });
    }
    return result;
  }

  /** Consumes the uploads (single use, race-safe) and attaches them. */
  async attachIn(
    tx: Tx,
    requestId: string,
    photos: readonly InspectedPhoto[],
    startOrder: number,
  ): Promise<void> {
    for (const [index, photo] of photos.entries()) {
      const consumed = await tx.uploadIntent.updateMany({
        where: { id: photo.uploadId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count === 0) throw uploadNotFound();
      await tx.serviceRequestPhoto.create({
        data: {
          serviceRequestId: requestId,
          uploadIntentId: photo.uploadId,
          storageKey: photo.storageKey,
          mimeType: photo.mimeType,
          sizeBytes: photo.sizeBytes,
          sortOrder: startOrder + index,
        },
      });
    }
  }

  /**
   * Signed view URL for: the customer who owns the request, a provider who
   * may currently quote on it or already has a quote on it, and admins.
   * Everyone else gets 404, as if the photo did not exist.
   */
  async viewUrl(
    user: AuthUser,
    requestId: string,
    photoId: string,
    ipAddress: string | null,
  ): Promise<SignedUrl> {
    const photo = await this.prisma.serviceRequestPhoto.findFirst({
      where: { id: photoId, serviceRequestId: requestId },
      include: {
        serviceRequest: { select: { customer: { select: { userId: true } } } },
      },
    });
    if (!photo) throw photoNotFound();
    if (!(await this.canView(user, requestId, photo.serviceRequest.customer.userId))) {
      throw photoNotFound();
    }
    let signed;
    try {
      signed = await this.storage.createDownloadUrl(photo.storageKey, PHOTO_URL_TTL_SECONDS);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    if (user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN')) {
      await this.audit.record({
        action: 'service_request.photo_accessed',
        actorId: user.id,
        entityType: 'service_request_photo',
        entityId: photo.id,
        ipAddress,
      });
    }
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  private async canView(user: AuthUser, requestId: string, ownerId: string): Promise<boolean> {
    if (ownerId === user.id) return true;
    if (user.roles.includes('ADMIN') || user.roles.includes('SUPER_ADMIN')) return true;
    const provider = await this.prisma.providerProfile.findFirst({
      where: { userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!provider) return false;
    const quoted = await this.prisma.quote.count({
      where: { serviceRequestId: requestId, providerId: provider.id },
    });
    return quoted > 0 || this.matching.isEligible(this.prisma, provider.id, requestId);
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not delete a stored object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
