import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DispatchService } from './dispatch.service.js';

@Module({
  imports: [MatchingModule, NotificationsModule],
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
