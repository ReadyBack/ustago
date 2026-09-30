import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminFeePolicy, FeePreviewLine } from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CreateFeePolicyRequest,
  createFeePolicyRequestSchema,
  type FeePreviewQuery,
  feePreviewQuerySchema,
  publishFeePolicyRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { clientIp } from '../common/http/client-context.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { FeePoliciesAdminService } from './fee-policies-admin.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);

/** "Komisyon Politikaları" (docs/adr/0025). Changes need ADMIN_FINANCE. */
@ApiTags('admin: finance')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/fee-policies')
export class AdminFeePoliciesController {
  constructor(private readonly policies: FeePoliciesAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Komisyon politikaları ve durumları (DRAFT/SCHEDULED/ACTIVE/RETIRED).' })
  list(): Promise<AdminFeePolicy[]> {
    return this.policies.list();
  }

  @Get('preview')
  @ApiOperation({ summary: '₺500, ₺1.000, ₺2.500, ₺5.000 ve ₺10.000 için komisyon ve usta neti.' })
  preview(
    @Query(new ZodValidationPipe(feePreviewQuerySchema)) query: FeePreviewQuery,
  ): FeePreviewLine[] {
    return this.policies.preview(query);
  }

  @Post()
  @RequirePermission('ADMIN_FINANCE')
  @ApiOperation({ summary: 'Taslak politika oluşturur. Yayınlanana kadar hiçbir işe uygulanmaz.' })
  @ApiZodBody(createFeePolicyRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'FEE_POLICY_CODE_TAKEN')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFeePolicyRequestSchema)) body: CreateFeePolicyRequest,
    @Req() req: Request,
  ): Promise<AdminFeePolicy> {
    return this.policies.create(user, body, clientIp(req));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_FINANCE')
  @ApiOperation({ summary: 'Taslağı yayınlar; bundan sonra değiştirilemez.' })
  @ApiZodBody(publishFeePolicyRequestSchema)
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'FEE_POLICY_ALREADY_PUBLISHED / FEE_POLICY_START_CONFLICT',
  )
  @ApiZodResponse(422, apiErrorResponseSchema, 'FEE_POLICY_START_IN_PAST')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(publishFeePolicyRequestSchema)) _body: unknown,
    @Req() req: Request,
  ): Promise<AdminFeePolicy> {
    return this.policies.publish(user, id, clientIp(req));
  }

  @Post(':id/retire')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ADMIN_FINANCE')
  @ApiOperation({ summary: 'Henüz başlamamış (SCHEDULED) politikayı iptal eder.' })
  @ApiZodBody(publishFeePolicyRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'FEE_POLICY_NOT_RETIRABLE')
  retire(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(publishFeePolicyRequestSchema)) _body: unknown,
    @Req() req: Request,
  ): Promise<AdminFeePolicy> {
    return this.policies.retire(user, id, clientIp(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('ADMIN_FINANCE')
  deleteDraft(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.policies.deleteDraft(user, id, clientIp(req));
  }
}
