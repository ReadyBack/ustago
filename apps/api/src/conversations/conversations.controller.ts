import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminMessageReport,
  AdminReportedConversation,
  BadgeCounts,
  ChatMessage,
  ConversationDetail,
  ConversationListItem,
  MessagePage,
  Paginated,
  SignedUrl,
  UploadIntentResponse,
} from '@ustago/types';
import {
  type AccessReportedConversation,
  accessReportedConversationSchema,
  adminMessageReportSchema,
  apiErrorResponseSchema,
  badgeCountsSchema,
  chatMessageSchema,
  conversationDetailSchema,
  conversationListItemSchema,
  type ImageUploadIntent,
  imageUploadIntentSchema,
  type ListConversationsQuery,
  listConversationsQuerySchema,
  type ListMessageReportsQuery,
  listMessageReportsQuerySchema,
  type ListMessagesQuery,
  listMessagesQuerySchema,
  type MarkConversationRead,
  markConversationReadSchema,
  messagePageSchema,
  type OpenConversation,
  openConversationSchema,
  paginatedSchema,
  type ReportMessage,
  reportMessageSchema,
  type ResolveMessageReport,
  resolveMessageReportSchema,
  type SendMessage,
  sendMessageSchema,
  signedUrlSchema,
  uploadIntentResponseSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ChatMessagesService } from './chat-messages.service.js';
import { ConversationsService } from './conversations.service.js';
import { MessageReportsService } from './message-reports.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const NOT_FOUND = 'CONVERSATION_NOT_FOUND (katılımcı değilseniz de)';

const adminReportedConversationSchema = z.object({
  report: adminMessageReportSchema,
  messages: z.array(chatMessageSchema.extend({ senderName: z.string().nullable() })),
});

/**
 * Faz 7 request/job-bound messaging. Only the two participants see a
 * conversation; everyone else (other customers, other providers, admins)
 * gets 404.
 */
