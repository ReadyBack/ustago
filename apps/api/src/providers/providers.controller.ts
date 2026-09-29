import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ProviderOnboardingStatus,
  ProviderProfile,
  ProviderServiceAreaGroup,
  ProviderServiceItem,
  ProviderVerification,
  PublicProviderProfile,
  UploadIntentResponse,
} from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CreateProviderProfileRequest,
  createProviderProfileRequestSchema,
  type CreateUploadIntentRequest,
  createUploadIntentRequestSchema,
  providerOnboardingStatusSchema,
  providerProfileSchema,
  providerServiceAreaGroupSchema,
  providerServiceItemSchema,
  providerVerificationSchema,
  publicProviderProfileSchema,
  type SetProviderServiceAreasRequest,
  setProviderServiceAreasRequestSchema,
  type SetProviderServicesRequest,
  setProviderServicesRequestSchema,
  type SubmitVerificationRequest,
  submitVerificationRequestSchema,
  type UpdateProviderAvailabilityRequest,
  updateProviderAvailabilityRequestSchema,
  type UpdateProviderProfileRequest,
  updateProviderProfileRequestSchema,
  uploadIntentResponseSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ProviderCatalogService } from './provider-catalog.service.js';
import { ProviderVerificationsService } from './provider-verifications.service.js';
import { ProvidersService } from './providers.service.js';
import { PublicProvidersService } from './public-providers.service.js';

