import {
  Body,
  Controller,
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
  AdminOperationsStatus,
  OperationalAlert,
  Paginated,
  ReconciliationRun,
  RuntimeFlagView,
} from '@ustago/types';
import {
  type ListAlertsQuery,
  listAlertsQuerySchema,
  type ListReconciliationRunsQuery,
  listReconciliationRunsQuerySchema,
  type ResolveAlertRequest,
  resolveAlertRequestSchema,
  type SetRuntimeFlagRequest,
  setRuntimeFlagRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AlertsService } from './alerts.service.js';
import { OpsMonitorService, type OpsMonitorResult } from './ops-monitor.service.js';
import { OpsStatusService } from './ops-status.service.js';
import { ReconciliationRunsService } from './reconciliation-runs.service.js';
import { RuntimeFlagsService } from './runtime-flags.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const flagKeyPipe = new ZodValidationPipe(z.string().regex(/^[a-z_]{2,40}$/));

/** Admin "Operasyon": status, alerts, reconciliation history, kill switches. */
@ApiTags('admin: operations')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class OpsController {
  constructor(
    private readonly status: OpsStatusService,
    private readonly alerts: AlertsService,
    private readonly runs: ReconciliationRunsService,
    private readonly flags: RuntimeFlagsService,
    private readonly monitor: OpsMonitorService,
  ) {}

  @Get('ops/status')
  @ApiOperation({
    summary: 'API, veritabanı, Redis, kuyruk, mutabakat ve uyarı durumu (ölçülmüş).',
  })
  opsStatus(): Promise<AdminOperationsStatus> {
    return this.status.status();
  }

  @Post('ops/monitor/run')
  @RequirePermission('ADMIN_SUPER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Operasyon izleyicisini hemen bir kez çalıştırır (yalnızca süper yönetici).',
  })
  runMonitor(): Promise<OpsMonitorResult> {
    return this.monitor.runOnce();
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Operasyon uyarıları (varsayılan: açık ve alınmış).' })
  listAlerts(
    @Query(new ZodValidationPipe(listAlertsQuerySchema)) query: ListAlertsQuery,
  ): Promise<Paginated<OperationalAlert>> {
    return this.alerts.list(query);
  }

  @Post('alerts/:id/acknowledge')
  @RequirePermission('ADMIN_FINANCE', 'ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Uyarıyı "ilgileniliyor" olarak işaretler.' })
  acknowledge(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<OperationalAlert> {
    return this.alerts.acknowledge(actor.id, id, clientIp(req));
  }

  @Post('alerts/:id/resolve')
  @RequirePermission('ADMIN_FINANCE', 'ADMIN_SUPPORT')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Uyarıyı not ile kapatır. Hiçbir finans kaydını değiştirmez.' })
  @ApiZodBody(resolveAlertRequestSchema)
  resolve(
    @CurrentUser() actor: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(resolveAlertRequestSchema)) body: ResolveAlertRequest,
    @Req() req: Request,
  ): Promise<OperationalAlert> {
    return this.alerts.resolve(actor.id, id, body.note, clientIp(req));
  }

  @Get('finance/reconciliation/runs')
  @ApiOperation({ summary: 'Mutabakat çalıştırma geçmişi (zamanlanmış ve elle).' })
  listRuns(
    @Query(new ZodValidationPipe(listReconciliationRunsQuerySchema))
    query: ListReconciliationRunsQuery,
  ): Promise<Paginated<ReconciliationRun>> {
    return this.runs.list(query);
  }

  @Post('finance/reconciliation/runs')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mutabakatı şimdi çalıştırır ve kaydeder. Hiçbir şeyi düzeltmez.' })
  async runNow(): Promise<ReconciliationRun> {
    const run = await this.runs.run('MANUAL');
    // MANUAL never returns null: a concurrent run is a 409.
    return run as ReconciliationRun;
  }

  @Get('runtime-flags')
  @ApiOperation({ summary: 'Özellik anahtarları: ortam değeri, yönetici değeri ve etkin sonuç.' })
  listFlags(): Promise<RuntimeFlagView[]> {
    return this.flags.list();
  }

  @Put('runtime-flags/:key')
  @RequirePermission('ADMIN_SUPER')
  @ApiOperation({
    summary: 'Bir özelliği geçici kapatır/açar (süper yönetici, gerekçe ve onay zorunlu).',
  })
  @ApiZodBody(setRuntimeFlagRequestSchema)
  setFlag(
    @CurrentUser() actor: AuthUser,
    @Param('key', flagKeyPipe) key: string,
    @Body(new ZodValidationPipe(setRuntimeFlagRequestSchema)) body: SetRuntimeFlagRequest,
    @Req() req: Request,
  ): Promise<RuntimeFlagView> {
    return this.flags.set(actor.id, key, body.enabled, body.reason, clientIp(req));
  }
}
