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
  AdminDisputeDetail,
  AdminDisputeListItem,
  AdminJobDetail,
  AdminJobListItem,
  AdminReview,
  Paginated,
  ProviderPenalty,
  ProviderQuality,
} from '@ustago/types';
import {
  adminDisputeDetailSchema,
  adminDisputeListItemSchema,
  adminJobDetailSchema,
  adminJobListItemSchema,
  adminReviewSchema,
  apiErrorResponseSchema,
  type CreatePenalty,
  createPenaltySchema,
  type ListAdminDisputesQuery,
  listAdminDisputesQuerySchema,
  type ListAdminJobsQuery,
  listAdminJobsQuerySchema,
  type ListAdminReviewsQuery,
  listAdminReviewsQuerySchema,
  type ModerateReview,
  moderateReviewSchema,
  paginatedSchema,
  providerPenaltySchema,
  providerQualitySchema,
  type ResolveDispute,
  resolveDisputeSchema,
  type RevokePenalty,
  revokePenaltySchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { QualityService } from '../quality/quality.service.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { clientIp } from '../common/http/client-context.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** Jobs, disputes, reviews and provider quality (ADMIN and SUPER_ADMIN). */
@ApiTags('admin: jobs')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminJobsController {
  constructor(
    private readonly admin: AdminJobsService,
    private readonly quality: QualityService,
  ) {}

  @Get('jobs')
  @ApiOperation({ summary: 'İşler: durum, usta, müşteri, il, kategori ve tarih filtreleri.' })
  @ApiZodResponse(200, paginatedSchema(adminJobListItemSchema))
  listJobs(
    @Query(new ZodValidationPipe(listAdminJobsQuerySchema)) query: ListAdminJobsQuery,
  ): Promise<Paginated<AdminJobListItem>> {
    return this.admin.listJobs(query);
  }

  @Get('jobs/:id')
  @ApiOperation({
    summary:
      'İş detayı: talep, pazarlık, anlaşılan fiyat ve güncel toplam, zaman çizelgesi, ek işler, ' +
      'yorum, sorun bildirimleri ve denetim özeti. Telefon maskeli, açık adres yok.',
  })
  @ApiZodResponse(200, adminJobDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND')
  job(@Param('id', idPipe) id: string): Promise<AdminJobDetail> {
    return this.admin.job(id);
  }

  @Get('disputes')
  @ApiOperation({ summary: 'Sorun bildirimleri. group=OPEN açık, group=RESOLVED sonuçlanan.' })
  @ApiZodResponse(200, paginatedSchema(adminDisputeListItemSchema))
  listDisputes(
    @Query(new ZodValidationPipe(listAdminDisputesQuerySchema)) query: ListAdminDisputesQuery,
  ): Promise<Paginated<AdminDisputeListItem>> {
    return this.admin.listDisputes(query);
  }

  @Get('disputes/:id')
  @ApiZodResponse(200, adminDisputeDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'DISPUTE_NOT_FOUND')
  dispute(@Param('id', idPipe) id: string): Promise<AdminDisputeDetail> {
    return this.admin.dispute(id);
  }

  @Post('disputes/:id/resolve')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sorun bildirimini karara bağlar (not zorunlu). İki tarafa bildirim gider; ustanın kalite puanı ' +
      'ancak bu karardan sonra etkilenir.',
  })
  @ApiZodBody(resolveDisputeSchema)
  @ApiZodResponse(200, adminDisputeDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'DISPUTE_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'DISPUTE_ALREADY_RESOLVED')
  resolveDispute(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) body: ResolveDispute,
    @Req() req: Request,
  ): Promise<AdminDisputeDetail> {
    return this.admin.resolveDispute(user.id, id, body, clientIp(req));
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Müşteri değerlendirmeleri; status ve usta filtresi.' })
  @ApiZodResponse(200, paginatedSchema(adminReviewSchema))
  listReviews(
    @Query(new ZodValidationPipe(listAdminReviewsQuerySchema)) query: ListAdminReviewsQuery,
  ): Promise<Paginated<AdminReview>> {
    return this.admin.listReviews(query);
  }

  @Post('reviews/:id/hide')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Değerlendirmeyi gizler (silinmez). Puan ortalamasından ve UstaScore’dan çıkar.',
  })
  @ApiZodBody(moderateReviewSchema)
  @ApiZodResponse(200, adminReviewSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'REVIEW_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'REVIEW_MODERATION_CONFLICT')
  hideReview(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(moderateReviewSchema)) body: ModerateReview,
    @Req() req: Request,
  ): Promise<AdminReview> {
    return this.admin.hideReview(user.id, id, body, clientIp(req));
  }

  @Post('reviews/:id/restore')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Gizlenen değerlendirmeyi yeniden yayınlar.' })
  @ApiZodBody(moderateReviewSchema)
  @ApiZodResponse(200, adminReviewSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'REVIEW_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'REVIEW_MODERATION_CONFLICT')
  restoreReview(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(moderateReviewSchema)) body: ModerateReview,
    @Req() req: Request,
  ): Promise<AdminReview> {
    return this.admin.restoreReview(user.id, id, body, clientIp(req));
  }

  @Get('providers/:id/quality')
  @ApiOperation({
    summary:
      'Ustanın kalite özeti: tamamlanan/iptal edilen işler, açık sorunlar, yorum sayısı ve ortalaması, ' +
      'UstaScore V1 faktörleri ve yürürlükteki yaptırımlar.',
  })
  @ApiZodResponse(200, providerQualitySchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PROVIDER_NOT_FOUND')
  providerQuality(@Param('id', idPipe) id: string): Promise<ProviderQuality> {
    return this.quality.quality(id);
  }

  @Post('providers/:id/penalties')
  @RequirePermission('ADMIN_SUPPORT')
  @ApiOperation({
    summary:
      'Admin yaptırımı (uyarı, görünürlük azaltma, ACİL kapatma, iş kısıtlaması). Otomatik ağır ceza ' +
      'yoktur; hesap askıya alma ayrı akıştır.',
  })
  @ApiZodBody(createPenaltySchema)
  @ApiZodResponse(201, providerPenaltySchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PROVIDER_NOT_FOUND / DISPUTE_NOT_FOUND')
  @ApiZodResponse(400, apiErrorResponseSchema, 'VALIDATION_FAILED')
  @ApiZodResponse(422, apiErrorResponseSchema, 'PENALTY_INVALID_WINDOW')
  createPenalty(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(createPenaltySchema)) body: CreatePenalty,
    @Req() req: Request,
  ): Promise<ProviderPenalty> {
    return this.quality.createPenalty(user.id, id, body, clientIp(req));
  }

  @Post('penalties/:id/revoke')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yaptırımı kaldırır (gerekçe zorunlu, denetim kaydı).' })
  @ApiZodBody(revokePenaltySchema)
  @ApiZodResponse(200, providerPenaltySchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PENALTY_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'PENALTY_NOT_ACTIVE')
  revokePenalty(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(revokePenaltySchema)) body: RevokePenalty,
    @Req() req: Request,
  ): Promise<ProviderPenalty> {
    return this.quality.revokePenalty(user.id, id, body, clientIp(req));
  }
}
