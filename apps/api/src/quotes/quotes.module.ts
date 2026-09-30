import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MatchingModule } from '../matching/matching.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { OpportunitiesService } from './opportunities.service.js';
import { ProviderCardsService } from './provider-cards.service.js';
import { ProviderMarketplaceController, QuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [
    ServiceRequestsModule,
    JobsModule,
    MatchingModule,
    NotificationsModule,
    ProvidersModule,
    DispatchModule,
    ConversationsModule,
  ],
  controllers: [QuotesController, ProviderMarketplaceController],
  providers: [QuotesService, OpportunitiesService, ProviderCardsService],
})
export class QuotesModule {}
