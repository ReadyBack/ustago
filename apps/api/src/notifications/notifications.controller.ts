import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AppNotification,
  NotificationPreferences,
  Paginated,
  UnreadNotificationCount,
} from '@ustago/types';
import {
  appNotificationSchema,
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
  type MarkNotificationsRead,
  markNotificationsReadSchema,
  notificationPreferencesSchema,
  paginatedSchema,
  unreadNotificationCountSchema,
  type UpdateNotificationPreferences,
  updateNotificationPreferencesSchema,
} from '@ustago/validation';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('me: notifications')
@ApiBearerAuth()
@Controller('me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({
    summary: 'Uygulama içi bildirimler, en yeni önce; imleçli sayfalama.',
    description:
      'Veritabanındaki bildirim satırları tek doğru kaynaktır; push yalnızca bunların bir kopyasıdır.',
  })
  @ApiZodResponse(200, paginatedSchema(appNotificationSchema))
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<Paginated<AppNotification>> {
    return this.notifications.list(user.id, query);
  }

  @Get('notifications/unread-count')
  @ApiOperation({ summary: 'Okunmamış bildirim sayısı (rozet).' })
  @ApiZodResponse(200, unreadNotificationCountSchema)
  async unread(@CurrentUser() user: AuthUser): Promise<UnreadNotificationCount> {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bildirimleri okundu işaretler; ids yoksa hepsini.' })
  @ApiZodBody(markNotificationsReadSchema)
  @ApiZodResponse(200, z.object({ updated: z.number().int() }))
  async markRead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(markNotificationsReadSchema)) body: MarkNotificationsRead,
  ): Promise<{ updated: number }> {
    return { updated: await this.notifications.markRead(user.id, body.ids) };
  }

  @Get('notification-preferences')
  @ApiOperation({
    summary: 'Bildirim tercihleri.',
    description:
      'İş güncellemeleri (usta yolda, ek iş onayı, tamamlama) işlemsel bildirimdir ve kapatılamaz.',
  })
  @ApiZodResponse(200, notificationPreferencesSchema)
  preferences(@CurrentUser() user: AuthUser): Promise<NotificationPreferences> {
    return this.notifications.preferences(user.id);
  }

  @Patch('notification-preferences')
  @ApiOperation({ summary: 'Teklif ve kampanya push tercihlerini değiştirir.' })
  @ApiZodBody(updateNotificationPreferencesSchema)
  @ApiZodResponse(200, notificationPreferencesSchema)
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateNotificationPreferencesSchema))
    body: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(user.id, body);
  }
}
