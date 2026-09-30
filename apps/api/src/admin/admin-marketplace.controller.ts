import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminDashboardStats,
  AdminServiceRequestDetail,
  AdminServiceRequestListItem,
  AdminSystemStatus,
  Paginated,
} from '@ustago/types';
import {
  adminDashboardStatsSchema,
  adminServiceRequestDetailSchema,
  adminServiceRequestListItemSchema,
  type AdminStatsQuery,
  adminStatsQuerySchema,
  adminSystemStatusSchema,
  type ListAdminServiceRequestsQuery,
  listAdminServiceRequestsQuerySchema,
  paginatedSchema,
  uuidSchema,
} from '@ustago/validation';

import { Roles } from '../common/auth/decorators.js';
import { ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdminMarketplaceService } from './admin-marketplace.service.js';

@ApiTags('admin: marketplace')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminMarketplaceController {
  constructor(private readonly admin: AdminMarketplaceService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Dashboard sayıları (gerçek veritabanı). tz: "bugün" için IANA saat dilimi.',
  })
  @ApiZodResponse(200, adminDashboardStatsSchema)
  stats(
    @Query(new ZodValidationPipe(adminStatsQuerySchema)) query: AdminStatsQuery,
  ): Promise<AdminDashboardStats> {
    return this.admin.stats(query.tz);
  }

  @Get('service-requests')
  @ApiOperation({ summary: 'İş talepleri; status, type, provinceId, categoryId filtreleri.' })
  @ApiZodResponse(200, paginatedSchema(adminServiceRequestListItemSchema))
  list(
    @Query(new ZodValidationPipe(listAdminServiceRequestsQuerySchema))
    query: ListAdminServiceRequestsQuery,
  ): Promise<Paginated<AdminServiceRequestListItem>> {
    return this.admin.listRequests(query);
  }

  @Get('service-requests/:id')
  @ApiOperation({
    summary: 'Talep detayı: teklifler, revizyonlar ve iş. Telefon maskeli, açık adres yok.',
  })
  @ApiZodResponse(200, adminServiceRequestDetailSchema)
  detail(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<AdminServiceRequestDetail> {
    return this.admin.requestDetail(id);
  }

  @Get('system-status')
  @ApiOperation({ summary: 'Ortam, sürücüler, veritabanı ve Redis durumu. Secret içermez.' })
  @ApiZodResponse(200, adminSystemStatusSchema)
  systemStatus(): Promise<AdminSystemStatus> {
    return this.admin.systemStatus();
  }
}
