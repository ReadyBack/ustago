import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CategoryQuestion, PriceGuide, RequestForm } from '@ustago/types';
import {
  apiErrorResponseSchema,
  categoryQuestionSchema,
  type CreateCategoryAlias,
  createCategoryAliasSchema,
  type CreateCategoryQuestion,
  createCategoryQuestionSchema,
  type PriceGuideQuery,
  priceGuideQuerySchema,
  priceGuideSchema,
  requestFormSchema,
  type UpdateCategoryQuestion,
  updateCategoryQuestionSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CategoryContentService } from './category-content.service.js';
import { PriceGuideService } from './price-guide.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const aliasSchema = z.object({ id: z.uuid(), alias: z.string() });

@ApiTags('categories')
@Controller('categories')
export class CategoryContentController {
  constructor(
    private readonly content: CategoryContentService,
    private readonly prices: PriceGuideService,
  ) {}

  @Public()
  @Get(':id/request-form')
  @ApiOperation({
    summary: 'Talep sihirbazı: kategorinin etkin soruları, fotoğraf kuralı ve sınırları.',
  })
  @ApiZodResponse(200, requestFormSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'CATEGORY_NOT_FOUND')
  requestForm(@Param('id', idPipe) id: string): Promise<RequestForm> {
    return this.content.requestForm(id);
  }

  @Public()
  @Get(':id/price-guide')
  @ApiOperation({
    summary: 'Gerçek tamamlanan işlerden fiyat aralığı (son 180 gün).',
    description:
      'Önce il, yetersizse ülke geneli. Yeterli iş veya usta yoksa INSUFFICIENT_DATA ' +
      '("Henüz yeterli veri yok"). Uç değerler (IQR dışı) hesaba katılmaz.',
  })
  @ApiZodResponse(200, priceGuideSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'CATEGORY_NOT_FOUND')
  priceGuide(
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(priceGuideQuerySchema)) query: PriceGuideQuery,
  ): Promise<PriceGuide> {
    return this.prices.guide(id, query.provinceId);
  }
}

/** Admin: request-form questions and search aliases. Same role as category admin. */
@ApiTags('admin-categories')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class CategoryAdminController {
  constructor(private readonly content: CategoryContentService) {}

  @Get('categories/:id/questions')
  @ApiOperation({ summary: 'Kategorinin tüm soruları (pasifler dahil).' })
  @ApiZodResponse(200, z.array(categoryQuestionSchema))
  listQuestions(@Param('id', idPipe) id: string): Promise<CategoryQuestion[]> {
    return this.content.listQuestions(id);
  }

  @Post('categories/:id/questions')
  @ApiZodBody(createCategoryQuestionSchema)
  @ApiZodResponse(201, categoryQuestionSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'QUESTION_KEY_TAKEN')
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_QUESTION / QUESTION_LIMIT_REACHED')
  createQuestion(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(createCategoryQuestionSchema)) body: CreateCategoryQuestion,
    @Req() req: Request,
  ): Promise<CategoryQuestion> {
    return this.content.createQuestion(actor.id, id, body, clientIp(req));
  }

  @Patch('category-questions/:id')
  @ApiOperation({ summary: 'Soruyu günceller. Silme yok: isActive=false ile kapatılır.' })
  @ApiZodBody(updateCategoryQuestionSchema)
  @ApiZodResponse(200, categoryQuestionSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'QUESTION_NOT_FOUND')
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_QUESTION / QUESTION_LIMIT_REACHED')
  updateQuestion(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateCategoryQuestionSchema)) body: UpdateCategoryQuestion,
    @Req() req: Request,
  ): Promise<CategoryQuestion> {
    return this.content.updateQuestion(actor.id, id, body, clientIp(req));
  }

  @Get('categories/:id/aliases')
  @ApiZodResponse(200, z.array(aliasSchema))
  listAliases(@Param('id', idPipe) id: string): Promise<{ id: string; alias: string }[]> {
    return this.content.listAliases(id);
  }

  @Post('categories/:id/aliases')
  @ApiOperation({ summary: 'Arama eş anlamlısı ekler ("elektrikçi" → Elektrik).' })
  @ApiZodBody(createCategoryAliasSchema)
  @ApiZodResponse(201, aliasSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'ALIAS_TAKEN / ALIAS_MATCHES_CATEGORY_NAME')
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_ALIAS / ALIAS_LIMIT_REACHED')
  createAlias(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(createCategoryAliasSchema)) body: CreateCategoryAlias,
    @Req() req: Request,
  ): Promise<{ id: string; alias: string }> {
    return this.content.createAlias(actor.id, id, body, clientIp(req));
  }

  @Delete('category-aliases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiZodResponse(404, apiErrorResponseSchema, 'ALIAS_NOT_FOUND')
  deleteAlias(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.content.deleteAlias(actor.id, id, clientIp(req));
  }
}
