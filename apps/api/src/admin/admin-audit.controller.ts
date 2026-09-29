import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuditEvent, Paginated } from '@ustago/types';
import {
  auditEventSchema,
  type ListAuditEventsQuery,
  listAuditEventsQuerySchema,
  paginatedSchema,
} from '@ustago/validation';

import { Roles } from '../common/auth/decorators.js';
import { ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdminAuditService } from './admin-audit.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/audit-events')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Denetim kayıtları (en yeni önce). entityType/entityId, actorId veya action ile süzülür.',
  })
  @ApiZodResponse(200, paginatedSchema(auditEventSchema))
  list(
    @Query(new ZodValidationPipe(listAuditEventsQuerySchema)) query: ListAuditEventsQuery,
  ): Promise<Paginated<AuditEvent>> {
    return this.audit.list(query);
  }
}
