import { Module } from '@nestjs/common';

import { MatchingRepository } from './matching.repository.js';
import { ProviderMatchingService } from './provider-matching.service.js';
import { ResponseStatsService } from './response-stats.service.js';

@Module({
  providers: [MatchingRepository, ResponseStatsService, ProviderMatchingService],
  exports: [MatchingRepository, ResponseStatsService, ProviderMatchingService],
})
export class MatchingModule {}
