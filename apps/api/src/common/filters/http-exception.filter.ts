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

/** Maps every thrown error to the standard error body (PROJECT.md §19). */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const body = this.toBody(exception, request.originalUrl);
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, path: string): ApiErrorResponse {
    const base = { path, timestamp: new Date().toISOString() };

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

function statusCodeName(status: number): string {
  const name = HttpStatus[status];
  return typeof name === 'string' ? name : 'HTTP_ERROR';
}
