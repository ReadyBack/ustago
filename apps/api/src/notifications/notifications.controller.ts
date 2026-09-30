import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppNotification } from '@ustago/types';
import {
  appNotificationSchema,
  type MarkNotificationsRead,
  markNotificationsReadSchema,
} from '@ustago/validation';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('me: notifications')
@ApiBearerAuth()
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Uygulama içi bildirimler (en yeni önce, son 30).' })
  @ApiZodResponse(200, z.array(appNotificationSchema))
  list(@CurrentUser() user: AuthUser): Promise<AppNotification[]> {
    return this.notifications.list(user.id);
  }

  @Post('read')
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
}
