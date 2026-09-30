import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProviderMediaModule } from '../provider-media/provider-media.module.js';
import { ProviderCatalogService } from './provider-catalog.service.js';
import { ProviderVerificationsService } from './provider-verifications.service.js';
import { ProviderStore } from './provider.store.js';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';
import { PublicProvidersService } from './public-providers.service.js';
import { SuspensionsService } from './suspensions.service.js';
import { VerificationCaseService } from './verification-case.service.js';

@Module({
  imports: [NotificationsModule, MatchingModule, ProviderMediaModule],
  controllers: [ProvidersController],
  providers: [
    ProviderStore,
    ProvidersService,
    ProviderCatalogService,
    ProviderVerificationsService,
    PublicProvidersService,
    VerificationCaseService,
    SuspensionsService,
  ],
  exports: [ProviderStore, VerificationCaseService, SuspensionsService],
})
export class ProvidersModule {}
