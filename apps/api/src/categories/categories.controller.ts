import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ServiceCategory, ServiceCategoryNode } from '@ustago/types';
import {
  type CreateCategoryRequest,
  createCategoryRequestSchema,
  serviceCategorySchema,
  type UpdateCategoryRequest,
  updateCategoryRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CategoriesService } from './categories.service.js';

const categoryNodeSchema = serviceCategorySchema.extend({
  children: z.array(serviceCategorySchema),
});
const slugParamSchema = z.string().trim().min(1).max(80);

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Aktif hizmet kategorileri (ağaç).' })
  @ApiZodResponse(200, z.array(categoryNodeSchema))
  list(): Promise<ServiceCategoryNode[]> {
    return this.categories.listActiveTree();
  }

  @Public()
  @Get(':slug')
  @ApiZodResponse(200, categoryNodeSchema)
  get(
    @Param('slug', new ZodValidationPipe(slugParamSchema)) slug: string,
  ): Promise<ServiceCategoryNode> {
    return this.categories.getActiveBySlug(slug);
  }

  @Post()
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiZodBody(createCategoryRequestSchema)
  @ApiZodResponse(201, serviceCategorySchema)
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createCategoryRequestSchema)) body: CreateCategoryRequest,
    @Req() req: Request,
  ): Promise<ServiceCategory> {
    return this.categories.create(actor.id, body, req.ip ?? null);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kategoriyi günceller; isActive ile açıp kapatır.' })
  @ApiZodBody(updateCategoryRequestSchema)
  @ApiZodResponse(200, serviceCategorySchema)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateCategoryRequestSchema)) body: UpdateCategoryRequest,
    @Req() req: Request,
  ): Promise<ServiceCategory> {
    return this.categories.update(actor.id, id, body, req.ip ?? null);
  }
}
