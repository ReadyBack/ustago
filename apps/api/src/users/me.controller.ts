import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserDto, Device } from '@ustago/types';
import {
  currentUserSchema,
  deviceSchema,
  type RegisterDeviceRequest,
  registerDeviceRequestSchema,
  type UpdateMeRequest,
  updateMeRequestSchema,
  uuidSchema,
} from '@ustago/validation';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Oturum açmış kullanıcı, rolleri ve profilleri.' })
  @ApiZodResponse(200, currentUserSchema)
  me(@CurrentUser() user: AuthUser): Promise<CurrentUserDto> {
    return this.users.getById(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Ad, soyad ve dil tercihini günceller.' })
  @ApiZodBody(updateMeRequestSchema)
  @ApiZodResponse(200, currentUserSchema)
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateMeRequestSchema)) body: UpdateMeRequest,
  ): Promise<CurrentUserDto> {
    return this.users.updateMe(user.id, body);
  }

  @Post('devices')
  @ApiOperation({ summary: 'Cihazı ve push token’ını kaydeder, bu oturuma bağlar.' })
  @ApiZodBody(registerDeviceRequestSchema)
  @ApiZodResponse(201, deviceSchema)
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerDeviceRequestSchema)) body: RegisterDeviceRequest,
  ): Promise<Device> {
    return this.users.registerDevice(user, body);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cihazı kaldırır; bu cihaza push gönderilmez.' })
  async revokeDevice(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<void> {
    await this.users.revokeDevice(user.id, id);
  }
}
