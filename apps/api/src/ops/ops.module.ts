import { Module } from '@nestjs/common';

import { FinanceModule } from '../finance/finance.module.js';
import { MetricsController } from './metrics.controller.js';
import { OpsController } from './ops.controller.js';
import { OpsMonitorService } from './ops-monitor.service.js';
import { OpsStatusService } from './ops-status.service.js';
import { ReconciliationRunsService } from './reconciliation-runs.service.js';

@Module({
  imports: [FinanceModule],
  controllers: [OpsController, MetricsController],
  providers: [OpsMonitorService, OpsStatusService, ReconciliationRunsService],
  exports: [OpsMonitorService, ReconciliationRunsService],
})
export class OpsModule {}
