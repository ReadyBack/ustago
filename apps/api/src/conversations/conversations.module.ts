import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module.js';
import { ChatMessagesService } from './chat-messages.service.js';
import {
  AdminMessageReportsController,
  ConversationsController,
} from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { MessageReportsService } from './message-reports.service.js';

/**
 * Faz 7 request/job-bound chat. Other modules import this module and call
 * ConversationsService.postSystemEventIn(tx, ...) inside their transaction.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ConversationsController, AdminMessageReportsController],
  providers: [ConversationsService, ChatMessagesService, MessageReportsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
