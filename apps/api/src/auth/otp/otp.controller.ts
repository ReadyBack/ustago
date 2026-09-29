import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OtpRequestResponse, OtpVerifyResponse } from '@ustago/types';
import {
  apiErrorResponseSchema,
  type OtpRequest,
  otpRequestResponseSchema,
  otpRequestSchema,
  type OtpVerifyRequest,
  otpVerifyResponseSchema,
  otpVerifySchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, MaybeCurrentUser, OptionalAuth } from '../../common/auth/decorators.js';
import { clientContext } from '../../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/http/openapi.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { OtpService } from './otp.service.js';

@ApiTags('auth')
@Controller('auth/otp')
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @OptionalAuth()
  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Telefona tek kullanımlık kod gönderir.',
    description:
      'REGISTER_OR_LOGIN oturum gerektirmez. VERIFY_PHONE için Bearer token zorunludur. ' +
      'Aynı numaraya yeni kod istemek (yeniden gönder) öncekini geçersiz kılar. Kod yanıtta asla dönmez.',
  })
  @ApiZodBody(otpRequestSchema)
  @ApiZodResponse(202, otpRequestResponseSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PHONE_ALREADY_IN_USE (VERIFY_PHONE)')
  @ApiZodResponse(429, apiErrorResponseSchema, 'OTP_RATE_LIMITED (details.retryAfterSeconds)')
  @ApiZodResponse(503, apiErrorResponseSchema, 'SMS_UNAVAILABLE')
  request(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequest,
    @MaybeCurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
  ): Promise<OtpRequestResponse> {
    return this.otp.request(body, clientContext(req), user);
  }

  @OptionalAuth()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Kodu doğrular: giriş/kayıt yapar veya telefonu hesaba bağlar.',
    description:
      'REGISTER_OR_LOGIN: numara kayıtlıysa giriş yapar, değilse CUSTOMER hesabı açar ve token döner. ' +
      'VERIFY_PHONE: oturumdaki kullanıcının telefonunu doğrular (tokens null).',
  })
  @ApiZodBody(otpVerifySchema)
  @ApiZodResponse(200, otpVerifyResponseSchema)
  @ApiZodResponse(
    400,
    apiErrorResponseSchema,
    'OTP_INVALID (details.attemptsRemaining) / OTP_EXPIRED',
  )
  @ApiZodResponse(409, apiErrorResponseSchema, 'PHONE_ALREADY_IN_USE')
  @ApiZodResponse(429, apiErrorResponseSchema, 'OTP_TOO_MANY_ATTEMPTS / OTP_RATE_LIMITED')
  verify(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyRequest,
    @MaybeCurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
  ): Promise<OtpVerifyResponse> {
    return this.otp.verify(body, clientContext(req), user);
  }
}
