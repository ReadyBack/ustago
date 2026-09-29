import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Helpers that produce the standard error body `{ code, message, details? }`.
 * `code` is stable and machine-readable; `message` is safe to show users.
 */
export const badRequest = (code: string, message: string) =>
  new BadRequestException({ code, message });
export const unauthorized = (code: string, message: string) =>
  new UnauthorizedException({ code, message });
export const forbidden = (code: string, message: string) =>
  new ForbiddenException({ code, message });
export const notFound = (code: string, message: string) => new NotFoundException({ code, message });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const tooManyRequests = (retryAfterSeconds: number) =>
  new HttpException(
    {
      code: 'RATE_LIMITED',
      message: 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
      details: { retryAfterSeconds },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
