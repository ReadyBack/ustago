import type { ChangeOrder, Job } from '@ustago/types';
import { changeOrderSchema, jobSchema } from '@ustago/validation';

import { bearer, type TestContext } from './helpers.js';
import {
  accept,
  counter,
  createQuote,
  createRequest,
  type Customer,
  customerIn,
  type Market,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import type { Actor } from './provider-helpers.js';

export interface AgreedJob {
  customer: Customer;
  provider: ProviderActor;
  jobId: string;
  requestId: string;
}

/**
 * The Faz 3 demo up to the agreement, through the real API: Adana /
 * Seyhan klima, budget 1500 TL → offer 2500 → counter 2000 → counter 2200
 * → accepted. The job starts at agreedPriceMinor = 220000.
 */
export async function agreedJob(
  ctx: TestContext,
  m: Market,
  options: { provider?: ProviderActor; customer?: Customer } = {},
): Promise<AgreedJob> {
  const customer = options.customer ?? (await customerIn(ctx, m.seyhan));
  const provider =
    options.provider ??
    (await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan, m.cukurova],
      displayName: 'Demo Klima Ustası',
    }));
  const request = await createRequest(ctx, customer, {
    categoryId: m.klimaId,
    budgetMinor: 150000,
  });
  const quote = await createQuote(ctx, provider, request.id, 250000);
  await counter(ctx, customer, quote.id, 200000, 1).expect(200);
  await counter(ctx, provider, quote.id, 220000, 2).expect(200);
  const accepted = await accept(ctx, customer, quote.id, 3).expect(200);
  const jobId = accepted.body.jobId as string;
  return { customer, provider, jobId, requestId: request.id };
}

/** A NOW job: one quick quote accepted as is. */
export async function agreedNowJob(ctx: TestContext, m: Market): Promise<AgreedJob> {
  const customer = await customerIn(ctx, m.seyhan);
  const provider = await providerIn(ctx, {
    categoryIds: [m.klimaId],
    districtIds: [m.seyhan],
    nowEnabled: true,
    isAvailableNow: true,
  });
  const request = await createRequest(ctx, customer, {
    type: 'NOW',
    categoryId: m.klimaId,
    budgetMinor: null,
  });
  const quote = await createQuote(ctx, provider, request.id, 120000, {
    estimatedDurationMinutes: 45,
  });
  const accepted = await accept(ctx, customer, quote.id, 1).expect(200);
  return { customer, provider, jobId: accepted.body.jobId as string, requestId: request.id };
}

export type JobStep =
  'en-route' | 'arrive' | 'start' | 'request-completion' | 'complete' | 'cancel' | 'dispute';

export function step(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
  action: JobStep,
  body?: Record<string, unknown>,
) {
  const req = ctx
    .http()
    .post(`/api/v1/jobs/${jobId}/${action}`)
    .set('Authorization', bearer(actor));
  return body ? req.send(body) : req.send();
}

export async function stepOk(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
  action: JobStep,
  body?: Record<string, unknown>,
): Promise<Job> {
  const res = await step(ctx, actor, jobId, action, body).expect(200);
  return jobSchema.parse(res.body);
}

export async function getJob(ctx: TestContext, actor: Actor, jobId: string): Promise<Job> {
  const res = await ctx
    .http()
    .get(`/api/v1/jobs/${jobId}`)
    .set('Authorization', bearer(actor))
    .expect(200);
  return jobSchema.parse(res.body);
}

/** Walks the provider steps up to IN_PROGRESS. */
export async function startWork(ctx: TestContext, job: AgreedJob): Promise<Job> {
  await stepOk(ctx, job.provider, job.jobId, 'en-route');
  await stepOk(ctx, job.provider, job.jobId, 'arrive');
  return stepOk(ctx, job.provider, job.jobId, 'start');
}

export function proposeChangeOrder(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
  amountMinor: number,
  description = 'Kompresör rölesi arızalı çıktı, parça ve işçilik.',
) {
  return ctx
    .http()
    .post(`/api/v1/jobs/${jobId}/change-orders`)
    .set('Authorization', bearer(actor))
    .send({ amountMinor, description });
}

export async function createChangeOrder(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
  amountMinor: number,
): Promise<ChangeOrder> {
  const res = await proposeChangeOrder(ctx, actor, jobId, amountMinor).expect(201);
  return changeOrderSchema.parse(res.body);
}

export function answerChangeOrder(
  ctx: TestContext,
  actor: Actor,
  id: string,
  answer: 'accept' | 'reject' | 'cancel',
) {
  return ctx
    .http()
    .post(`/api/v1/change-orders/${id}/${answer}`)
    .set('Authorization', bearer(actor))
    .send();
}

/** Agreed → en route → arrived → started → completion requested → completed. */
export async function completedJob(
  ctx: TestContext,
  m: Market,
  base?: AgreedJob,
): Promise<AgreedJob> {
  const job = base ?? (await agreedJob(ctx, m));
  await startWork(ctx, job);
  await stepOk(ctx, job.provider, job.jobId, 'request-completion');
  await stepOk(ctx, job.customer, job.jobId, 'complete');
  return job;
}

export function postReview(
  ctx: TestContext,
  actor: Actor,
  jobId: string,
  body: Record<string, unknown>,
) {
  return ctx
    .http()
    .post(`/api/v1/jobs/${jobId}/review`)
    .set('Authorization', bearer(actor))
    .send(body);
}

export async function notificationsOf(ctx: TestContext, userId: string) {
  return ctx.prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    include: { pushDelivery: true },
  });
}
