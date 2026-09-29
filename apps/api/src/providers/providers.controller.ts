import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ProviderProfile } from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CreateProviderProfileRequest,
  createProviderProfileRequestSchema,
  providerProfileSchema,
  type UpdateProviderProfileRequest,
  updateProviderProfileRequestSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ProvidersService } from './providers.service.js';

@ApiTags('providers')
@ApiBearerAuth()
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Post('me')
  @ApiOperation({ summary: 'Mevcut hesaba usta profili açar ve PROVIDER rolü ekler.' })
  @ApiZodBody(createProviderProfileRequestSchema)
  @ApiZodResponse(201, providerProfileSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PROVIDER_PROFILE_EXISTS')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createProviderProfileRequestSchema))
    body: CreateProviderProfileRequest,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.providers.becomeProvider(user.id, body, req.ip ?? null);
  }

  @Get('me')
  @Roles('PROVIDER')
  @ApiZodResponse(200, providerProfileSchema)
  getMine(@CurrentUser() user: AuthUser): Promise<ProviderProfile> {
    return this.providers.getMine(user.id);
  }

  @Patch('me')
  @Roles('PROVIDER')
  @ApiZodBody(updateProviderProfileRequestSchema)
  @ApiZodResponse(200, providerProfileSchema)
  updateMine(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProviderProfileRequestSchema))
    body: UpdateProviderProfileRequest,
  ): Promise<ProviderProfile> {
    return this.providers.updateMine(user.id, body);
  }
}
