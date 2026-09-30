import type { Opportunity, Quote, ServiceRequest } from '@ustago/types';
import { quoteSchema, serviceRequestSchema } from '@ustago/validation';

import { bearer, phoneLogin, RUN_ID, type TestContext } from './helpers.js';
import type { Actor } from './provider-helpers.js';

/** Adana (plate 1): the local demo province. */
export const ADANA = 1;

export interface Market {
  provinceId: number;
  /** Test-owned categories, removed with the run's cleanup. */
  klimaId: string;
  elektrikId: string;
  /** A category that is never NOW-capable. */
  boyaId: string;
  seyhan: string;
  cukurova: string;
  yuregir: string;
  /** Restores the province's previous state. */
  restore: () => Promise<void>;
}

/**
 * Opens Adana and creates run-owned categories, so tests never depend on
 * (or change) the seeded catalogue.
 */
export async function adanaMarket(ctx: TestContext): Promise<Market> {
  const tag = `e2e-${RUN_ID}-${Math.random().toString(36).slice(2, 8)}`;
  const before = await ctx.prisma.province.findUniqueOrThrow({ where: { id: ADANA } });
  await ctx.prisma.province.update({ where: { id: ADANA }, data: { isActive: true } });
  const [klima, elektrik, boya] = await Promise.all([
    ctx.prisma.serviceCategory.create({
      data: { slug: `${tag}-klima`, name: `Klima ${tag}`, supportsNow: true },
    }),
    ctx.prisma.serviceCategory.create({
      data: { slug: `${tag}-elektrik`, name: `Elektrik ${tag}`, supportsNow: true },
    }),
    ctx.prisma.serviceCategory.create({
      data: { slug: `${tag}-boya`, name: `Boya ${tag}`, supportsNow: false },
    }),
  ]);
  const district = (slug: string) =>
    ctx.prisma.district.findUniqueOrThrow({
      where: { provinceId_slug: { provinceId: ADANA, slug } },
    });
  const [seyhan, cukurova, yuregir] = await Promise.all([
    district('seyhan'),
    district('cukurova'),
    district('yuregir'),
  ]);
  return {
    provinceId: ADANA,
    klimaId: klima.id,
    elektrikId: elektrik.id,
    boyaId: boya.id,
    seyhan: seyhan.id,
    cukurova: cukurova.id,
    yuregir: yuregir.id,
    restore: async () => {
      await ctx.prisma.province.update({
        where: { id: ADANA },
        data: { isActive: before.isActive },
      });
    },
  };
}

export interface Customer extends Actor {
  addressId: string;
}

/** A phone-verified customer with one address in `districtId`. */
export async function customerIn(
  ctx: TestContext,
  districtId: string,
  provinceId = ADANA,
): Promise<Customer> {
  const auth = await phoneLogin(ctx, undefined, { firstName: 'Test', lastName: 'Müşteri' });
  const res = await ctx
    .http()
    .post('/api/v1/me/addresses')
    .set('Authorization', bearer(auth))
    .send({
      label: 'Ev',
      provinceId,
      districtId,
      neighborhood: 'Reşatbey Mah.',
      addressLine: 'Atatürk Caddesi No: 12',
      buildingNo: '12',
      apartmentNo: '7',
      instructions: 'Kapı kodu 4321',
    })
    .expect(201);
  return { tokens: auth.tokens, userId: auth.user.id, addressId: res.body.id };
}

export interface ProviderActor extends Actor {
  providerId: string;
}

/**
 * An approved provider, written straight to the database (onboarding and
 * review have their own suites). Roles are read from the database on every
 * request, so the existing tokens pick up PROVIDER immediately.
 */