const STATE_ERRORS = 'INVALID_PROVIDER_STATE (ör. başvuru incelenirken düzenleme)';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providers: ProvidersService,
    private readonly catalog: ProviderCatalogService,
    private readonly verifications: ProviderVerificationsService,
    private readonly publicProviders: PublicProvidersService,
  ) {}

  @Post('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mevcut hesaba usta profili açar (DRAFT) ve PROVIDER rolü ekler.' })
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
  @ApiBearerAuth()
  @ApiZodResponse(200, providerProfileSchema)
  getMine(@CurrentUser() user: AuthUser): Promise<ProviderProfile> {
    return this.providers.getMine(user.id);
  }

  @Patch('me')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiZodBody(updateProviderProfileRequestSchema)
  @ApiZodResponse(200, providerProfileSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, STATE_ERRORS)
  updateMine(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProviderProfileRequestSchema))
    body: UpdateProviderProfileRequest,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.providers.updateMine(user.id, body, req.ip ?? null);
  }

  @Get('me/onboarding')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Onboarding ilerlemesi: tamamlanan ve eksik adımlar.' })
  @ApiZodResponse(200, providerOnboardingStatusSchema)
  onboarding(@CurrentUser() user: AuthUser): Promise<ProviderOnboardingStatus> {
    return this.providers.onboarding(user.id);
  }

  @Get('me/services')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiZodResponse(200, z.array(providerServiceItemSchema))
  services(@CurrentUser() user: AuthUser): Promise<ProviderServiceItem[]> {
    return this.catalog.getServices(user.id);
  }

  @Put('me/services')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hizmet kategorilerini (tam liste) değiştirir.' })
  @ApiZodBody(setProviderServicesRequestSchema)
  @ApiZodResponse(200, z.array(providerServiceItemSchema))
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'CATEGORY_NOT_AVAILABLE / PROVIDER_PROFILE_INCOMPLETE',
  )
  @ApiZodResponse(409, apiErrorResponseSchema, STATE_ERRORS)
  setServices(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setProviderServicesRequestSchema)) body: SetProviderServicesRequest,
    @Req() req: Request,
  ): Promise<ProviderServiceItem[]> {
    return this.catalog.setServices(user.id, body, req.ip ?? null);
  }

  @Get('me/service-areas')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiZodResponse(200, z.array(providerServiceAreaGroupSchema))
  serviceAreas(@CurrentUser() user: AuthUser): Promise<ProviderServiceAreaGroup[]> {
    return this.catalog.getServiceAreas(user.id);
  }

  @Put('me/service-areas')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Hizmet verilen ilçeleri (il bazında gruplu, tam liste) değiştirir.' })
  @ApiZodBody(setProviderServiceAreasRequestSchema)
  @ApiZodResponse(200, z.array(providerServiceAreaGroupSchema))
  @ApiZodResponse(422, apiErrorResponseSchema, 'DISTRICT_PROVINCE_MISMATCH / DISTRICT_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, STATE_ERRORS)
  setServiceAreas(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setProviderServiceAreasRequestSchema))
    body: SetProviderServiceAreasRequest,
    @Req() req: Request,
  ): Promise<ProviderServiceAreaGroup[]> {
    return this.catalog.setServiceAreas(user.id, body, req.ip ?? null);
  }

  @Patch('me/availability')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Acil Usta tercihi (nowEnabled) ve anlık müsaitlik (isAvailableNow).',
    description:
      'nowEnabled onboarding sırasında da kaydedilebilir. isAvailableNow yalnızca ACTIVE usta, ' +
      'NOW destekleyen hizmet ve NOW açık il × kategori ile açılır.',
  })
  @ApiZodBody(updateProviderAvailabilityRequestSchema)
  @ApiZodResponse(200, providerProfileSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PROVIDER_NOT_ACTIVE / INVALID_PROVIDER_STATE')
  @ApiZodResponse(422, apiErrorResponseSchema, 'NOW_CATEGORY_NOT_SUPPORTED / NOW_NOT_AVAILABLE')
  availability(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProviderAvailabilityRequestSchema))
    body: UpdateProviderAvailabilityRequest,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.providers.updateAvailability(user.id, body, req.ip ?? null);
  }

  @Get('me/verifications')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiZodResponse(200, z.array(providerVerificationSchema))
  listVerifications(@CurrentUser() user: AuthUser): Promise<ProviderVerification[]> {
    return this.verifications.list(user.id);
  }

  @Post('me/verifications/upload-intent')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Belge yüklemek için kısa ömürlü, imzalı bir yükleme adresi alır.',
    description:
      'Dosyayı dönen uploadUrl adresine method ve headers ile gönderin, sonra ' +
      'POST /providers/me/verifications ile uploadId’yi bildirin. JPEG, PNG, PDF; SVG ve çalıştırılabilir dosyalar kabul edilmez.',
  })
  @ApiZodBody(createUploadIntentRequestSchema)
  @ApiZodResponse(201, uploadIntentResponseSchema)
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_VERIFICATION_FILE (boyut)')
  uploadIntent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUploadIntentRequestSchema)) body: CreateUploadIntentRequest,
    @Req() req: Request,
  ): Promise<UploadIntentResponse> {
    return this.verifications.createUploadIntent(user, body, req.ip ?? null);
  }

  @Post('me/verifications')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Yüklenen belgeyi doğrulama için gönderir (PENDING).' })
  @ApiZodBody(submitVerificationRequestSchema)
  @ApiZodResponse(201, providerVerificationSchema)
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'INVALID_VERIFICATION_FILE / UPLOAD_NOT_COMPLETED / UPLOAD_EXPIRED',
  )
  @ApiZodResponse(409, apiErrorResponseSchema, 'VERIFICATION_ALREADY_PENDING / ' + STATE_ERRORS)
  submitVerification(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(submitVerificationRequestSchema)) body: SubmitVerificationRequest,
    @Req() req: Request,
  ): Promise<ProviderVerification> {
    return this.verifications.submit(user, body, req.ip ?? null);
  }

  @Post('me/submit')
  @HttpCode(HttpStatus.OK)
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Başvuruyu incelemeye gönderir (DRAFT → PENDING_REVIEW). Tekrar çağrı güvenlidir.',
  })
  @ApiZodResponse(200, providerProfileSchema)
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'PROVIDER_ONBOARDING_INCOMPLETE (details.missingSteps)',
  )
  @ApiZodResponse(409, apiErrorResponseSchema, 'INVALID_PROVIDER_STATE')
  submit(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<ProviderProfile> {
    return this.providers.submit(user.id, req.ip ?? null);
  }

  @Post('me/reapply')
  @HttpCode(HttpStatus.OK)
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reddedilen başvuruyu düzenlemek için DRAFT’a döndürür.' })
  @ApiZodResponse(200, providerProfileSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'INVALID_PROVIDER_STATE')
  reapply(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<ProviderProfile> {
    return this.providers.reapply(user.id, req.ip ?? null);
  }

  // Declared after the /me routes so "me" is never taken for an id.
  @Public()
  @Get(':id')
  @ApiOperation({
    summary: 'Onaylı ustanın herkese açık profili.',
    description: 'İletişim bilgisi, belge veya kimlik verisi içermez.',
  })
  @ApiZodResponse(200, publicProviderProfileSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PROVIDER_NOT_FOUND')
  getPublic(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<PublicProviderProfile> {
    return this.publicProviders.get(id);
  }
}
