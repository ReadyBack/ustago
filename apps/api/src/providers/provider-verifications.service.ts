import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProviderVerification, UploadIntentResponse } from '@ustago/types';
import type { CreateUploadIntentRequest, SubmitVerificationRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { uuidv7 } from '../common/crypto/uuid.js';
import { conflict, notFound, serviceUnavailable, unprocessable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { detectMimeType, extensionFor, SIGNATURE_BYTES } from '../storage/file-signature.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageUnavailableError,
} from '../storage/object-storage.js';
import { toProviderVerification } from './provider.mappers.js';
import { ProviderStore } from './provider.store.js';

const invalidFile = (message: string, details?: unknown) =>
  unprocessable('INVALID_VERIFICATION_FILE', message, details);
const uploadNotFound = () => notFound('UPLOAD_NOT_FOUND', 'Yükleme bulunamadı.');
const storageUnavailable = () =>
  serviceUnavailable('STORAGE_UNAVAILABLE', 'Belge yükleme şu anda kullanılamıyor.');

/** Uploads per user per hour; generous for retries, tight for abuse. */
const UPLOAD_INTENTS_PER_HOUR = 20;

/**
 * Provider side of document verification (docs/adr/0011):
 * 1. upload intent → random private key + short-lived signed PUT URL;
 * 2. the client uploads straight to storage;
 * 3. submit → the server checks size and magic bytes, then records a
 *    PENDING verification for admin review.
 */
@Injectable()
export class ProviderVerificationsService {
  private readonly logger = new Logger(ProviderVerificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(userId: string): Promise<ProviderVerification[]> {
    const profile = await this.store.findByUserId(userId);
    const rows = await this.prisma.providerVerification.findMany({
      where: { providerId: profile.id },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toProviderVerification);
  }

  async createUploadIntent(
    user: AuthUser,
    input: CreateUploadIntentRequest,
    ipAddress: string | null,
  ): Promise<UploadIntentResponse> {
    const profile = await this.store.findByUserId(user.id);
    this.store.assertEditable(profile, 'VERIFICATIONS');
    const maxSizeBytes = this.env.VERIFICATION_MAX_FILE_BYTES;
    if (input.sizeBytes > maxSizeBytes) {
      throw invalidFile('Dosya çok büyük.', { maxSizeBytes });
    }
    await this.rateLimit.enforce({
      bucket: 'upload-intent:user',
      subject: user.id,
      limit: UPLOAD_INTENTS_PER_HOUR,
      windowSeconds: 3600,
    });

    // The key never contains the client's file name (no path traversal,
    // no personal data in object names).
    const storageKey = `verifications/${profile.id}/${uuidv7()}.${extensionFor(input.mimeType)}`;
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
        purpose: 'PROVIDER_VERIFICATION',
        storageKey,
        declaredMimeType: input.mimeType,
        declaredSize: input.sizeBytes,
        maxSizeBytes,
        originalFileName: input.fileName,
        expiresAt: signed.expiresAt,
      },
    });
    await this.audit.record({
      action: 'verification.upload_intent_created',
      actorId: user.id,
      entityType: 'upload_intent',
      entityId: intent.id,
      ipAddress,
      metadata: { type: input.type, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
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

  async submit(
    user: AuthUser,
    input: SubmitVerificationRequest,
    ipAddress: string | null,
  ): Promise<ProviderVerification> {
    const intent = await this.prisma.uploadIntent.findFirst({
      where: {
        id: input.uploadId,
        userId: user.id,
        purpose: 'PROVIDER_VERIFICATION',
        consumedAt: null,
      },
    });
    if (!intent) throw uploadNotFound();
    if (intent.expiresAt <= new Date()) {
      throw unprocessable('UPLOAD_EXPIRED', 'Yükleme süresi doldu. Lütfen yeniden yükleyin.');
    }

    const mimeType = await this.inspectUpload(
      intent.storageKey,
      intent.declaredMimeType,
      intent.maxSizeBytes,
    );

    let replacedKey: string | null = null;
    let verification;
    try {
      verification = await this.prisma.$transaction(async (tx) => {
        const profile = await this.store.lockByUserId(tx, user.id);
        this.store.assertEditable(profile, 'VERIFICATIONS');
        if (!intent.storageKey.startsWith(`verifications/${profile.id}/`)) throw uploadNotFound();

        const pending = await tx.providerVerification.findFirst({
          where: { providerId: profile.id, type: input.type, status: 'PENDING' },
        });
        if (pending) {
          // Before submission a document can simply be replaced; once the
          // provider is live, a pending review must finish first.
          if (profile.status !== 'DRAFT' && profile.status !== 'REJECTED') {
            throw conflict(
              'VERIFICATION_ALREADY_PENDING',
              'Bu belge türü için incelenen bir başvuru var.',
            );
          }
          await tx.providerVerification.delete({ where: { id: pending.id } });
          replacedKey = pending.documentKey;
        }

        const consumed = await tx.uploadIntent.updateMany({
          where: { id: intent.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (consumed.count === 0) throw uploadNotFound();

        const info = await this.storage.head(intent.storageKey);
        const created = await tx.providerVerification.create({
          data: {
            providerId: profile.id,
            type: input.type,
            status: 'PENDING',
            documentKey: intent.storageKey,
            mimeType,
            sizeBytes: info?.size ?? intent.declaredSize,
            originalFileName: intent.originalFileName,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'verification.submitted',
          actorId: user.id,
          entityType: 'provider_verification',
          entityId: created.id,
          ipAddress,
          metadata: { type: input.type, mimeType, replaced: pending !== null },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict(
          'VERIFICATION_ALREADY_PENDING',
          'Bu belge türü için incelenen bir başvuru var.',
        );
      }
      throw error;
    }

    if (replacedKey) await this.deleteQuietly(replacedKey);
    return toProviderVerification(verification);
  }

  /**
   * Trust nothing the client said: the object must exist, fit the size cap
   * and start with the magic bytes of the declared, allowed type.
   * A bad file is deleted straight away.
   */
  private async inspectUpload(
    key: string,
    declaredMime: string,
    maxBytes: number,
  ): Promise<string> {
    let info;
    try {
      info = await this.storage.head(key);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    if (!info) {
      throw unprocessable('UPLOAD_NOT_COMPLETED', 'Dosya henüz yüklenmemiş.');
    }
    if (info.size === 0 || info.size > maxBytes) {
      await this.deleteQuietly(key);
      throw invalidFile('Dosya boş veya izin verilen boyutu aşıyor.', { maxSizeBytes: maxBytes });
    }
    const detected = detectMimeType(await this.storage.readPrefix(key, SIGNATURE_BYTES));
    if (!detected || detected !== declaredMime) {
      await this.deleteQuietly(key);
      throw invalidFile('Dosya içeriği JPEG, PNG veya PDF değil ya da bildirilen türle uyuşmuyor.');
    }
    return detected;
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