export async function providerIn(
  ctx: TestContext,
  options: {
    categoryIds: string[];
    districtIds: string[];
    status?: 'ACTIVE' | 'PENDING_REVIEW' | 'SUSPENDED' | 'DRAFT';
    nowEnabled?: boolean;
    isAvailableNow?: boolean;
    displayName?: string;
  },
): Promise<ProviderActor> {
  const auth = await phoneLogin(ctx, undefined, { firstName: 'Test', lastName: 'Usta' });
  const status = options.status ?? 'ACTIVE';
  const profile = await ctx.prisma.providerProfile.create({
    data: {
      userId: auth.user.id,
      displayName: options.displayName ?? 'Test Klima Ustası',
      status,
      bio: 'Test ustası, e2e senaryoları için oluşturuldu.',
      yearsOfExperience: 8,
      approvedAt: status === 'ACTIVE' || status === 'SUSPENDED' ? new Date() : null,
      statusReason: status === 'SUSPENDED' ? 'e2e askı' : null,
      nowEnabled: options.nowEnabled ?? false,
      isAvailableNow: status === 'ACTIVE' ? (options.isAvailableNow ?? false) : false,
      services: { create: options.categoryIds.map((categoryId) => ({ categoryId })) },
      serviceAreas: { create: options.districtIds.map((districtId) => ({ districtId })) },
    },
  });
  await ctx.prisma.userRole.create({ data: { userId: auth.user.id, role: 'PROVIDER' } });
  return { tokens: auth.tokens, userId: auth.user.id, providerId: profile.id };
}

export interface RequestInput {
  type?: 'QUOTE' | 'NOW';
  categoryId: string;
  title?: string;
  description?: string;
  budgetMinor?: number | null;
  publish?: boolean;
  idempotencyKey?: string;
  photoUploadIds?: string[];
}

export function postRequest(ctx: TestContext, customer: Customer, input: RequestInput) {
  return ctx
    .http()
    .post('/api/v1/service-requests')
    .set('Authorization', bearer(customer))
    .send({
      type: input.type ?? 'QUOTE',
      categoryId: input.categoryId,
      addressId: customer.addressId,
      title: input.title ?? 'Klima montajı',
      description:
        input.description ?? 'Salon için 12000 BTU split klima montajı yapılacak, 3. kat.',
      budgetMinor: input.budgetMinor === undefined ? 150000 : input.budgetMinor,
      ...(input.publish === undefined ? {} : { publish: input.publish }),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.photoUploadIds ? { photoUploadIds: input.photoUploadIds } : {}),
    });
}

export async function createRequest(
  ctx: TestContext,
  customer: Customer,
  input: RequestInput,
): Promise<ServiceRequest> {
  const res = await postRequest(ctx, customer, input).expect(201);
  return serviceRequestSchema.parse(res.body);
}

export function postQuote(
  ctx: TestContext,
  provider: Actor,
  requestId: string,
  body: Record<string, unknown>,
) {
  return ctx
    .http()
    .post(`/api/v1/service-requests/${requestId}/quotes`)
    .set('Authorization', bearer(provider))
    .send(body);
}

export async function createQuote(
  ctx: TestContext,
  provider: Actor,
  requestId: string,
  totalMinor: number,
  extra: Record<string, unknown> = {},
): Promise<Quote> {
  const res = await postQuote(ctx, provider, requestId, { totalMinor, ...extra }).expect(201);
  return quoteSchema.parse(res.body);
}

export function counter(
  ctx: TestContext,
  actor: Actor,
  quoteId: string,
  totalMinor: number,
  expectedRevisionNo: number,
) {
  return ctx
    .http()
    .post(`/api/v1/quotes/${quoteId}/counter`)
    .set('Authorization', bearer(actor))
    .send({ totalMinor, expectedRevisionNo });
}

export function accept(ctx: TestContext, actor: Actor, quoteId: string, expectedRevisionNo: number) {
  return ctx
    .http()
    .post(`/api/v1/quotes/${quoteId}/accept`)
    .set('Authorization', bearer(actor))
    .send({ expectedRevisionNo });
}

export async function opportunities(
  ctx: TestContext,
  provider: Actor,
  query = '',
): Promise<Opportunity[]> {
  const res = await ctx
    .http()
    .get(`/api/v1/providers/me/opportunities${query}`)
    .set('Authorization', bearer(provider))
    .expect(200);
  return res.body.items as Opportunity[];
}

export async function opportunityIds(ctx: TestContext, provider: Actor, query = '') {
  return (await opportunities(ctx, provider, query)).map((o) => o.id);
}
