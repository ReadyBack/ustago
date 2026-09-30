import {
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
import type { Opportunity, Paginated, ProviderQuoteListItem, Quote } from '@ustago/types';
import {
  type AcceptQuote,
  acceptQuoteSchema,
  apiErrorResponseSchema,
  type CloseQuote,
  closeQuoteSchema,
  type CounterQuote,
  counterQuoteSchema,
  type CreateQuote,
  createQuoteSchema,
  type ListOpportunitiesQuery,
  listOpportunitiesQuerySchema,
  type ListProviderQuotesQuery,
  listProviderQuotesQuerySchema,
  opportunitySchema,
  paginatedSchema,
  providerQuoteListItemSchema,
  quoteSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';
import { z } from 'zod';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { OpportunitiesService } from './opportunities.service.js';
import { QuotesService } from './quotes.service.js';
import { clientIp } from '../common/http/client-context.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const NEGOTIATION_ERRORS =
  'NOT_YOUR_TURN / QUOTE_REVISION_STALE / QUOTE_CLOSED / QUOTE_CHANGED / REQUEST_EXPIRED / INVALID_REQUEST_STATE';

@ApiTags('quotes')
@ApiBearerAuth()
@Controller()
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('service-requests/:id/quotes')
  @Roles('PROVIDER')
  @ApiOperation({
    summary:
      'Usta teklif verir (revizyon 1, OFFER). Tutar serbesttir: müşteri bütçesinin üstünde olabilir. ' +
      'Yalnızca eşleştirme kurallarına uyan ACTIVE usta; talep başına usta başına tek teklif.',
  })
  @ApiZodBody(createQuoteSchema)
  @ApiZodResponse(201, quoteSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'PROVIDER_NOT_ACTIVE')
  @ApiZodResponse(404, apiErrorResponseSchema, 'OPPORTUNITY_NOT_FOUND')
  @ApiZodResponse(409, apiErrorResponseSchema, 'QUOTE_ALREADY_EXISTS / REQUEST_EXPIRED')
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) requestId: string,
    @Body(new ZodValidationPipe(createQuoteSchema)) body: CreateQuote,
    @Req() req: Request,
  ): Promise<Quote> {
    return this.quotes.create(user, requestId, body, clientIp(req));
  }

  @Get('service-requests/:id/quotes')
  @ApiOperation({ summary: 'Gelen teklifler (yalnızca talep sahibi), revizyon geçmişiyle.' })
  @ApiZodResponse(200, z.array(quoteSchema))
  listForRequest(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) requestId: string,
  ): Promise<Quote[]> {
    return this.quotes.listForRequest(user, requestId);
  }

  @Get('quotes/:id')
  @ApiOperation({
    summary: 'Pazarlık dizisi. Yalnızca talebin müşterisi ve teklifin ustası görür; diğerleri 404.',
  })
  @ApiZodResponse(200, quoteSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'QUOTE_NOT_FOUND')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<Quote> {
    return this.quotes.get(user, id);
  }

  @Post('quotes/:id/counter')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Karşı teklif. Sıra kimdeyse o verir (sırayla). expectedRevisionNo yanıtlanan revizyondur; ' +
      'arada değiştiyse 409. NOW işlerde karşı teklif yoktur.',
  })
  @ApiZodBody(counterQuoteSchema)
  @ApiZodResponse(200, quoteSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, `${NEGOTIATION_ERRORS} / COUNTER_NOT_ALLOWED`)
  @ApiZodResponse(422, apiErrorResponseSchema, 'NEGOTIATION_LIMIT_REACHED / COUNTER_SAME_PRICE')
  counter(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(counterQuoteSchema)) body: CounterQuote,
    @Req() req: Request,
  ): Promise<Quote> {
    return this.quotes.counter(user, id, body, clientIp(req));
  }

  @Post('quotes/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Karşı tarafın son fiyatını kabul eder: fiyat kilitlenir (AGREED_PRICE), iş (Job) oluşur, ' +
      'talep MATCHED olur, diğer açık teklifler REJECTED olur. Tek transaction.',
  })
  @ApiZodBody(acceptQuoteSchema)
  @ApiZodResponse(200, quoteSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, `${NEGOTIATION_ERRORS} / REQUEST_ALREADY_AGREED`)
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(acceptQuoteSchema)) body: AcceptQuote,
    @Req() req: Request,
  ): Promise<Quote> {
    return this.quotes.accept(user, id, body, clientIp(req));
  }

  @Post('quotes/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Müşteri teklifi reddeder.' })
  @ApiZodBody(closeQuoteSchema)
  @ApiZodResponse(200, quoteSchema)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(closeQuoteSchema)) body: CloseQuote,
    @Req() req: Request,
  ): Promise<Quote> {
    return this.quotes.reject(user, id, body, clientIp(req));
  }

  @Post('quotes/:id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Usta teklifini geri çeker.' })
  @ApiZodBody(closeQuoteSchema)
  @ApiZodResponse(200, quoteSchema)
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(closeQuoteSchema)) body: CloseQuote,
    @Req() req: Request,
  ): Promise<Quote> {
    return this.quotes.withdraw(user, id, body, clientIp(req));
  }
}

@ApiTags('providers: marketplace')
@ApiBearerAuth()
@Roles('PROVIDER')
@Controller('providers/me')
export class ProviderMarketplaceController {
  constructor(
    private readonly opportunities: OpportunitiesService,
    private readonly quotes: QuotesService,
  ) {}

  @Get('opportunities')
  @ApiOperation({
    summary:
      'Yeni İşler: ustanın kategori ve ilçelerine uyan açık talepler (teklif verilmemiş). NOW için ' +
      'müsaitlik ve il × kategori NOW anahtarı her istekte yeniden kontrol edilir. Müşteri kimliği ve ' +
      'açık adres yoktur.',
  })
  @ApiZodResponse(200, paginatedSchema(opportunitySchema))
  @ApiZodResponse(403, apiErrorResponseSchema, 'PROVIDER_NOT_ACTIVE')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listOpportunitiesQuerySchema)) query: ListOpportunitiesQuery,
  ): Promise<Paginated<Opportunity>> {
    return this.opportunities.list(user, query);
  }

  @Get('opportunities/:id')
  @ApiZodResponse(200, opportunitySchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'OPPORTUNITY_NOT_FOUND')
  get(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<Opportunity> {
    return this.opportunities.get(user, id);
  }

  @Get('quotes')
  @ApiOperation({
    summary:
      'Tekliflerim. filter=WAITING (müşteri yanıtı bekleniyor), NEGOTIATING (karşı teklif geldi), ' +
      'ACCEPTED, CLOSED.',
  })
  @ApiZodResponse(200, paginatedSchema(providerQuoteListItemSchema))
  myQuotes(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listProviderQuotesQuerySchema)) query: ListProviderQuotesQuery,
  ): Promise<Paginated<ProviderQuoteListItem>> {
    return this.quotes.listMine(user, query);
  }
}
