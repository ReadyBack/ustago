import type { ServiceRequest } from '@ustago/types';
import { serviceRequestSchema } from '@ustago/validation';

import { DispatchService } from '../src/dispatch/dispatch.service.js';
import { bearer, phoneLogin, RUN_ID, type TestContext, uniquePhone } from './helpers.js';
import type { Customer, ProviderActor } from './marketplace-helpers.js';
import type { Actor } from './provider-helpers.js';

/**
 * Faz 7 helpers: run-owned categories (so a test's providers see only its
 * own requests), district lookups, customers at a chosen address and the
 * V2 request body.
 */

let seq = 0;

/** A fresh category owned by this run (removed by cleanup). */
export async function newCategory(
  ctx: TestContext,
  options: { supportsNow?: boolean; name?: string } = {},
): Promise<string> {
  seq += 1;
  const tag = `e2e-${RUN_ID}-f7-${seq}-${Math.random().toString(36).slice(2, 6)}`;
  const row = await ctx.prisma.serviceCategory.create({
    data: {
      slug: tag,
      name: options.name ?? `Faz7 Kategori ${tag}`,
      supportsNow: options.supportsNow ?? true,
    },
  });
  return row.id;
}

export async function districtId(ctx: TestContext, provinceId: number, slug: string) {
  const d = await ctx.prisma.district.findUniqueOrThrow({
    where: { provinceId_slug: { provinceId, slug } },
  });
  return d.id;
}

/** A customer whose address carries every private field the provider must never see. */
export async function privateCustomer(
  ctx: TestContext,
  provinceId: number,
  district: string,
  extra: Record<string, unknown> = {},
): Promise<Customer & { phone: string }> {
  const phone = uniquePhone();
  const auth = await phoneLogin(ctx, phone, { firstName: 'Zeynep', lastName: 'Gizlisoyad' });
  const res = await ctx
    .http()
    .post('/api/v1/me/addresses')
    .set('Authorization', bearer(auth))
    .send({
      label: 'Ev',
      provinceId,
      districtId: district,
      neighborhood: 'Reşatbey Mah.',
      addressLine: 'Gizlisokak Caddesi No: 12',
      buildingNo: '47B',
      apartmentNo: 'Daire 19',
      postalCode: '01170',
      instructions: 'Kapı kodu 8642',
      ...extra,
    })
    .expect(201);
  return {
    tokens: auth.tokens,
    userId: auth.user.id,
    addressId: res.body.id,
    phone,
  };
}

export interface RequestV2Input {
  categoryId: string;
  type?: 'QUOTE' | 'NOW';
  budgetMinor?: number | null;
  budgetMaxMinor?: number | null;
  scheduleOption?: 'NOW' | 'TODAY' | 'TOMORROW' | 'DATE' | null;
  answers?: Record<string, unknown>;
  preferredProviderId?: string | null;
  preferredOnly?: boolean;
  rehireOfJobId?: string | null;
  title?: string;
}

export function postRequestV2(ctx: TestContext, customer: Customer, input: RequestV2Input) {
  const { type, title, budgetMinor, ...rest } = input;
  return ctx
    .http()
    .post('/api/v1/service-requests')
    .set('Authorization', bearer(customer))
    .send({
      type: type ?? 'QUOTE',
      addressId: customer.addressId,
      title: title ?? 'Priz ve sigorta arızası',
      description: 'Salondaki prizler çalışmıyor, sigorta arada bir atıyor. Bakılması lazım.',
      budgetMinor: budgetMinor === undefined ? 150000 : budgetMinor,
      ...rest,
    });
}

export async function createRequestV2(
  ctx: TestContext,
  customer: Customer,
  input: RequestV2Input,
): Promise<ServiceRequest> {
  const res = await postRequestV2(ctx, customer, input);
  if (res.status !== 201) {
    throw new Error(`create request: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return serviceRequestSchema.parse(res.body);
}

export async function getRequest(
  ctx: TestContext,
  customer: Actor,
  id: string,
): Promise<ServiceRequest> {
  const res = await ctx
    .http()
    .get(`/api/v1/service-requests/${id}`)
    .set('Authorization', bearer(customer))
    .expect(200);
  return serviceRequestSchema.parse(res.body);
}

export function dispatchesOf(ctx: TestContext, requestId: string) {
  return ctx.prisma.requestDispatch.findMany({
    where: { serviceRequestId: requestId },
    orderBy: [{ wave: 'asc' }, { dispatchedAt: 'asc' }],
  });
}

/** Dispatch notifications (new opportunity / preferred / NOW) about one request. */
export function dispatchNotifications(ctx: TestContext, requestId: string) {
  return ctx.prisma.notification.findMany({
    where: {
      type: {
        in: ['service_request.new_opportunity', 'service_request.preferred', 'now.new_request'],
      },
      data: { path: ['serviceRequestId'], equals: requestId },
    },
    include: { pushDelivery: true },
  });
}

export function dispatchService(ctx: TestContext): DispatchService {
  return ctx.app.get(DispatchService);
}

/** Runs one dispatch wave the way the sweep does, but without its due-date filter. */
export function runWave(ctx: TestContext, requestId: string) {
  return ctx.prisma.$transaction((tx) =>
    dispatchService(ctx).dispatchIn(tx, requestId, 'SCHEDULED'),
  );
}

/** Makes the request's next wave due now (the sweep is off in tests). */
export async function makeWaveDue(ctx: TestContext, requestId: string) {
  await ctx.prisma.serviceRequest.update({
    where: { id: requestId },
    data: { nextDispatchAt: new Date('2000-01-01T00:00:00Z') },
  });
}

export function setCoverage(
  ctx: TestContext,
  provider: Actor,
  body: { maxTravelKm?: number | null; serviceCenterDistrictId?: string | null },
) {
  return ctx
    .http()
    .patch('/api/v1/providers/me/coverage')
    .set('Authorization', bearer(provider))
    .send(body);
}

export function setRegions(ctx: TestContext, provider: Actor, regions: unknown[]) {
  return ctx
    .http()
    .put('/api/v1/providers/me/regions')
    .set('Authorization', bearer(provider))
    .send({ regions });
}

export function patchAvailability(
  ctx: TestContext,
  provider: Actor,
  body: { acceptingNewJobs?: boolean; availableToday?: boolean },
) {
  return ctx
    .http()
    .patch('/api/v1/providers/me/availability-settings')
    .set('Authorization', bearer(provider))
    .send(body);
}

export function addTimeOff(
  ctx: TestContext,
  provider: Actor,
  startsAt: Date,
  endsAt: Date,
  note?: string,
) {
  return ctx
    .http()
    .post('/api/v1/providers/me/time-off')
    .set('Authorization', bearer(provider))
    .send({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), note });
}

/** Opportunity detail status (200 = the provider may see it). */
export async function detailStatus(ctx: TestContext, provider: Actor, requestId: string) {
  const res = await ctx
    .http()
    .get(`/api/v1/providers/me/opportunities/${requestId}`)
    .set('Authorization', bearer(provider));
  return res.status;
}

/** ISO weekday (1 = Monday) in the marketplace time zone. */
export function istanbulWeekday(date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
  }).format(date);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name) + 1;
}

export type { ProviderActor };
