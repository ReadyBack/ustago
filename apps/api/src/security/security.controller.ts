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
  AccountDeletionRequestView,
  ActiveSession,
  AdminUserPermissions,
  DataExportRequestView,
  Paginated,
  RiskSignal,
} from '@ustago/types';
import {
  type FlagUserRequest,
  flagUserRequestSchema,
  type ListRiskSignalsQuery,
  listRiskSignalsQuerySchema,
  requestAccountDeletionSchema,
  type ReviewRiskSignalRequest,
  reviewRiskSignalRequestSchema,
  type SetAdminPermissionsRequest,
  setAdminPermissionsRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { AdminPermissionsService } from './admin-permissions.service.js';
import { DataExportService } from './data-export.service.js';
import { RiskSignalsService } from './risk-signals.service.js';
import { SessionsService } from './sessions.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** "Aktif Oturumlar" for every signed-in user. */
@ApiTags('me: sessions')
@ApiBearerAuth()
@Controller('me/sessions')
export class MySessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'Açık oturumlarım: cihaz, platform, son kullanım (ham IP yok).' })
  list(@CurrentUser() user: AuthUser): Promise<ActiveSession[]> {
    return this.sessions.list(user.id, user.sessionId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Bir oturumu kapatır. Başkasının oturumu 404 döner.' })
  async revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.sessions.revoke(user.id, id, clientIp(req));
  }
}

/** Account deletion and data export requests (docs/adr/0027). */
@ApiTags('me: account')
@ApiBearerAuth()
@Controller('me')
export class MyAccountController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly exports: DataExportService,
  ) {}

  @Get('account-deletion')
  deletionStatus(@CurrentUser() user: AuthUser): Promise<AccountDeletionRequestView | null> {
    return this.deletion.current(user.id);
  }

  @Post('account-deletion')
  @ApiOperation({
    summary:
      'Hesap silme talebi. Bekleme süresi sonunda, açık iş/itiraz/para çekme yoksa kişisel veriler takma adlandırılır.',
  })
  @ApiZodBody(requestAccountDeletionSchema)
  requestDeletion(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(requestAccountDeletionSchema)) _body: unknown,
    @Req() req: Request,
  ): Promise<AccountDeletionRequestView> {
    return this.deletion.request(user.id, clientIp(req));
  }

  @Delete('account-deletion')
  @ApiOperation({ summary: 'Bekleme süresindeki silme talebini iptal eder.' })
  cancelDeletion(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<AccountDeletionRequestView> {
    return this.deletion.cancel(user.id, clientIp(req));
  }

  @Get('data-exports')
  listExports(@CurrentUser() user: AuthUser): Promise<DataExportRequestView[]> {
    return this.exports.list(user.id);
  }

  @Post('data-exports')
  @ApiOperation({
    summary:
      'Kişisel veri dışa aktarma talebini kaydeder. Arşiv üretimi henüz yok; talep elle işlenir.',
  })
  requestExport(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<DataExportRequestView> {
    return this.exports.request(user.id, clientIp(req));
  }
}

/** Admin permissions and risk signals (docs/adr/0024). */
@ApiTags('admin: security')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminSecurityController {
  constructor(
    private readonly permissions: AdminPermissionsService,
    private readonly risk: RiskSignalsService,
  ) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Yöneticiler ve yetkileri.' })
  listPermissions(): Promise<AdminUserPermissions[]> {
    return this.permissions.list();
  }

  @Put('users/:id/permissions')
  @RequirePermission('ADMIN_SUPER')
  @ApiOperation({
    summary: 'Yönetici yetkilerini ayarlar (yalnızca ADMIN_SUPER; kendi yetkisini değiştiremez).',
  })
  @ApiZodBody(setAdminPermissionsRequestSchema)
  setPermissions(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(setAdminPermissionsRequestSchema)) body: SetAdminPermissionsRequest,
    @Req() req: Request,
  ): Promise<AdminUserPermissions> {
    return this.permissions.set(actor, id, body, clientIp(req));
  }

  @Get('risk-signals')
  @ApiOperation({ summary: 'Risk sinyalleri: kanıt listesi, otomatik karar yok.' })
  listRisk(
    @Query(new ZodValidationPipe(listRiskSignalsQuerySchema)) query: ListRiskSignalsQuery,
  ): Promise<Paginated<RiskSignal>> {
    return this.risk.list(query);
  }

  @Post('risk-signals/:id/review')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiZodBody(reviewRiskSignalRequestSchema)
  async reviewRisk(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(reviewRiskSignalRequestSchema)) body: ReviewRiskSignalRequest,
    @Req() req: Request,
  ): Promise<void> {
    await this.risk.review(actor.id, id, body, clientIp(req));
  }

  @Post('users/:id/flag')
  @RequirePermission('ADMIN_SUPPORT')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Kullanıcıyı takip için işaretler (ADMIN_FLAG risk sinyali).' })
  @ApiZodBody(flagUserRequestSchema)
  async flag(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(flagUserRequestSchema)) body: FlagUserRequest,
    @Req() req: Request,
  ): Promise<void> {
    await this.risk.flagUser(actor.id, id, body.note, clientIp(req));
  }
}
