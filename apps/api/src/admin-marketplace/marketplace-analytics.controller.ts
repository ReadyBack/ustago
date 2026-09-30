import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminDispatchTimeline,
  AdminMatchPreview,
  CategoryStats,
  MarketplaceOverview,
  NoOfferRequestRow,
  Paginated,
  RegionStats,
} from '@ustago/types';
import {
  adminDispatchTimelineSchema,
  adminMatchPreviewSchema,
  type CategoryStatsQuery,
  categoryStatsQuerySchema,
  categoryStatsSchema,
  type MarketplaceOverviewQuery,
  marketplaceOverviewQuerySchema,
  marketplaceOverviewSchema,
  type MatchPreviewQuery,
  matchPreviewQuerySchema,
  type NoOfferQuery,
  noOfferQuerySchema,
  noOfferRequestRowSchema,
  paginatedSchema,
  type RegionStatsQuery,
  regionStatsQuerySchema,
  regionStatsSchema,
  uuidSchema,
} from '@ustago/validation';
import { z } from 'zod';

import { Roles } from '../common/auth/decorators.js';
import { ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { MarketplaceAnalyticsService } from './marketplace-analytics.service.js';

/**
 * Faz 7 admin marketplace analytics. Same guard as the other admin
 * marketplace read views (staff role ADMIN; SUPER_ADMIN satisfies it).
 * Read-only: no audit entry, like the admin request detail.
 */
@ApiTags('admin: marketplace analytics')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class MarketplaceAnalyticsController {
  constructor(private readonly analytics: MarketplaceAnalyticsService) {}

  @Get('marketplace/overview')
  @ApiOperation({ summary: 'Pazar yeri hunisi, oranlar, bugün ve arama (gerçek kayıtlar).' })
  @ApiZodResponse(200, marketplaceOverviewSchema)
  overview(
    @Query(new ZodValidationPipe(marketplaceOverviewQuerySchema)) query: MarketplaceOverviewQuery,
  ): Promise<MarketplaceOverview> {
    return this.analytics.overview(query);
  }

  @Get('marketplace/regions')
  @ApiOperation({
    summary: 'İl (veya bir ilin ilçeleri) bazında arz ve talep. 5’ten az talepte sayılar gizlenir.',
  })
  @ApiZodResponse(200, z.array(regionStatsSchema))
  regions(
    @Query(new ZodValidationPipe(regionStatsQuerySchema)) query: RegionStatsQuery,
  ): Promise<RegionStats[]> {
    return this.analytics.regions(query);
  }

  @Get('marketplace/categories')
  @ApiOperation({ summary: 'Kategori bazında talep, teklif, kabul, tamamlanma ve medyan fiyat.' })
  @ApiZodResponse(200, z.array(categoryStatsSchema))
  categories(
    @Query(new ZodValidationPipe(categoryStatsQuerySchema)) query: CategoryStatsQuery,
  ): Promise<CategoryStats[]> {
    return this.analytics.categories(query);
  }

  @Get('marketplace/no-offer')
  @ApiOperation({
    summary: 'Yayınlandıktan sonra süre aşımına rağmen teklif almamış açık talepler.',
  })
  @ApiZodResponse(200, paginatedSchema(noOfferRequestRowSchema))
  noOffer(
    @Query(new ZodValidationPipe(noOfferQuerySchema)) query: NoOfferQuery,
  ): Promise<Paginated<NoOfferRequestRow>> {
    return this.analytics.noOffer(query);
  }

  @Get('marketplace/match-preview')
  @ApiOperation({
    summary: 'Canlı MATCH_V1 sıralaması (dağıtım yapmaz, bildirim göndermez, hiçbir şey yazmaz).',
  })
  @ApiZodResponse(200, adminMatchPreviewSchema)
  matchPreview(
    @Query(new ZodValidationPipe(matchPreviewQuerySchema)) query: MatchPreviewQuery,
  ): Promise<AdminMatchPreview> {
    return this.analytics.matchPreview(query.requestId);
  }

  @Get('service-requests/:id/dispatch')
  @ApiOperation({ summary: 'Talebin dağıtım dalgaları, usta satırları ve pazar yeri olayları.' })
  @ApiZodResponse(200, adminDispatchTimelineSchema)
  dispatch(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<AdminDispatchTimeline> {
    return this.analytics.dispatchTimeline(id);
  }
}
