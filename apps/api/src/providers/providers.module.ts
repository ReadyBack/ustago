import { Module } from '@nestjs/common';

import { ProviderCatalogService } from './provider-catalog.service.js';
import { ProviderVerificationsService } from './provider-verifications.service.js';
import { ProviderStore } from './provider.store.js';
import { ProvidersController } from './providers.controller.js';
import { ProvidersService } from './providers.service.js';
import { PublicProvidersService } from './public-providers.service.js';

@Module({
  controllers: [ProvidersController],
  providers: [
    ProviderStore,
    ProvidersService,
    ProviderCatalogService,
    ProviderVerificationsService,
    PublicProvidersService,
  ],
  exports: [ProviderStore],
})
export class ProvidersModule {}
