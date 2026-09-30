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
  Put,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Address } from '@ustago/types';
import {
  addressSchema,
  apiErrorResponseSchema,
  type CreateAddressRequest,
  createAddressRequestSchema,
  type UpdateAddressRequest,
  updateAddressRequestSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AddressesService } from './addresses.service.js';
import { clientIp } from '../common/http/client-context.js';

const idPipe = new ZodValidationPipe(uuidSchema);

@ApiTags('me: addresses')
@ApiBearerAuth()
@Controller('me/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  @ApiOperation({ summary: 'Kayıtlı adresler; varsayılan önce.' })
  @ApiZodResponse(200, z.array(addressSchema))
  list(@CurrentUser() user: AuthUser): Promise<Address[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Adres ekler. İlk adres otomatik varsayılan olur.' })
  @ApiZodBody(createAddressRequestSchema)
  @ApiZodResponse(201, addressSchema)
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'DISTRICT_PROVINCE_MISMATCH / DISTRICT_NOT_FOUND / ADDRESS_LIMIT_REACHED',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createAddressRequestSchema)) body: CreateAddressRequest,
  ): Promise<Address> {
    return this.addresses.create(user.id, body);
  }

  @Get(':id')
  @ApiZodResponse(200, addressSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'ADDRESS_NOT_FOUND')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<Address> {
    return this.addresses.get(user.id, id);
  }

  @Patch(':id')
  @ApiZodBody(updateAddressRequestSchema)
  @ApiZodResponse(200, addressSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'ADDRESS_NOT_FOUND')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateAddressRequestSchema)) body: UpdateAddressRequest,
  ): Promise<Address> {
    return this.addresses.update(user.id, id, body);
  }

  @Put(':id/default')
  @ApiOperation({ summary: 'Adresi varsayılan yapar; önceki varsayılan kalkar.' })
  @ApiZodResponse(200, addressSchema)
  setDefault(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<Address> {
    return this.addresses.setDefault(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Adresi siler (soft delete). Varsayılan silinirse en son eklenen adres varsayılan olur.',
  })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.addresses.remove(user.id, id, clientIp(req));
  }
}
