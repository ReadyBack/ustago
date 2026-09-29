import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthResponse, AuthTokens } from '@ustago/types';
import {
  apiErrorResponseSchema,
  authResponseSchema,
  authTokensSchema,
  type LoginRequest,
  loginRequestSchema,
  type RefreshRequest,
  refreshRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Public } from '../common/auth/decorators.js';
import { clientContext } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { AuthService } from './auth.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Müşteri veya usta hesabı oluşturur ve oturum açar.' })
  @ApiZodBody(registerRequestSchema)
  @ApiZodResponse(201, authResponseSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'EMAIL_TAKEN / PHONE_TAKEN')
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
  ): Promise<AuthResponse> {
    const client = clientContext(req);
    await this.rateLimit.enforce({ bucket: 'register:ip', subject: client.ipAddress ?? '' });
    return this.auth.register(body, client);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'E-posta ve şifre ile oturum açar.' })
  @ApiZodBody(loginRequestSchema)
  @ApiZodResponse(200, authResponseSchema)
  @ApiZodResponse(401, apiErrorResponseSchema, 'INVALID_CREDENTIALS')
  @ApiZodResponse(429, apiErrorResponseSchema, 'RATE_LIMITED')
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
  ): Promise<AuthResponse> {
    const client = clientContext(req);
    await this.rateLimit.enforce(
      { bucket: 'login:ip', subject: client.ipAddress ?? '' },
      { bucket: 'login:email', subject: body.email },
    );
    return this.auth.login(body, client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh token ile yeni token çifti alır (tek kullanımlık).' })
  @ApiZodBody(refreshRequestSchema)
  @ApiZodResponse(200, authTokensSchema)
  @ApiZodResponse(401, apiErrorResponseSchema, 'REFRESH_TOKEN_INVALID / REFRESH_TOKEN_REUSED')
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() req: Request,
  ): Promise<AuthTokens> {
    const client = clientContext(req);
    await this.rateLimit.enforce({ bucket: 'refresh:ip', subject: client.ipAddress ?? '' });
    return this.auth.refresh(body.refreshToken, client);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bu oturumu kapatır; access ve refresh token geçersiz olur.' })
  async logout(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    await this.auth.logout(user.id, user.sessionId, clientContext(req));
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kullanıcının tüm oturumlarını kapatır.' })
  async logoutAll(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    await this.auth.logoutAll(user.id, clientContext(req));
  }
}
