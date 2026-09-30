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
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PortfolioItem, UploadIntentResponse } from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CreatePortfolioItem,
  createPortfolioItemSchema,
  type ImageUploadIntent,
  imageUploadIntentSchema,
  portfolioItemSchema,
  type ReorderPortfolio,
  reorderPortfolioSchema,
  type SetProfilePhoto,
  setProfilePhotoSchema,
  type UpdatePortfolioItem,
  updatePortfolioItemSchema,
  uploadIntentResponseSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { PortfolioService } from './portfolio.service.js';
import { ProviderMediaService } from './provider-media.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const IMAGE_ERRORS =
  'INVALID_IMAGE (JPEG/PNG değil, boş veya çok büyük) / UPLOAD_NOT_COMPLETED / UPLOAD_EXPIRED';

@ApiTags('provider-media')
@ApiBearerAuth()
@Roles('PROVIDER')
@Controller('providers/me')
export class ProviderMediaController {
  constructor(
    private readonly media: ProviderMediaService,
    private readonly portfolio: PortfolioService,
  ) {}

  // -- Profile photo ----------------------------------------------------------

  @Post('photo/upload-intent')
  @ApiOperation({
    summary: 'Profil fotoğrafı için imzalı yükleme adresi (JPEG/PNG).',
    description: 'Dosyayı uploadUrl adresine yükleyin, sonra PUT /providers/me/photo çağırın.',
  })
  @ApiZodBody(imageUploadIntentSchema)
  @ApiZodResponse(201, uploadIntentResponseSchema)
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_IMAGE (boyut)')
  photoUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(imageUploadIntentSchema)) body: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    return this.media.createPhotoUploadIntent(user, body);
  }

  @Put('photo')
  @ApiOperation({ summary: 'Yüklenen fotoğrafı profil fotoğrafı yapar (dosya türü doğrulanır).' })
  @ApiZodBody(setProfilePhotoSchema)
  @ApiZodResponse(200, z.object({ photoUrl: z.string() }))
  @ApiZodResponse(422, apiErrorResponseSchema, IMAGE_ERRORS)
  @ApiZodResponse(404, apiErrorResponseSchema, 'UPLOAD_NOT_FOUND')
  setPhoto(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(setProfilePhotoSchema)) body: SetProfilePhoto,
    @Req() req: Request,
  ): Promise<{ photoUrl: string }> {
    return this.media.setPhoto(user, body.uploadId, clientIp(req));
  }

  @Delete('photo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Profil fotoğrafını kaldırır.' })
  deletePhoto(@CurrentUser() user: AuthUser, @Req() req: Request): Promise<void> {
    return this.media.deletePhoto(user, clientIp(req));
  }

  // -- Portfolio --------------------------------------------------------------

  @Get('portfolio')
  @ApiZodResponse(200, z.array(portfolioItemSchema))
  listPortfolio(@CurrentUser() user: AuthUser): Promise<PortfolioItem[]> {
    return this.portfolio.listMine(user);
  }

  @Post('portfolio/upload-intent')
  @ApiOperation({ summary: 'Portföy fotoğrafı için imzalı yükleme adresi (JPEG/PNG).' })
  @ApiZodBody(imageUploadIntentSchema)
  @ApiZodResponse(201, uploadIntentResponseSchema)
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_IMAGE (boyut)')
  portfolioUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(imageUploadIntentSchema)) body: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    return this.portfolio.createUploadIntent(user, body);
  }

  @Post('portfolio')
  @ApiOperation({
    summary: 'Portföy öğesi ekler.',
    description:
      'consentConfirmed: true zorunludur (müşteri yüzü, adres, belge, plaka yok; paylaşım izni var).',
  })
  @ApiZodBody(createPortfolioItemSchema)
  @ApiZodResponse(201, portfolioItemSchema)
  @ApiZodResponse(422, apiErrorResponseSchema, `PORTFOLIO_LIMIT_REACHED / ${IMAGE_ERRORS}`)
  createPortfolio(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPortfolioItemSchema)) body: CreatePortfolioItem,
    @Req() req: Request,
  ): Promise<PortfolioItem> {
    return this.portfolio.create(user, body, clientIp(req));
  }

  // Declared before ":id" routes; the methods differ anyway.
  @Put('portfolio/order')
  @ApiOperation({ summary: 'Portföy sırasını değiştirir (tüm öğeler, yeni sırada).' })
  @ApiZodBody(reorderPortfolioSchema)
  @ApiZodResponse(200, z.array(portfolioItemSchema))
  @ApiZodResponse(422, apiErrorResponseSchema, 'PORTFOLIO_ORDER_INCOMPLETE')
  reorderPortfolio(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(reorderPortfolioSchema)) body: ReorderPortfolio,
    @Req() req: Request,
  ): Promise<PortfolioItem[]> {
    return this.portfolio.reorder(user, body, clientIp(req));
  }

  @Patch('portfolio/:id')
  @ApiZodBody(updatePortfolioItemSchema)
  @ApiZodResponse(200, portfolioItemSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PORTFOLIO_ITEM_NOT_FOUND (başkasının öğesi dahil)')
  updatePortfolio(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updatePortfolioItemSchema)) body: UpdatePortfolioItem,
    @Req() req: Request,
  ): Promise<PortfolioItem> {
    return this.portfolio.update(user, id, body, clientIp(req));
  }

  @Delete('portfolio/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PORTFOLIO_ITEM_NOT_FOUND')
  deletePortfolio(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.portfolio.remove(user, id, clientIp(req));
  }
}
