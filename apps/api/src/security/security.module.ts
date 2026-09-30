import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { AdminPermissionsService } from './admin-permissions.service.js';
import { DataExportService } from './data-export.service.js';
import { RiskSignalsService } from './risk-signals.service.js';
import {
  AdminSecurityController,
  MyAccountController,
  MySessionsController,
} from './security.controller.js';
import { SessionsService } from './sessions.service.js';

/**
 * Sessions, admin permissions, risk signals (docs/adr/0024) and account
 * deletion / data export requests (docs/adr/0027).
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [MySessionsController, MyAccountController, AdminSecurityController],
  providers: [
    SessionsService,
    AdminPermissionsService,
    RiskSignalsService,
    AccountDeletionService,
    DataExportService,
  ],
  exports: [RiskSignalsService],
})
export class SecurityModule {}
