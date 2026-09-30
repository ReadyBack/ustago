import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryRepository } from './discovery.repository.js';
import { DiscoveryService } from './discovery.service.js';
import { ProviderCardsBuilder } from './provider-cards.builder.js';

@Module({
  imports: [MatchingModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, DiscoveryRepository, ProviderCardsBuilder],
  exports: [DiscoveryService, ProviderCardsBuilder],
})
export class DiscoveryModule {}
