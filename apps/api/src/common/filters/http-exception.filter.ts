import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorResponse } from '@ustago/types';
import type { Request, Response } from 'express';

import { Prisma } from '../../generated/prisma/client.js';

/** Maps every thrown error to the standard error body (docs/api/README.md). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const body = this.toBody(exception, request.originalUrl, request.requestId);
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed${body.requestId ? ` [${body.requestId}]` : ''}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, path: string, requestId?: string): ApiErrorResponse {
    const base = {
      path,
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    };

    const known = fromPrismaError(exception);
    if (known) return { ...base, ...known };

    if (!(exception instanceof HttpException)) {
      return {
        ...base,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Beklenmeyen bir hata oluştu.',
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();
    const fields = typeof payload === 'object' && payload !== null ? payload : {};
    const code =
      'code' in fields && typeof fields.code === 'string'
        ? fields.code
        : statusCodeName(statusCode);
    const message =
      'message' in fields && typeof fields.message === 'string'
        ? fields.message
        : exception.message;

    return {
      ...base,
      statusCode,
      code,
      message,
      ...('details' in fields ? { details: fields.details } : {}),
    };
  }
}

/**
 * Database constraint errors that reach the filter become safe 4xx bodies
 * without table or column names.
 */
function fromPrismaError(
  exception: unknown,
): Pick<ApiErrorResponse, 'statusCode' | 'code' | 'message'> | null {
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (exception.code) {
    case 'P2002':
      return { statusCode: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'Kayıt zaten mevcut.' };
    case 'P2025':
      return { statusCode: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Kayıt bulunamadı.' };
    case 'P2003':
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'İlişkili kayıt nedeniyle işlem yapılamadı.',
      };
    default:
      return null;
  }
}

function statusCodeName(status: number): string {
  const name = HttpStatus[status];
  return typeof name === 'string' ? name : 'HTTP_ERROR';
}
