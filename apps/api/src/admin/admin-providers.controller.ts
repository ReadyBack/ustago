import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminProviderDetail,
  AdminProviderListItem,
  AdminProviderVerification,
  Paginated,
  ProviderProfile,
  SignedUrl,
} from '@ustago/types';
import {
  adminProviderDetailSchema,
  adminProviderListItemSchema,
  adminProviderVerificationSchema,
  apiErrorResponseSchema,
  type ListAdminProvidersQuery,
  listAdminProvidersQuerySchema,
  type ListAdminVerificationsQuery,
  listAdminVerificationsQuerySchema,
  paginatedSchema,
  providerProfileSchema,
  type ReviewReasonRequest,
  reviewReasonRequestSchema,
  signedUrlSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdminProvidersService } from './admin-providers.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** Provider application review (ADMIN and SUPER_ADMIN). */
@ApiTags('admin: providers')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminProvidersController {
  constructor(private readonly admin: AdminProvidersService) {}

  @Get('providers')
  @ApiOperation({
    summary: 'Usta başvuruları. status=PENDING_REVIEW inceleme kuyruğudur (en eski önce).',
  })
  @ApiZodResponse(200, paginatedSchema(adminProviderListItemSchema))
  list(
    @Query(new ZodValidationPipe(listAdminProvidersQuerySchema)) query: ListAdminProvidersQuery,
  ): Promise<Paginated<AdminProviderListItem>> {
    return this.admin.list(query);
  }

  @Get('providers/:id')
  @ApiZodResponse(200, adminProviderDetailSchema)
  detail(@Param('id', idPipe) id: string): Promise<AdminProviderDetail> {
    return this.admin.detail(id);
  }

  @Get('providers/:id/verifications')
  @ApiZodResponse(200, z.array(adminProviderVerificationSchema))
  verifications(@Param('id', idPipe) id: string): Promise<AdminProviderVerification[]> {
    return this.admin.verificationsOf(id);
  }

  @Post('providers/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING_REVIEW → ACTIVE. Zorunlu belgeler APPROVED olmalı.' })
  @ApiZodResponse(200, providerProfileSchema)
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'VERIFICATION_REQUIRED / PROVIDER_PROFILE_INCOMPLETE',
  )
  @ApiZodResponse(409, apiErrorResponseSchema, 'INVALID_PROVIDER_STATE')
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.admin.approveProvider(actor, id, req.ip ?? null);
  }

  @Post('providers/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PENDING_REVIEW → REJECTED. Sebep zorunlu ve ustaya gösterilir.' })
  @ApiZodBody(reviewReasonRequestSchema)
  @ApiZodResponse(200, providerProfileSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'INVALID_PROVIDER_STATE')
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(reviewReasonRequestSchema)) body: ReviewReasonRequest,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.admin.rejectProvider(actor, id, body.reason, req.ip ?? null);
  }

  @Post('providers/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACTIVE → SUSPENDED; müsaitlik kapanır. Sebep zorunlu.' })
  @ApiZodBody(reviewReasonRequestSchema)
  @ApiZodResponse(200, providerProfileSchema)
  suspend(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(reviewReasonRequestSchema)) body: ReviewReasonRequest,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.admin.suspendProvider(actor, id, body.reason, req.ip ?? null);
  }

  @Post('providers/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SUSPENDED → ACTIVE.' })
  @ApiZodResponse(200, providerProfileSchema)
  reinstate(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ProviderProfile> {
    return this.admin.reinstateProvider(actor, id, req.ip ?? null);
  }

  @Get('provider-verifications')
  @ApiOperation({ summary: 'Belge kuyruğu. status=PENDING en eski önce.' })
  @ApiZodResponse(200, paginatedSchema(adminProviderVerificationSchema))
  verificationQueue(
    @Query(new ZodValidationPipe(listAdminVerificationsQuerySchema))
    query: ListAdminVerificationsQuery,
  ): Promise<Paginated<AdminProviderVerification>> {
    return this.admin.verificationQueue(query);
  }

  @Post('provider-verifications/:id/document-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Belgeyi görüntülemek için kısa ömürlü imzalı adres. Her erişim audit log’a yazılır.',
  })
  @ApiZodResponse(200, signedUrlSchema)
  documentUrl(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<SignedUrl> {
    return this.admin.documentUrl(actor, id, req.ip ?? null);
  }

  @Post('provider-verifications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(200, adminProviderVerificationSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'VERIFICATION_ALREADY_REVIEWED')
  approveVerification(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<AdminProviderVerification> {
    return this.admin.approveVerification(actor, id, req.ip ?? null);
  }

  @Post('provider-verifications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(reviewReasonRequestSchema)
  @ApiZodResponse(200, adminProviderVerificationSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'VERIFICATION_ALREADY_REVIEWED')
  rejectVerification(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(reviewReasonRequestSchema)) body: ReviewReasonRequest,
    @Req() req: Request,
  ): Promise<AdminProviderVerification> {
    return this.admin.rejectVerification(actor, id, body.reason, req.ip ?? null);
  }
}
