import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { District, Province } from '@ustago/types';
import {
  districtSchema,
  listProvincesQuerySchema,
  provinceIdParamSchema,
  provinceSchema,
  type UpdateProvinceRequest,
  updateProvinceRequestSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { LocationsService } from './locations.service.js';

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

  @Public()
  @Get('provinces/:id/districts')
  @ApiOperation({ summary: 'İlin aktif ilçeleri.' })
  @ApiZodResponse(200, z.array(districtSchema))
  districts(
    @Param('id', new ZodValidationPipe(provinceIdParamSchema)) id: number,
  ): Promise<District[]> {
    return this.locations.listDistricts(id);
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
    return this.locations.setProvinceActive(actor.id, id, body.isActive, req.ip ?? null);
  }
}
