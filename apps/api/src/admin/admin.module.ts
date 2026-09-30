import { Module } from '@nestjs/common';

import { FinanceModule } from '../finance/finance.module.js';
import { HealthModule } from '../health/health.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProvidersModule } from '../providers/providers.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminJobsController } from './admin-jobs.controller.js';
import { AdminJobsService } from './admin-jobs.service.js';
import { AdminMarketplaceController } from './admin-marketplace.controller.js';
import { AdminMarketplaceService } from './admin-marketplace.service.js';
import { AdminProvidersController } from './admin-providers.controller.js';
import { AdminProvidersService } from './admin-providers.service.js';

@Module({
  imports: [ProvidersModule, HealthModule, NotificationsModule, FinanceModule],
  controllers: [
    AdminProvidersController,
    AdminAuditController,
    AdminMarketplaceController,
    AdminJobsController,
  ],
  providers: [AdminProvidersService, AdminAuditService, AdminMarketplaceService, AdminJobsService],
})
export class AdminModule {}
