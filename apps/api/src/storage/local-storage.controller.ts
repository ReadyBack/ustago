import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '../common/auth/decorators.js';
import { badRequest, conflict, forbidden, httpError, notFound } from '../common/http/errors.js';
import {
  LocalObjectStorage,
  ObjectAlreadyExistsError,
  UploadTooLargeError,
} from './local-object-storage.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

const LINK_INVALID = () =>
  forbidden('STORAGE_LINK_INVALID', 'Bağlantı geçersiz veya süresi dolmuş.');

/**
 * Serves the signed URLs of the local storage driver (development and
 * tests only). The token is the only credential: it names one object, one
 * operation, an expiry and for uploads a Content-Type and size cap.
 */
@ApiExcludeController()
@Public()
@Controller('storage/local')
export class LocalStorageController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Put(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(@Param('token') token: string, @Req() req: Request): Promise<void> {
    const local = this.local();
    const claims = local.verifyToken(token);
    if (claims?.op !== 'put' || !claims.ct || !claims.max) throw LINK_INVALID();

    const contentType = req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== claims.ct) {
      throw badRequest('STORAGE_CONTENT_TYPE_MISMATCH', 'Content-Type imzalı değerle aynı olmalı.');
    }
    const declared = Number(req.header('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > claims.max) throw tooLarge();

    try {
      await local.write(claims.key, req, claims.ct, claims.max);
    } catch (error) {
      if (error instanceof UploadTooLargeError) throw tooLarge();
      if (error instanceof ObjectAlreadyExistsError) {
        throw conflict('STORAGE_OBJECT_EXISTS', 'Bu bağlantıyla zaten dosya yüklendi.');
      }
      throw error;
    }
  }

  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const local = this.local();
    const claims = local.verifyToken(token);
    if (claims?.op !== 'get') throw LINK_INVALID();
    const info = await local.head(claims.key);
    if (!info) throw notFound('STORAGE_OBJECT_NOT_FOUND', 'Dosya bulunamadı.');

    res.setHeader('Content-Type', info.contentType ?? 'application/octet-stream');
    res.setHeader('Content-Length', String(info.size));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    local.read(claims.key).pipe(res);
  }

  private local(): LocalObjectStorage {
    if (!(this.storage instanceof LocalObjectStorage)) {
      throw notFound('NOT_FOUND', 'Bulunamadı.');
    }
    return this.storage;
  }
}

function tooLarge() {
  return httpError(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'FILE_TOO_LARGE',
    'Dosya izin verilen boyutu aşıyor.',
  );
}
