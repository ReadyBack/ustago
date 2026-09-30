import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ChangeOrder, Job, JobListItem, Paginated } from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CancelJob,
  cancelJobSchema,
  changeOrderSchema,
  type CreateChangeOrder,
  createChangeOrderSchema,
  jobListItemSchema,
  jobSchema,
  type ListJobsQuery,
  listJobsQuerySchema,
  type OpenDispute,
  openDisputeSchema,
  paginatedSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ChangeOrdersService } from './change-orders.service.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { JobsService } from './jobs.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const ip = (req: Request) => req.ip ?? null;

/** Every lifecycle action documents the same error shapes. */
const JobAction = (summary: string, extra409 = '') =>
  applyDecorators(
    HttpCode(HttpStatus.OK),
    ApiOperation({ summary }),
    ApiZodResponse(200, jobSchema),
    ApiZodResponse(403, apiErrorResponseSchema, 'JOB_WRONG_PARTY (işin diğer tarafının adımı)'),
    ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND (başkasının işi dahil)'),
    ApiZodResponse(
      409,
      apiErrorResponseSchema,
      `JOB_INVALID_TRANSITION (details.status: işin güncel durumu)${extra409}`,
    ),
  );

@ApiTags('jobs')
@ApiBearerAuth()
@Controller()
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly lifecycle: JobLifecycleService,
    private readonly changeOrders: ChangeOrdersService,
  ) {}

  @Get('jobs')
  @ApiOperation({
    summary:
      'Çağıranın işleri. role=CUSTOMER aldığı, role=PROVIDER verdiği hizmetler. ' +
      'scope=ACTIVE süren işler, scope=FINISHED tamamlanan/iptal edilenler.',
  })
  @ApiZodResponse(200, paginatedSchema(jobListItemSchema))
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listJobsQuerySchema)) query: ListJobsQuery,
  ): Promise<Paginated<JobListItem>> {
    return this.jobs.list(user.id, query);
  }

  @Get('jobs/:id')
  @ApiOperation({
    summary:
      'İş detayı: zaman çizelgesi, ek işler, yorum, sorun bildirimi ve çağıranın şu an yapabileceği ' +
      'işlemler (actions). Yalnızca işin müşterisi ve ustası görür.',
  })
  @ApiZodResponse(200, jobSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND (başkasının işi dahil)')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<Job> {
    return this.jobs.get(user.id, id);
  }

  @Post('jobs/:id/en-route')
  @JobAction('Usta: "Yola Çıktım". Tekrarı aynı işi döner, ikinci kez kayıt yazmaz.')
  enRoute(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string, @Req() req: Request) {
    return this.lifecycle.enRoute(user, id, ip(req));
  }

  @Post('jobs/:id/arrive')
  @JobAction('Usta: "Adrese Ulaştım".')
  arrive(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string, @Req() req: Request) {
    return this.lifecycle.arrive(user, id, ip(req));
  }

  @Post('jobs/:id/start')
  @JobAction('Usta: "İşe Başladım".')
  start(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string, @Req() req: Request) {
    return this.lifecycle.start(user, id, ip(req));
  }

  @Post('jobs/:id/request-completion')
  @JobAction(
    'Usta: "İşi Tamamladım". İş müşteri onayına geçer; otomatik tamamlanmaz.',
    ' / JOB_HAS_PENDING_CHANGE_ORDER',
  )
  requestCompletion(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ) {
    return this.lifecycle.requestCompletion(user, id, ip(req));
  }

  @Post('jobs/:id/complete')
  @JobAction('Müşteri: "İş Tamamlandı". Ödeme adımı yoktur.')
  complete(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string, @Req() req: Request) {
    return this.lifecycle.complete(user, id, ip(req));
  }

  @Post('jobs/:id/dispute')
  @JobAction(
    'Müşteri: "Sorun Bildir". İş DISPUTED olur, admin inceler. Usta gelmeden yalnızca NO_SHOW.',
    ' / DISPUTE_ALREADY_OPEN',
  )
  @ApiZodBody(openDisputeSchema)
  @ApiZodResponse(400, apiErrorResponseSchema, 'VALIDATION_FAILED')
  @ApiZodResponse(422, apiErrorResponseSchema, 'DISPUTE_REASON_NOT_ALLOWED')
  dispute(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(openDisputeSchema)) body: OpenDispute,
    @Req() req: Request,
  ) {
    return this.lifecycle.dispute(user, id, body, ip(req));
  }

  @Post('jobs/:id/cancel')
  @JobAction('Müşteri veya usta, usta yola çıkmadan işi iptal eder; iptal eden taraf kaydedilir.')
  @ApiZodBody(cancelJobSchema)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(cancelJobSchema)) body: CancelJob,
    @Req() req: Request,
  ) {
    return this.lifecycle.cancel(user, id, body, ip(req));
  }

  // -------------------------------------------------------------------------
  // Change orders
  // -------------------------------------------------------------------------

  @Get('jobs/:id/change-orders')
  @ApiOperation({ summary: 'İşin ek iş talepleri (eskiden yeniye).' })
  @ApiZodResponse(200, z.array(changeOrderSchema))
  @ApiZodResponse(404, apiErrorResponseSchema, 'CHANGE_ORDER_NOT_FOUND')
  listChangeOrders(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<ChangeOrder[]> {
    return this.changeOrders.list(user.id, id);
  }

  @Post('jobs/:id/change-orders')
  @ApiOperation({
    summary:
      'Usta ek iş ister (yalnızca iş sürerken, aynı anda tek bekleyen talep). Tutar kuruş, pozitif. ' +
      'Anlaşılan fiyat değişmez; müşteri onaylarsa güncel toplama eklenir.',
  })
  @ApiZodBody(createChangeOrderSchema)
  @ApiZodResponse(201, changeOrderSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'JOB_WRONG_PARTY')
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND')
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'CHANGE_ORDER_NOT_ALLOWED / CHANGE_ORDER_ALREADY_PENDING',
  )
  @ApiZodResponse(400, apiErrorResponseSchema, 'VALIDATION_FAILED (tutar pozitif tam sayı kuruş)')
  @ApiZodResponse(422, apiErrorResponseSchema, 'CHANGE_ORDER_INVALID_AMOUNT (toplam üst sınırı aşıyor)')
  createChangeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(createChangeOrderSchema)) body: CreateChangeOrder,
    @Req() req: Request,
  ): Promise<ChangeOrder> {
    return this.changeOrders.create(user, id, body, ip(req));
  }

  @Post('change-orders/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Müşteri ek işi onaylar: tutar güncel toplama bir kez eklenir. Eşzamanlı onay/ret: yalnızca biri kazanır.',
  })
  @ApiZodResponse(200, changeOrderSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'JOB_WRONG_PARTY')
  @ApiZodResponse(404, apiErrorResponseSchema, 'CHANGE_ORDER_NOT_FOUND')
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'CHANGE_ORDER_NOT_PENDING / CHANGE_ORDER_STALE / JOB_INVALID_TRANSITION',
  )
  acceptChangeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ChangeOrder> {
    return this.changeOrders.accept(user, id, ip(req));
  }

  @Post('change-orders/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Müşteri ek işi reddeder; toplam değişmez.' })
  @ApiZodResponse(200, changeOrderSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'JOB_WRONG_PARTY')
  @ApiZodResponse(404, apiErrorResponseSchema, 'CHANGE_ORDER_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'CHANGE_ORDER_NOT_PENDING / JOB_INVALID_TRANSITION')
  rejectChangeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ChangeOrder> {
    return this.changeOrders.reject(user, id, ip(req));
  }

  @Post('change-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Usta, yanıt bekleyen ek iş talebini geri çeker.' })
  @ApiZodResponse(200, changeOrderSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'JOB_WRONG_PARTY')
  @ApiZodResponse(404, apiErrorResponseSchema, 'CHANGE_ORDER_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'CHANGE_ORDER_NOT_PENDING / JOB_INVALID_TRANSITION')
  cancelChangeOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<ChangeOrder> {
    return this.changeOrders.cancel(user, id, ip(req));
  }
}
