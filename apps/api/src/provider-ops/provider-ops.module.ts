import { Module } from '@nestjs/common';

import { FinanceModule } from '../finance/finance.module.js';
import { MatchingModule } from '../matching/matching.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { ProviderAvailabilityService } from './availability.service.js';
import { CoverageService } from './coverage.service.js';
import { ProviderHomeService } from './provider-home.service.js';
import { ProviderOpsController } from './provider-ops.controller.js';

@Module({
  imports: [ProvidersModule, MatchingModule, FinanceModule],
  controllers: [ProviderOpsController],
  providers: [CoverageService, ProviderAvailabilityService, ProviderHomeService],
  exports: [CoverageService, ProviderAvailabilityService],
})
export class ProviderOpsModule {}
