import { ConversationsModule } from '../conversations/conversations.module.js';
import { Module } from '@nestjs/common';

import { FinanceModule } from '../finance/finance.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ChangeOrdersService } from './change-orders.service.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { JobStore } from './job.store.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [NotificationsModule, FinanceModule, ConversationsModule],
  controllers: [JobsController],
  providers: [JobsService, JobStore, JobLifecycleService, ChangeOrdersService],
  exports: [JobsService, JobStore],
})
export class JobsModule {}
