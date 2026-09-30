import { Module } from '@nestjs/common';

import { HealthModule } from '../health/health.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminMarketplaceController } from './admin-marketplace.controller.js';
import { AdminMarketplaceService } from './admin-marketplace.service.js';
import { AdminProvidersController } from './admin-providers.controller.js';
import { AdminProvidersService } from './admin-providers.service.js';

@Module({
  imports: [ProvidersModule, HealthModule],
  controllers: [AdminProvidersController, AdminAuditController, AdminMarketplaceController],
  providers: [AdminProvidersService, AdminAuditService, AdminMarketplaceService],
})
export class AdminModule {}