@ApiTags('messages')
@ApiBearerAuth()
@Controller()
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: ChatMessagesService,
  ) {}

  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Teklif veya iş için konuşmayı açar (varsa mevcut olanı döner). Yalnızca talep sahibi müşteri ' +
      've teklif veren usta; teklif olmadan iletişim yoktur.',
  })
  @ApiZodBody(openConversationSchema)
  @ApiZodResponse(200, conversationDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'QUOTE_NOT_FOUND / JOB_NOT_FOUND')
  open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(openConversationSchema)) body: OpenConversation,
  ): Promise<ConversationDetail> {
    return this.conversations.open(user, body);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Konuşmalarım, son mesaja göre yeniden eskiye (imleçli).' })
  @ApiZodResponse(200, paginatedSchema(conversationListItemSchema))
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listConversationsQuerySchema)) query: ListConversationsQuery,
  ): Promise<Paginated<ConversationListItem>> {
    return this.conversations.list(user, query);
  }

  @Get('conversations/:id')
  @ApiZodResponse(200, conversationDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, NOT_FOUND)
  detail(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.detail(user, id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({
    summary:
      'Mesajlar, eskiden yeniye. before=eski sayfa, after=yeni mesajlar (yoklama). SYSTEM mesajları dahil.',
  })
  @ApiZodResponse(200, messagePageSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, NOT_FOUND)
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ): Promise<MessagePage> {
    return this.messages.list(user, id, query);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({
    summary:
      'Metin veya fotoğraf gönderir. Aynı clientMessageId tekrar gönderilirse ilk mesaj döner. ' +
      'Telefon/e-posta maskelenmez, yalnızca containsContactInfo ile işaretlenir.',
  })
  @ApiZodBody(sendMessageSchema)
  @ApiZodResponse(201, chatMessageSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'CONVERSATION_BLOCKED / CONVERSATION_CLOSED')
  @ApiZodResponse(404, apiErrorResponseSchema, `${NOT_FOUND} / UPLOAD_NOT_FOUND`)
  @ApiZodResponse(422, apiErrorResponseSchema, 'INVALID_CHAT_IMAGE / UPLOAD_EXPIRED')
  @ApiZodResponse(429, apiErrorResponseSchema, 'RATE_LIMITED')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessage,
  ): Promise<ChatMessage> {
    return this.messages.send(user, id, body);
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Okundu işareti bu mesaja kadar ilerler (geri gitmez).' })
  @ApiZodBody(markConversationReadSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, `${NOT_FOUND} / MESSAGE_NOT_FOUND`)
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(markConversationReadSchema)) body: MarkConversationRead,
  ): Promise<void> {
    await this.messages.markRead(user, id, body.messageId);
  }

  @Post('conversations/:id/images/upload-intent')
  @ApiOperation({ summary: 'Sohbet fotoğrafı için imzalı yükleme adresi (JPEG/PNG).' })
  @ApiZodBody(imageUploadIntentSchema)
  @ApiZodResponse(201, uploadIntentResponseSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, NOT_FOUND)
  imageUploadIntent(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(imageUploadIntentSchema)) body: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    return this.messages.createImageUploadIntent(user, id, body);
  }

  @Get('messages/:id/image-url')
  @ApiOperation({ summary: 'Fotoğraf için 5 dakikalık imzalı adres; yalnızca katılımcılar.' })
  @ApiZodResponse(200, signedUrlSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'MESSAGE_NOT_FOUND')
  imageUrl(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<SignedUrl> {
    return this.messages.imageUrl(user, id);
  }

  @Post('messages/:id/report')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Karşı tarafın mesajını bildirir (kişi başına bir kez).' })
  @ApiZodBody(reportMessageSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'MESSAGE_NOT_FOUND')
  @ApiZodResponse(422, apiErrorResponseSchema, 'MESSAGE_NOT_REPORTABLE')
  async report(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(reportMessageSchema)) body: ReportMessage,
  ): Promise<void> {
    await this.messages.report(user, id, body);
  }

  @Put('conversations/:id/block')
  @ApiOperation({ summary: 'Karşı tarafı engeller; iki taraf da artık mesaj gönderemez.' })
  @ApiZodResponse(200, conversationDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, NOT_FOUND)
  block(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.setBlock(user, id, true);
  }

  @Delete('conversations/:id/block')
  @ApiOperation({ summary: 'Engeli kaldırır.' })
  @ApiZodResponse(200, conversationDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, NOT_FOUND)
  unblock(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<ConversationDetail> {
    return this.conversations.setBlock(user, id, false);
  }

  @Get('me/badges')
  @ApiOperation({ summary: 'Rozetler: okunmamış bildirim ve okunmamış mesaj sayısı.' })
  @ApiZodResponse(200, badgeCountsSchema)
  badges(@CurrentUser() user: AuthUser): Promise<BadgeCounts> {
    return this.conversations.badges(user);
  }
}

/** Support: reported messages. Bodies only through /access, with a reason (audited). */
@ApiTags('admin: messages')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/message-reports')
export class AdminMessageReportsController {
  constructor(private readonly reports: MessageReportsService) {}

  @Get()
  @RequirePermission('ADMIN_SUPPORT')
  @ApiOperation({ summary: 'Mesaj bildirimleri (mesaj içeriği yok).' })
  @ApiZodResponse(200, paginatedSchema(adminMessageReportSchema))
  list(
    @Query(new ZodValidationPipe(listMessageReportsQuerySchema)) query: ListMessageReportsQuery,
  ): Promise<Paginated<AdminMessageReport>> {
    return this.reports.list(query);
  }

  @Post(':id/access')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bildirilen konuşmayı gerekçeyle açar; her açılış denetim kaydına yazılır.',
  })
  @ApiZodBody(accessReportedConversationSchema)
  @ApiZodResponse(200, adminReportedConversationSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'MESSAGE_REPORT_NOT_FOUND')
  access(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(accessReportedConversationSchema)) body: AccessReportedConversation,
    @Req() req: Request,
  ): Promise<AdminReportedConversation> {
    return this.reports.access(user, id, body, clientIp(req));
  }

  @Post(':id/resolve')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(resolveMessageReportSchema)
  @ApiZodResponse(200, adminMessageReportSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'MESSAGE_REPORT_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'MESSAGE_REPORT_ALREADY_RESOLVED')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(resolveMessageReportSchema)) body: ResolveMessageReport,
    @Req() req: Request,
  ): Promise<AdminMessageReport> {
    return this.reports.resolve(user, id, body, clientIp(req));
  }
}
