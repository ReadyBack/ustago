import { Module } from '@nestjs/common';

import { ImageUploadsService } from './image-uploads.service.js';
import { PortfolioService } from './portfolio.service.js';
import { ProviderMediaController } from './provider-media.controller.js';
import { ProviderMediaService } from './provider-media.service.js';

/**
 * Provider portfolio and profile photo (Faz 7). Exports
 * `ProviderMediaService.photoUrl()` for every card/profile that shows a
 * provider photo and `PortfolioService.publicPortfolio()`.
 */
@Module({
  controllers: [ProviderMediaController],
  providers: [ImageUploadsService, ProviderMediaService, PortfolioService],
  exports: [ImageUploadsService, ProviderMediaService, PortfolioService],
})
export class ProviderMediaModule {}
