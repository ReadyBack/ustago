import { Body, Controller, Delete, Get, Param, Patch, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserDto, Paginated } from '@ustago/types';
import {
  currentUserSchema,
  type ListUsersQuery,
  listUsersQuerySchema,
  paginatedSchema,
  type StaffRole,
  staffRoleSchema,
  type UpdateUserStatusRequest,
  updateUserStatusRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

/** Back-office user management. */
@ApiTags('users (admin)')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Kullanıcıları listeler (en yeni önce, cursor sayfalama).' })
  @ApiZodResponse(200, paginatedSchema(currentUserSchema))
  list(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<Paginated<CurrentUserDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiZodResponse(200, currentUserSchema)
  get(@Param('id', new ZodValidationPipe(uuidSchema)) id: string): Promise<CurrentUserDto> {
    return this.users.getById(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Hesabı askıya alır, yasaklar veya yeniden açar.' })
  @ApiZodBody(updateUserStatusRequestSchema)
  @ApiZodResponse(200, currentUserSchema)
  updateStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateUserStatusRequestSchema)) body: UpdateUserStatusRequest,
    @Req() req: Request,
  ): Promise<CurrentUserDto> {
    return this.users.updateStatus(actor, id, body, req.ip ?? null);
  }

  @Put(':id/roles/:role')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'ADMIN veya SUPER_ADMIN rolü verir (yalnızca SUPER_ADMIN).' })
  @ApiZodResponse(200, currentUserSchema)
  grantRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('role', new ZodValidationPipe(staffRoleSchema)) role: StaffRole,
    @Req() req: Request,
  ): Promise<CurrentUserDto> {
    return this.users.grantStaffRole(actor, id, role, req.ip ?? null);
  }

  @Delete(':id/roles/:role')
  @Roles('SUPER_ADMIN')
  @ApiOperation({ summary: 'ADMIN veya SUPER_ADMIN rolünü kaldırır (yalnızca SUPER_ADMIN).' })
  @ApiZodResponse(200, currentUserSchema)
  revokeRole(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('role', new ZodValidationPipe(staffRoleSchema)) role: StaffRole,
    @Req() req: Request,
  ): Promise<CurrentUserDto> {
    return this.users.revokeStaffRole(actor, id, role, req.ip ?? null);
  }
}
