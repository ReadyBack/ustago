import { Global, Module } from '@nestjs/common';

import { MarketplaceEventsService } from './marketplace-events.service.js';

@Global()
@Module({
  providers: [MarketplaceEventsService],
  exports: [MarketplaceEventsService],
})
export class AnalyticsModule {}
