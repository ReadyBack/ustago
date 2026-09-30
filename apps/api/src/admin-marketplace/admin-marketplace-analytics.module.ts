import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';
import { MarketplaceAnalyticsController } from './marketplace-analytics.controller.js';
import { MarketplaceAnalyticsRepository } from './marketplace-analytics.repository.js';
import { MarketplaceAnalyticsService } from './marketplace-analytics.service.js';

/** Faz 7 admin marketplace analytics (read-only). */
@Module({
  imports: [MatchingModule],
  controllers: [MarketplaceAnalyticsController],
  providers: [MarketplaceAnalyticsRepository, MarketplaceAnalyticsService],
})
export class AdminMarketplaceAnalyticsModule {}
