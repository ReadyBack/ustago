import { Body, Controller, Get, Param, Patch, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { District, Province, ProvinceCategorySetting } from '@ustago/types';
import {
  districtSchema,
  listDistrictsQuerySchema,
  listProvincesQuerySchema,
  provinceCategorySettingSchema,
  provinceIdParamSchema,
  provinceSchema,
  type UpdateProvinceCategoryRequest,
  updateProvinceCategoryRequestSchema,
  type UpdateProvinceRequest,
  updateProvinceRequestSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import {
  type AuthUser,
  CurrentUser,
  MaybeCurrentUser,
  OptionalAuth,
  Public,
  Roles,
} from '../common/auth/decorators.js';
import { forbidden } from '../common/http/errors.js';
import { effectiveRoles } from '../auth/roles.guard.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { LocationsService } from './locations.service.js';
import { clientIp } from '../common/http/client-context.js';

@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Public()
  @Get('provinces')
  @ApiOperation({ summary: '81 il (plaka koduna göre). active=true sadece açık iller.' })
  @ApiZodResponse(200, z.array(provinceSchema))
  provinces(
    @Query(new ZodValidationPipe(listProvincesQuerySchema)) query: { active?: 'true' | 'false' },
  ): Promise<Province[]> {
    return this.locations.listProvinces(query.active === 'true');
  }

  @OptionalAuth()
  @Get('provinces/:id/districts')
  @ApiOperation({
    summary: 'İlin aktif ilçeleri. includeInactive=true yalnızca admin içindir.',
  })
  @ApiZodResponse(200, z.array(districtSchema))
  districts(
    @MaybeCurrentUser() user: AuthUser | undefined,
    @Param('id', new ZodValidationPipe(provinceIdParamSchema)) id: number,
    @Query(new ZodValidationPipe(listDistrictsQuerySchema))
    query: { includeInactive?: 'true' | 'false' },
  ): Promise<District[]> {
    return this.locations.listDistricts(id, adminOnly(user, query.includeInactive));
  }

  @OptionalAuth()
  @Get('provinces/:id/categories')
  @ApiOperation({
    summary:
      'İlde açık kategoriler ve NOW durumu (kategori varsayılanı + il ayarı). includeInactive=true yalnızca admin içindir.',
  })
  @ApiZodResponse(200, z.array(provinceCategorySettingSchema))
  categories(
    @MaybeCurrentUser() user: AuthUser | undefined,
    @Param('id', new ZodValidationPipe(provinceIdParamSchema)) id: number,
    @Query(new ZodValidationPipe(listDistrictsQuerySchema))
    query: { includeInactive?: 'true' | 'false' },
  ): Promise<ProvinceCategorySetting[]> {
    return this.locations.listProvinceCategories(id, adminOnly(user, query.includeInactive));
  }

  @Put('provinces/:id/categories/:categoryId')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bir kategoriyi bu ilde açar/kapatır, NOW durumunu belirler.' })
  @ApiZodBody(updateProvinceCategoryRequestSchema)
  @ApiZodResponse(200, provinceCategorySettingSchema)
  updateProvinceCategory(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(provinceIdParamSchema)) id: number,
    @Param('categoryId', new ZodValidationPipe(z.uuid())) categoryId: string,
    @Body(new ZodValidationPipe(updateProvinceCategoryRequestSchema))
    body: UpdateProvinceCategoryRequest,
    @Req() req: Request,
  ): Promise<ProvinceCategorySetting> {
    return this.locations.setProvinceCategory(actor.id, id, categoryId, body, clientIp(req));
  }

  @Patch('provinces/:id')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'İli pazaryerinde açar veya kapatır.' })
  @ApiZodBody(updateProvinceRequestSchema)
  @ApiZodResponse(200, provinceSchema)
  updateProvince(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(provinceIdParamSchema)) id: number,
    @Body(new ZodValidationPipe(updateProvinceRequestSchema)) body: UpdateProvinceRequest,
    @Req() req: Request,
  ): Promise<Province> {
    return this.locations.setProvinceActive(actor.id, id, body, clientIp(req));
  }
}

/** `includeInactive` is an admin tool; anyone else asking for it is refused. */
function adminOnly(user: AuthUser | undefined, flag: 'true' | 'false' | undefined): boolean {
  if (flag !== 'true') return false;
  if (!user || !effectiveRoles(user.roles).has('ADMIN')) {
    throw forbidden('FORBIDDEN', 'Bu işlem için yetkiniz yok.');
  }
  return true;
}
