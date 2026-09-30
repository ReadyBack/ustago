import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ProviderVerification, SignedUrl, UploadIntentResponse } from '@ustago/types';
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
import { MALWARE_SCANNER, type MalwareScanner } from '../storage/malware-scanner.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageUnavailableError,
} from '../storage/object-storage.js';
import { canEditDocuments } from './domain/verification-case.js';
import { toProviderVerification } from './provider.mappers.js';
import { ProviderStore } from './provider.store.js';
import { VerificationCaseService } from './verification-case.service.js';

/**
 * One code for every rejected file (kept from Faz 2 so clients do not
 * break); `details.reason` says why: TOO_LARGE, EMPTY or INVALID_TYPE.
 */
const invalidFile = (
  message: string,
  reason: 'TOO_LARGE' | 'EMPTY' | 'INVALID_TYPE',
  details?: Record<string, unknown>,
) => unprocessable('INVALID_VERIFICATION_FILE', message, { reason, ...details });
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
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    private readonly cases: VerificationCaseService,
  ) {}

  /**
   * A short-lived signed URL for the provider's own document. Anyone else
   * (another provider, a customer) gets the same 404 as a missing id.
   */
  async ownDocumentUrl(
    user: AuthUser,
    verificationId: string,
    ipAddress: string | null,
  ): Promise<SignedUrl> {
    const v = await this.prisma.providerVerification.findFirst({
      where: { id: verificationId, provider: { userId: user.id, deletedAt: null } },
      select: { id: true, documentKey: true, providerId: true },
    });
    if (!v?.documentKey) throw notFound('VERIFICATION_NOT_FOUND', 'Doğrulama kaydı bulunamadı.');
    let signed;
    try {
      signed = await this.storage.createDownloadUrl(
        v.documentKey,
        this.env.DOCUMENT_URL_TTL_SECONDS,
      );
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    await this.audit.record({
      action: 'verification.document_accessed',
      actorId: user.id,
      entityType: 'provider_verification',
      entityId: v.id,
      ipAddress,
      metadata: { providerId: v.providerId, by: 'owner' },
    });
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

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
    const verificationCase = await this.prisma.providerVerificationCase.findUnique({
      where: { providerId: profile.id },
      select: { status: true },
    });
    if (verificationCase && !canEditDocuments(verificationCase.status)) {
      throw conflict('VERIFICATION_LOCKED', 'Başvurunuz incelenirken belge değiştirilemez.', {
        status: verificationCase.status,
      });
    }
    const maxSizeBytes = this.env.VERIFICATION_MAX_FILE_BYTES;
    if (input.sizeBytes > maxSizeBytes) {
      throw invalidFile('Dosya çok büyük.', 'TOO_LARGE', { maxSizeBytes });
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
    const sha256 = await this.storage.sha256(intent.storageKey);
    const scanStatus = await this.scanner.scan(intent.storageKey);
    if (scanStatus === 'REJECTED' || scanStatus === 'QUARANTINED') {
      await this.deleteQuietly(intent.storageKey);
      throw invalidFile('Dosya güvenlik taramasından geçemedi.', 'INVALID_TYPE');
    }

    let replacedKey: string | null = null;
    let verification;
    try {
      verification = await this.prisma.$transaction(async (tx) => {
        const profile = await this.store.lockByUserId(tx, user.id);
        this.store.assertEditable(profile, 'VERIFICATIONS');
        if (!intent.storageKey.startsWith(`verifications/${profile.id}/`)) throw uploadNotFound();

        // The same file twice is a client bug or a replay; refuse it.
        const duplicate = await tx.providerVerification.findFirst({
          where: { providerId: profile.id, sha256, status: { in: ['PENDING', 'APPROVED'] } },
          select: { id: true },
        });
        if (duplicate) {
          throw conflict('DOCUMENT_DUPLICATE', 'Bu dosyayı zaten yüklediniz.', {
            verificationId: duplicate.id,
          });
        }
        // Faz 6: every document belongs to the provider's verification case.
        const caseId = await this.cases.onDocumentUpload(tx, profile, user.id);
        const caseStatus = (
          await tx.providerVerificationCase.findUniqueOrThrow({ where: { id: caseId } })
        ).status;

        const pending = await tx.providerVerification.findFirst({
          where: { providerId: profile.id, type: input.type, status: 'PENDING' },
        });
        if (pending) {
          // Before submission a document can simply be replaced; once the
          // provider is live, a pending review must finish first.
          const replaceable =
            profile.status === 'DRAFT' ||
            profile.status === 'REJECTED' ||
            caseStatus === 'IN_PROGRESS' ||
            caseStatus === 'NEEDS_REVISION';
          if (!replaceable) {
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
            caseId,
            sha256,
            scanStatus,
            scannedAt: scanStatus === 'NOT_SCANNED' ? null : new Date(),
          },
        });
        await this.audit.recordIn(tx, {
          action: 'verification.submitted',
          actorId: user.id,
          entityType: 'provider_verification',
          entityId: created.id,
          ipAddress,
          metadata: {
            type: input.type,
            mimeType,
            replaced: pending !== null,
            scanStatus,
          },
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
      throw invalidFile(
        'Dosya boş veya izin verilen boyutu aşıyor.',
        info.size === 0 ? 'EMPTY' : 'TOO_LARGE',
        { maxSizeBytes: maxBytes },
      );
    }
    const detected = detectMimeType(await this.storage.readPrefix(key, SIGNATURE_BYTES));
    if (!detected || detected !== declaredMime) {
      await this.deleteQuietly(key);
      throw invalidFile(
        'Dosya içeriği JPEG, PNG veya PDF değil ya da bildirilen türle uyuşmuyor.',
        'INVALID_TYPE',
      );
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
