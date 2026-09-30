import { Global, Module } from '@nestjs/common';

import { AlertsService } from './alerts.service.js';
import { HeartbeatService } from './heartbeat.service.js';
import { OpsTaskRegistry } from './ops-task-registry.js';
import { RuntimeFlagsService } from './runtime-flags.service.js';

/**
 * Operational building blocks every module may use (docs/adr/0025):
 * alerts, worker heartbeats and feature kill switches.
 */
@Global()
@Module({
  providers: [AlertsService, HeartbeatService, RuntimeFlagsService, OpsTaskRegistry],
  exports: [AlertsService, HeartbeatService, RuntimeFlagsService, OpsTaskRegistry],
})
export class OpsCoreModule {}
