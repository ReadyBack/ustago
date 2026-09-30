import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CategoryRef,
  CustomerHome,
  FavoriteProvider,
  Paginated,
  ProviderCard,
  RehireDraft,
  SearchResult,
} from '@ustago/types';
import {
  customerHomeSchema,
  type DiscoverProvidersQuery,
  discoverProvidersQuerySchema,
  popularCategoriesQuerySchema,
  rehireDraftSchema,
  type SearchClick,
  searchClickSchema,
  type SearchQuery,
  searchQuerySchema,
  searchResultSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  MaybeCurrentUser,
  OptionalAuth,
  Roles,
} from '../common/auth/decorators.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DiscoveryService } from './discovery.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const favoritesQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Faz 7 customer discovery (docs/adr/0028): category search, provider
 * listing, favorites, home and rehire. Anonymous callers can search and
 * browse; everything personal needs a customer.
 */
@ApiTags('discovery')
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @OptionalAuth()
  @Get('search')
  @ApiOperation({
    summary:
      'Kategori arama: Türkçe normalizasyon, eş anlamlılar ve yazım toleransı. Sonuç yoksa öneri döner.',
  })
  @ApiZodResponse(200, searchResultSchema)
  search(
    @MaybeCurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
    @Query(new ZodValidationPipe(searchQuerySchema)) query: SearchQuery,
  ): Promise<SearchResult> {
    const subject = user ? `u:${user.id}` : `ip:${clientIp(req) ?? 'unknown'}`;
    return this.discovery.search(subject, query);
  }

  @OptionalAuth()
  @Post('search/click')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arama sonucundan seçilen kategori (analitik).' })
  @ApiZodBody(searchClickSchema)
  async searchClick(
    @Body(new ZodValidationPipe(searchClickSchema)) body: SearchClick,
  ): Promise<void> {
    await this.discovery.searchClick(body);
  }

  @OptionalAuth()
  @Get('categories/popular')
  @ApiOperation({
    summary:
      'Son 30 günde en çok talep açılan kategoriler. Yeterli veri yoksa boş liste döner (uydurma popülerlik yok).',
  })
  popular(
    @Query(new ZodValidationPipe(popularCategoriesQuerySchema)) query: { provinceId?: number },
  ): Promise<CategoryRef[]> {
    return this.discovery.popularCategories(query.provinceId);
  }

  @OptionalAuth()
  @Get('providers')
  @ApiOperation({
    summary:
      'Usta keşfi: kategori ve ilçe/il ile, organik sıralama (MATCH_V1), filtreler ve yaklaşık mesafe.',
  })
  providers(
    @MaybeCurrentUser() user: AuthUser | undefined,
    @Query(new ZodValidationPipe(discoverProvidersQuerySchema)) query: DiscoverProvidersQuery,
  ): Promise<Paginated<ProviderCard>> {
    return this.discovery.listProviders(user, query);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Get('me/favorites')
  @ApiOperation({ summary: 'Favori ustalarım.' })
  favorites(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(favoritesQuerySchema)) query: z.infer<typeof favoritesQuerySchema>,
  ): Promise<Paginated<FavoriteProvider>> {
    return this.discovery.listFavorites(user, query);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Put('me/favorites/:providerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Ustayı favorilere ekler (tekrar çağrı zararsız).' })
  async addFavorite(
    @CurrentUser() user: AuthUser,
    @Param('providerId', idPipe) providerId: string,
  ): Promise<void> {
    await this.discovery.addFavorite(user, providerId);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Delete('me/favorites/:providerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Ustayı favorilerden çıkarır (tekrar çağrı zararsız).' })
  async removeFavorite(
    @CurrentUser() user: AuthUser,
    @Param('providerId', idPipe) providerId: string,
  ): Promise<void> {
    await this.discovery.removeFavorite(user, providerId);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Get('me/home')
  @ApiOperation({
    summary: 'Müşteri ana sayfası: aktif işler, açık talepler, favoriler, yakındaki ustalar.',
  })
  @ApiZodResponse(200, customerHomeSchema)
  home(@CurrentUser() user: AuthUser): Promise<CustomerHome> {
    return this.discovery.home(user);
  }

  @ApiBearerAuth()
  @Roles('CUSTOMER')
  @Get('jobs/:id/rehire')
  @ApiOperation({ summary: 'Tamamlanmış işten "Tekrar çağır" talep taslağı.' })
  @ApiZodResponse(200, rehireDraftSchema)
  rehire(@CurrentUser() user: AuthUser, @Param('id', idPipe) jobId: string): Promise<RehireDraft> {
    return this.discovery.rehireDraft(user, jobId);
  }
}
