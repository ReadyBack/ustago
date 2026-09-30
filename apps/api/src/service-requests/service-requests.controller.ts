import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Paginated,
  ServiceRequest,
  ServiceRequestListItem,
  SignedUrl,
  UploadIntentResponse,
} from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CancelServiceRequest,
  cancelServiceRequestSchema,
  type CreateRequestPhotoUpload,
  createRequestPhotoUploadSchema,
  type CreateServiceRequest,
  createServiceRequestSchema,
  type ListMyServiceRequestsQuery,
  listMyServiceRequestsQuerySchema,
  paginatedSchema,
  serviceRequestListItemSchema,
  serviceRequestSchema,
  signedUrlSchema,
  type UpdateServiceRequest,
  updateServiceRequestSchema,
  uploadIntentResponseSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { RequestPhotosService } from './request-photos.service.js';
import { ServiceRequestsService } from './service-requests.service.js';
import { clientIp } from '../common/http/client-context.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const STATE_ERRORS = 'INVALID_REQUEST_STATE / REQUEST_FIELD_LOCKED';

@ApiTags('service-requests')
@ApiBearerAuth()
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(
    private readonly requests: ServiceRequestsService,
    private readonly photos: RequestPhotosService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'İş talebi oluşturur (QUOTE = Teklif Al, NOW = Acil Usta). publish=false taslak bırakır. ' +
      'budgetMinor kuruş cinsinden tahmindir, teklif tavanı değildir; null = "Bütçem belli değil". ' +
      'Aynı idempotencyKey ile tekrar gönderim ilk talebi döner.',
  })
  @ApiZodBody(createServiceRequestSchema)
  @ApiZodResponse(201, serviceRequestSchema)
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'ADDRESS_NOT_FOUND / CATEGORY_NOT_AVAILABLE / SERVICE_NOT_AVAILABLE_IN_AREA / NOW_NOT_AVAILABLE_IN_AREA / UPLOAD_NOT_COMPLETED / INVALID_REQUEST_PHOTO',
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createServiceRequestSchema)) body: CreateServiceRequest,
    @Req() req: Request,
  ): Promise<ServiceRequest> {
    return this.requests.create(user, body, clientIp(req));
  }

  @Post('photos/upload-intent')
  @ApiOperation({
    summary:
      'Talep fotoğrafı için imzalı yükleme adresi (JPEG/PNG, en fazla 10 MB). Dosya PUT ile yüklenir, ' +
      'dönen uploadId talep oluştururken photoUploadIds içinde gönderilir.',
  })
  @ApiZodBody(createRequestPhotoUploadSchema)
  @ApiZodResponse(201, uploadIntentResponseSchema)
  photoUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRequestPhotoUploadSchema)) body: CreateRequestPhotoUpload,
  ): Promise<UploadIntentResponse> {
    return this.photos.createUploadIntent(user, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Müşterinin kendi talebi. Başkasının talebi 404.' })
  @ApiZodResponse(200, serviceRequestSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'SERVICE_REQUEST_NOT_FOUND')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<ServiceRequest> {
    return this.requests.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Talebi düzenler. Teklif geldikten sonra kategori ve adres değişmez; anlaşmadan sonra hiçbir alan değişmez.',
  })
  @ApiZodBody(updateServiceRequestSchema)
  @ApiZodResponse(200, serviceRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, STATE_ERRORS)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(updateServiceRequestSchema)) body: UpdateServiceRequest,
    @Req() req: Request,
  ): Promise<ServiceRequest> {
    return this.requests.update(user, id, body, clientIp(req));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DRAFT → PUBLISHED (QUOTE) / MATCHING (NOW). Tekrar çağrı etkisizdir.' })
  @ApiZodResponse(200, serviceRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'INVALID_REQUEST_STATE')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ServiceRequest> {
    return this.requests.publish(user, id, clientIp(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Açık talebi iptal eder; açık teklifler kapanır. Anlaşma sonrası 409.' })
  @ApiZodBody(cancelServiceRequestSchema)
  @ApiZodResponse(200, serviceRequestSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'INVALID_REQUEST_STATE')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(cancelServiceRequestSchema)) body: CancelServiceRequest,
    @Req() req: Request,
  ): Promise<ServiceRequest> {
    return this.requests.cancel(user, id, body, clientIp(req));
  }

  @Get(':id/photos/:photoId/url')
  @ApiOperation({
    summary:
      'Fotoğraf için 5 dakikalık imzalı adres. Talep sahibi, talebi görebilen/teklif vermiş usta ve admin.',
  })
  @ApiZodResponse(200, signedUrlSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PHOTO_NOT_FOUND')
  photoUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Param('photoId', idPipe) photoId: string,
    @Req() req: Request,
  ): Promise<SignedUrl> {
    return this.photos.viewUrl(user, id, photoId, clientIp(req));
  }
}

@ApiTags('service-requests')
@ApiBearerAuth()
@Controller('me/service-requests')
export class MyServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Taleplerim. group=OPEN (açık/teklif geldi), AGREED (anlaşıldı), CLOSED (tamamlandı/iptal/süresi doldu).',
  })
  @ApiZodResponse(200, paginatedSchema(serviceRequestListItemSchema))
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listMyServiceRequestsQuerySchema))
    query: ListMyServiceRequestsQuery,
  ): Promise<Paginated<ServiceRequestListItem>> {
    return this.requests.listMine(user.id, query);
  }
}
