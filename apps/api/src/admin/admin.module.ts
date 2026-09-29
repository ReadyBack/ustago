import { Module } from '@nestjs/common';

import { ProvidersModule } from '../providers/providers.module.js';
import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminProvidersController } from './admin-providers.controller.js';
import { AdminProvidersService } from './admin-providers.service.js';

@Module({
  imports: [ProvidersModule],
  controllers: [AdminProvidersController, AdminAuditController],
  providers: [AdminProvidersService, AdminAuditService],
})
export class AdminModule {}
