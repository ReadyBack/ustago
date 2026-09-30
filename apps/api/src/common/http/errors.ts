import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

/**
 * Helpers that produce the standard error body `{ code, message, details? }`.
 * `code` is stable and machine-readable; `message` is safe to show users.
 */
export const badRequest = (code: string, message: string, details?: unknown) =>
  new BadRequestException({ code, message, ...(details === undefined ? {} : { details }) });
export const unauthorized = (code: string, message: string) =>
  new UnauthorizedException({ code, message });
export const forbidden = (code: string, message: string, details?: unknown) =>
  new ForbiddenException({ code, message, ...(details === undefined ? {} : { details }) });
export const notFound = (code: string, message: string) => new NotFoundException({ code, message });
export const conflict = (code: string, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });
/** A well-formed request that breaks a business rule (e.g. onboarding incomplete). */
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new UnprocessableEntityException({
    code,
    message,
    ...(details === undefined ? {} : { details }),
  });
export const serviceUnavailable = (code: string, message: string) =>
  new ServiceUnavailableException({ code, message });
export const tooManyRequests = (
  retryAfterSeconds: number,
  code = 'RATE_LIMITED',
  message = 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
) =>
  new HttpException(
    { code, message, details: { retryAfterSeconds } },
    HttpStatus.TOO_MANY_REQUESTS,
  );

export const httpError = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);
