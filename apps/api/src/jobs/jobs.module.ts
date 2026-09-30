import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { ChangeOrdersService } from './change-orders.service.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { JobStore } from './job.store.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [JobsController],
  providers: [JobsService, JobStore, JobLifecycleService, ChangeOrdersService],
  exports: [JobsService, JobStore],
})
export class JobsModule {}
