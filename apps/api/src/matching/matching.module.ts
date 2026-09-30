import { Module } from '@nestjs/common';

import { MatchingRepository } from './matching.repository.js';
import { ResponseStatsService } from './response-stats.service.js';

@Module({
  providers: [MatchingRepository, ResponseStatsService],
  exports: [MatchingRepository, ResponseStatsService],
})
export class MatchingModule {}
