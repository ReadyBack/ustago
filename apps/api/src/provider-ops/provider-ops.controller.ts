import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ProviderAvailability, ProviderCoverage, ProviderHome } from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CreateTimeOff,
  createTimeOffSchema,
  providerAvailabilitySchema,
  providerCoverageSchema,
  providerHomeSchema,
  type SetProviderRegions,
  setProviderRegionsSchema,
  type SetWeeklyHours,
  setWeeklyHoursSchema,
  type UpdateAvailabilitySettings,
  updateAvailabilitySettingsSchema,
  type UpdateCoverageSettings,
  updateCoverageSettingsSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ProviderAvailabilityService } from './availability.service.js';
import { CoverageService } from './coverage.service.js';
import { ProviderHomeService } from './provider-home.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** Faz 7 provider operations: coverage, availability, home (docs/adr/0029, 0031). */
@ApiTags('providers')
@ApiBearerAuth()
@Roles('PROVIDER')
@Controller('providers/me')
export class ProviderOpsController {
  constructor(
    private readonly coverage: CoverageService,
    private readonly availability: ProviderAvailabilityService,
    private readonly homeService: ProviderHomeService,
  ) {}

  @Get('coverage')
  @ApiOperation({ summary: 'Hizmet kapsamı: ilçeler, il/yarıçap bölgeleri, azami mesafe, hizmet merkezi.' })
  @ApiZodResponse(200, providerCoverageSchema)
  getCoverage(@CurrentUser() user: AuthUser): Promise<ProviderCoverage> {
    return this.coverage.getMine(user.id);
  }

  @Put('regions')
  @ApiOperation({
    summary:
      'Geniş hizmet bölgelerini (tüm il / merkez ilçe + yarıçap) değiştirir. Merkez bir ilçe merkezidir, ev adresi değildir.',
  })
  @ApiZodBody(setProviderRegionsSchema)
  @ApiZodResponse(200, providerCoverageSchema)
  @ApiZodResponse(422, apiErrorResponseSchema, 'PROVINCE_NOT_FOUND / DISTRICT_NOT_FOUND')
  setRegions(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setProviderRegionsSchema)) body: SetProviderRegions,
    @Req() req: Request,
  ): Promise<ProviderCoverage> {
    return this.coverage.setRegions(user.id, body, clientIp(req));
  }

  @Patch('coverage')
  @ApiOperation({ summary: 'Azami hizmet mesafesi ve hizmet merkezi ilçesi.' })
  @ApiZodBody(updateCoverageSettingsSchema)
  @ApiZodResponse(200, providerCoverageSchema)
  @ApiZodResponse(422, apiErrorResponseSchema, 'DISTRICT_NOT_FOUND / SERVICE_CENTER_REQUIRED')
  updateCoverage(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateCoverageSettingsSchema)) body: UpdateCoverageSettings,
    @Req() req: Request,
  ): Promise<ProviderCoverage> {
    return this.coverage.updateSettings(user.id, body, clientIp(req));
  }

  @Get('availability-settings')
  @ApiZodResponse(200, providerAvailabilitySchema)
  getAvailability(@CurrentUser() user: AuthUser): Promise<ProviderAvailability> {
    return this.availability.getMine(user.id);
  }

  @Patch('availability-settings')
  @ApiOperation({ summary: '"Yeni iş alma" ve "Bugün müsait değilim". Kapatmak NOW müsaitliğini de kapatır.' })
  @ApiZodBody(updateAvailabilitySettingsSchema)
  @ApiZodResponse(200, providerAvailabilitySchema)
  updateAvailability(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateAvailabilitySettingsSchema)) body: UpdateAvailabilitySettings,
    @Req() req: Request,
  ): Promise<ProviderAvailability> {
    return this.availability.updateSettings(user.id, body, clientIp(req));
  }

  @Put('weekly-hours')
  @ApiOperation({ summary: 'Haftalık çalışma saatleri (Türkiye saati). Boş liste = esnek.' })
  @ApiZodBody(setWeeklyHoursSchema)
  @ApiZodResponse(200, providerAvailabilitySchema)
  setWeeklyHours(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setWeeklyHoursSchema)) body: SetWeeklyHours,
    @Req() req: Request,
  ): Promise<ProviderAvailability> {
    return this.availability.setWeeklyHours(user.id, body, clientIp(req));
  }

  @Post('time-off')
  @ApiZodBody(createTimeOffSchema)
  @ApiZodResponse(201, providerAvailabilitySchema)
  @ApiZodResponse(422, apiErrorResponseSchema, 'TIME_OFF_IN_PAST / TIME_OFF_LIMIT')
  addTimeOff(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createTimeOffSchema)) body: CreateTimeOff,
    @Req() req: Request,
  ): Promise<ProviderAvailability> {
    return this.availability.addTimeOff(user.id, body, clientIp(req));
  }

  @Delete('time-off/:id')
  @ApiZodResponse(200, providerAvailabilitySchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'TIME_OFF_NOT_FOUND')
  cancelTimeOff(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ProviderAvailability> {
    return this.availability.cancelTimeOff(user.id, id, clientIp(req));
  }

  @Get('home')
  @ApiOperation({ summary: 'Usta ana sayfası: canlı sayılar, müsaitlik, profil kontrol listesi.' })
  @ApiZodResponse(200, providerHomeSchema)
  home(@CurrentUser() user: AuthUser): Promise<ProviderHome> {
    return this.homeService.home(user.id);
  }
}
