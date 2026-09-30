import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Paginated,
  ProviderReviewReply,
  PublicReview,
  Review,
  ReviewDistribution,
} from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CreateReview,
  createReviewSchema,
  type ListProviderReviewsQuery,
  listProviderReviewsQuerySchema,
  paginatedSchema,
  publicReviewSchema,
  type ReplyToReview,
  replyToReviewSchema,
  reviewSchema,
  type UpdateReview,
  updateReviewSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ReviewsService } from './reviews.service.js';
import { clientIp } from '../common/http/client-context.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const reviewDistributionSchema = z.object({
  five: z.number().int(),
  four: z.number().int(),
  three: z.number().int(),
  two: z.number().int(),
  one: z.number().int(),
});

@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('jobs/:id/review')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Müşteri tamamlanan işi değerlendirir (iş başına bir kez). Genel puan zorunlu, detay puanları ve ' +
      'yorum (en çok 1000 karakter, düz metin) isteğe bağlı.',
  })
  @ApiZodBody(createReviewSchema)
  @ApiZodResponse(201, reviewSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'REVIEW_NOT_ALLOWED (müşteri değil)')
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND')
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'REVIEW_NOT_ALLOWED (iş tamamlanmadı) / REVIEW_ALREADY_EXISTS',
  )
  @ApiZodResponse(429, apiErrorResponseSchema, 'RATE_LIMITED')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) jobId: string,
    @Body(new ZodValidationPipe(createReviewSchema)) body: CreateReview,
    @Req() req: Request,
  ): Promise<Review> {
    return this.reviews.create(user, jobId, body, clientIp(req));
  }

  @Patch('reviews/:id')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Yazar değerlendirmesini ilk 30 gün düzenler; önceki değerler denetim kaydına yazılır.',
  })
  @ApiZodBody(updateReviewSchema)
  @ApiZodResponse(200, reviewSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'REVIEW_NOT_FOUND (başkasının yorumu dahil)')
  @ApiZodResponse(409, apiErrorResponseSchema, 'REVIEW_NOT_EDITABLE')
  @ApiZodResponse(429, apiErrorResponseSchema, 'RATE_LIMITED')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateReviewSchema)) body: UpdateReview,
    @Req() req: Request,
  ): Promise<Review> {
    return this.reviews.update(user, id, body, clientIp(req));
  }

  @Public()
  @Get('providers/:id/reviews')
  @ApiOperation({
    summary:
      'Ustanın yayındaki değerlendirmeleri. sort=NEWEST|HIGHEST|LOWEST, rating=1-5 filtresi; ' +
      'cursor = önceki sayfanın son yorum kimliği. Yazar adı maskelidir ("Ayşe K."); ' +
      'telefon, adres, iş kimliği yoktur. Usta cevabı `reply` alanındadır.',
  })
  @ApiZodResponse(200, paginatedSchema(publicReviewSchema))
  @ApiZodResponse(404, apiErrorResponseSchema, 'PROVIDER_NOT_FOUND')
  listForProvider(
    @Param('id', idPipe) providerId: string,
    @Query(new ZodValidationPipe(listProviderReviewsQuerySchema)) query: ListProviderReviewsQuery,
  ): Promise<Paginated<PublicReview>> {
    return this.reviews.listForProvider(providerId, query);
  }

  @Public()
  @Get('providers/:id/review-distribution')
  @ApiOperation({ summary: 'Yayındaki değerlendirmelerin yıldız dağılımı (5 → 1).' })
  @ApiZodResponse(200, reviewDistributionSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PROVIDER_NOT_FOUND')
  distribution(@Param('id', idPipe) providerId: string): Promise<ReviewDistribution> {
    return this.reviews.distribution(providerId);
  }

  @Post('reviews/:id/reply')
  @Roles('PROVIDER')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Değerlendirilen usta yoruma bir kez, herkese açık ve düz metin cevap verir (en çok 1000 karakter).',
  })
  @ApiZodBody(replyToReviewSchema)
  @ApiZodResponse(201, z.object({ body: z.string(), createdAt: z.iso.datetime() }))
  @ApiZodResponse(404, apiErrorResponseSchema, 'REVIEW_NOT_FOUND (başka ustanın yorumu dahil)')
  @ApiZodResponse(409, apiErrorResponseSchema, 'REVIEW_REPLY_EXISTS / REVIEW_NOT_REPLYABLE')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(replyToReviewSchema)) body: ReplyToReview,
    @Req() req: Request,
  ): Promise<ProviderReviewReply> {
    return this.reviews.reply(user, id, body, clientIp(req));
  }
}
