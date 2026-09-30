import {
  Body,
  Controller,
  Delete,
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
  AdminProvider360,
  AdminSuspension,
  AdminVerificationCaseDetail,
  AdminVerificationCaseListItem,
  CategoryRequirement,
  Paginated,
} from '@ustago/types';
import {
  apiErrorResponseSchema,
  type ApproveVerificationRequest,
  approveVerificationRequestSchema,
  type CategoryRequirementRequest,
  categoryRequirementRequestSchema,
  type LiftSuspensionRequest,
  liftSuspensionRequestSchema,
  type ListVerificationCasesQuery,
  listVerificationCasesQuerySchema,
  type StartVerificationReviewRequest,
  startVerificationReviewRequestSchema,
  type SuspendProviderRequest,
  suspendProviderRequestSchema,
  uuidSchema,
  type VerificationDecisionRequest,
  verificationDecisionRequestSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { SuspensionsService } from '../providers/suspensions.service.js';
import { VerificationCaseService } from '../providers/verification-case.service.js';
import { AdminTrustService } from './admin-trust.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const TRANSITION_ERRORS =
  'PROVIDER_VERIFICATION_INVALID_TRANSITION / VERIFICATION_VERSION_CONFLICT';

/**
 * Faz 6 trust operations (docs/adr/0023): "Doğrulama Talepleri", provider
 * suspensions, category document requirements and Provider 360. Reads are
 * open to every admin; decisions need ADMIN_VERIFICATION.
 */
@ApiTags('admin: trust')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminTrustController {
  constructor(
    private readonly cases: VerificationCaseService,
    private readonly suspensions: SuspensionsService,
    private readonly trust: AdminTrustService,
  ) {}

  // -- Verification cases ---------------------------------------------------

  @Get('verification-cases')
  @ApiOperation({ summary: 'Doğrulama talepleri kuyruğu (varsayılan: SUBMITTED, en eski önce).' })
  listCases(
    @Query(new ZodValidationPipe(listVerificationCasesQuerySchema))
    query: ListVerificationCasesQuery,
  ): Promise<Paginated<AdminVerificationCaseListItem>> {
    return this.cases.list(query);
  }

  @Get('verification-cases/:providerId')
  caseDetail(
    @Param('providerId', idPipe) providerId: string,
  ): Promise<AdminVerificationCaseDetail> {
    return this.cases.detail(providerId);
  }

  @Post('verification-cases/:providerId/start-review')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiOperation({ summary: 'İncelemeye Al: SUBMITTED → UNDER_REVIEW.' })
  @ApiZodBody(startVerificationReviewRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, TRANSITION_ERRORS)
  startReview(
    @CurrentUser() actor: AuthUser,
    @Param('providerId', idPipe) providerId: string,
    @Body(new ZodValidationPipe(startVerificationReviewRequestSchema))
    body: StartVerificationReviewRequest,
    @Req() req: Request,
  ): Promise<AdminVerificationCaseDetail> {
    return this.cases.startReview(actor, providerId, body.expectedVersion, clientIp(req));
  }

  @Post('verification-cases/:providerId/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiOperation({ summary: 'Onayla: UNDER_REVIEW → VERIFIED. Zorunlu belgeler yüklü olmalı.' })
  @ApiZodBody(approveVerificationRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, TRANSITION_ERRORS)
  @ApiZodResponse(422, apiErrorResponseSchema, 'VERIFICATION_REQUIRED')
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('providerId', idPipe) providerId: string,
    @Body(new ZodValidationPipe(approveVerificationRequestSchema)) body: ApproveVerificationRequest,
    @Req() req: Request,
  ): Promise<AdminVerificationCaseDetail> {
    return this.cases.approve(actor, providerId, body, clientIp(req));
  }

  @Post('verification-cases/:providerId/request-revision')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiOperation({ summary: 'Revizyon İste: UNDER_REVIEW → NEEDS_REVISION.' })
  @ApiZodBody(verificationDecisionRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, TRANSITION_ERRORS)
  requestRevision(
    @CurrentUser() actor: AuthUser,
    @Param('providerId', idPipe) providerId: string,
    @Body(new ZodValidationPipe(verificationDecisionRequestSchema))
    body: VerificationDecisionRequest,
    @Req() req: Request,
  ): Promise<AdminVerificationCaseDetail> {
    return this.cases.requestRevision(actor, providerId, body, clientIp(req));
  }

  @Post('verification-cases/:providerId/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiOperation({ summary: 'Reddet: UNDER_REVIEW → REJECTED.' })
  @ApiZodBody(verificationDecisionRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, TRANSITION_ERRORS)
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('providerId', idPipe) providerId: string,
    @Body(new ZodValidationPipe(verificationDecisionRequestSchema))
    body: VerificationDecisionRequest,
    @Req() req: Request,
  ): Promise<AdminVerificationCaseDetail> {
    return this.cases.reject(actor, providerId, body, clientIp(req));
  }

  // -- Suspensions ----------------------------------------------------------

  @Get('providers/:id/suspensions')
  listSuspensions(@Param('id', idPipe) id: string): Promise<AdminSuspension[]> {
    return this.suspensions.list(id);
  }

  @Post('providers/:id/suspensions')
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiOperation({
    summary:
      'Hesabı askıya al: yeni teklif, NOW iş ve para çekme durur; mevcut işler ve geçmiş korunur.',
  })
  @ApiZodBody(suspendProviderRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PROVIDER_ALREADY_SUSPENDED')
  suspend(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(suspendProviderRequestSchema)) body: SuspendProviderRequest,
    @Req() req: Request,
  ): Promise<AdminSuspension> {
    return this.suspensions.suspend(actor, id, body, clientIp(req));
  }

  @Post('providers/:id/suspensions/lift')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiZodBody(liftSuspensionRequestSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'SUSPENSION_NOT_FOUND')
  lift(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(liftSuspensionRequestSchema)) body: LiftSuspensionRequest,
    @Req() req: Request,
  ): Promise<AdminSuspension> {
    return this.suspensions.lift(actor, id, body.note, clientIp(req));
  }

  // -- Provider 360 ---------------------------------------------------------

  @Get('providers/:id/360')
  @ApiOperation({
    summary: 'Usta 360: genel, doğrulama, işler, yorumlar, kalite, finans, cezalar, denetim.',
  })
  provider360(@Param('id', idPipe) id: string): Promise<AdminProvider360> {
    return this.trust.provider360(id);
  }

  // -- Category requirements ------------------------------------------------

  @Get('category-requirements')
  listRequirements(
    @Query('categoryId', new ZodValidationPipe(uuidSchema.optional())) categoryId?: string,
  ): Promise<CategoryRequirement[]> {
    return this.trust.listRequirements(categoryId);
  }

  @Post('categories/:id/requirements')
  @RequirePermission('ADMIN_VERIFICATION')
  @ApiOperation({
    summary: 'Kategoriye zorunlu belge ekle (ör. elektrik için mesleki yeterlilik).',
  })
  @ApiZodBody(categoryRequirementRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'CATEGORY_REQUIREMENT_EXISTS')
  addRequirement(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(categoryRequirementRequestSchema)) body: CategoryRequirementRequest,
    @Req() req: Request,
  ): Promise<CategoryRequirement> {
    return this.trust.addRequirement(actor, id, body, clientIp(req));
  }

  @Delete('category-requirements/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('ADMIN_VERIFICATION')
  removeRequirement(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.trust.removeRequirement(actor, id, clientIp(req));
  }
}
