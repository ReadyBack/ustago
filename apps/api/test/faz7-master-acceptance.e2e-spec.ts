import { randomUUID } from 'node:crypto';

import type { RequestForm, ServiceRequest } from '@ustago/types';
import {
  chatMessageSchema,
  conversationDetailSchema,
  jobSchema,
  marketplaceOverviewSchema,
  messagePageSchema,
  opportunitySchema,
  paginatedSchema,
  quoteSchema,
  reconciliationReportSchema,
  rehireDraftSchema,
  requestFormSchema,
  searchResultSchema,
  serviceRequestSchema,
  uploadIntentResponseSchema,
} from '@ustago/validation';

import { seedCategoryContent } from '../src/seed/seed-category-content.js';
import {
  createRequestV2,
  dispatchesOf,
  dispatchNotifications,
  getRequest,
  patchAvailability,
  privateCustomer,
} from './faz7-helpers.js';
import {
  adminActor,
  expectLedgerConsistent,
  payOnline,
  summaryOf,
  walletOf,
} from './finance-helpers.js';
import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import {
  answerChangeOrder,
  createChangeOrder,
  getJob,
  notificationsOf,
  postReview,
  stepOk,
} from './job-helpers.js';
import {
  accept,
  adanaMarket,
  counter,
  type Customer,
  type Market,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import { type Actor, FILES, pathOf } from './provider-helpers.js';

const opportunityPage = paginatedSchema(opportunitySchema);

/**
 * The Faz 7 master acceptance scenario, in order, through the HTTP API as
 * the apps call it (real PostgreSQL and Redis): search → request with
 * photos and answers → wave dispatch → "Sana Uygun İşler" → quote and
 * negotiation → chat → agreement reveals the address → on the way,
 * started, +₺500 change order → TEST payment ₺2.700 (fee ₺405, provider
 * ₺2.295) → completed, reviewed, favourited → rehire → admin funnel and
 * events → balanced ledger and clean reconciliation.
 */
describe('Faz 7: master acceptance scenario (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Actor;
  let customer: Customer & { phone: string };
  let provider: ProviderActor;
  let suspended: ProviderActor;
  let paused: ProviderActor;
  let elektrikId: string;
  let form: RequestForm;
  let request: ServiceRequest;
  let quoteId: string;
  let jobId: string;
  let conversationId: string;
  let funnelBefore: Map<string, number>;

  const DESCRIPTION = 'Salondaki priz çalışmıyor.';

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    // Search aliases and request-form questions of the catalogue (the seed adds them too).
    await seedCategoryContent(ctx.prisma);
    m = await adanaMarket(ctx);
    admin = await adminActor(ctx);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  async function funnel(): Promise<Map<string, number>> {
    const res = await ctx
      .http()
      .get('/api/v1/admin/marketplace/overview?days=1')
      .set('Authorization', bearer(admin))
      .expect(200);
    const overview = marketplaceOverviewSchema.parse(res.body);
    return new Map(overview.funnel.map((s) => [s.key, s.requests]));
  }

  /** Answers every required question of the form with its first valid value. */
  function requiredAnswers(f: RequestForm): Record<string, unknown> {
    const answers: Record<string, unknown> = {};
    for (const q of f.questions.filter((x) => x.required)) {
      if (q.type === 'SINGLE_SELECT') answers[q.key] = q.options[0]?.value;
      else if (q.type === 'MULTI_SELECT') answers[q.key] = [q.options[0]?.value];
      else if (q.type === 'BOOLEAN') answers[q.key] = true;
      else if (q.type === 'NUMBER') answers[q.key] = q.minValue ?? 1;
      else answers[q.key] = 'Salon';
    }
    return answers;
  }

  async function uploadPhoto(): Promise<string> {
    const res = await ctx
      .http()
      .post('/api/v1/service-requests/photos/upload-intent')
      .set('Authorization', bearer(customer))
      .send({ mimeType: 'image/png', sizeBytes: FILES.png.length, fileName: 'priz.png' })
      .expect(201);
    const intent = uploadIntentResponseSchema.parse(res.body);
    await ctx
      .http()
      .put(pathOf(intent.uploadUrl))
      .set('Content-Type', 'image/png')
      .send(FILES.png)
      .expect(204);
    return intent.uploadId;
  }

  it('1. a customer in Adana / Çukurova finds "Elektrik" by searching "Elektrikçi"', async () => {
    customer = await privateCustomer(ctx, m.provinceId, m.cukurova);
    const res = await ctx
      .http()
      .get('/api/v1/search')
      .query({ q: 'Elektrikçi' })
      .set('Authorization', bearer(customer))
      .expect(200);
    const result = searchResultSchema.parse(res.body);
    const hit = result.categories.find((c) => c.category.slug === 'elektrik');
    expect(hit).toBeDefined();
    expect(result.categories[0]?.category.slug).toBe('elektrik');
    elektrikId = hit?.category.id ?? '';
    await ctx
      .http()
      .post('/api/v1/search/click')
      .send({ categoryId: elektrikId, query: 'Elektrikçi' })
      .expect(204);
  });

  it('2. publishes a QUOTE request with two photos, TODAY, ₺1.500 and the form answers', async () => {
    // Providers covering Çukurova: one eligible, one suspended, one paused.
    provider = await providerIn(ctx, {
      categoryIds: [elektrikId],
      districtIds: [m.cukurova],
      displayName: 'Usta Elektrik Mehmet',
    });
    suspended = await providerIn(ctx, {
      categoryIds: [elektrikId],
      districtIds: [m.cukurova],
      status: 'SUSPENDED',
    });
    paused = await providerIn(ctx, { categoryIds: [elektrikId], districtIds: [m.cukurova] });
    await patchAvailability(ctx, paused, { acceptingNewJobs: false }).expect(200);
    funnelBefore = await funnel();

    const formRes = await ctx
      .http()
      .get(`/api/v1/categories/${elektrikId}/request-form`)
      .expect(200);
    form = requestFormSchema.parse(formRes.body);
    const photos = [await uploadPhoto(), await uploadPhoto()];
    const res = await ctx
      .http()
      .post('/api/v1/service-requests')
      .set('Authorization', bearer(customer))
      .send({
        type: 'QUOTE',
        categoryId: elektrikId,
        addressId: customer.addressId,
        title: 'Salon prizi arızalı',
        description: DESCRIPTION,
        budgetMinor: 150000,
        scheduleOption: 'TODAY',
        photoUploadIds: photos,
        answers: requiredAnswers(form),
      });
    expect(res.status).toBe(201);
    request = serviceRequestSchema.parse(res.body);
    expect(request).toMatchObject({
      type: 'QUOTE',
      status: 'PUBLISHED',
      description: DESCRIPTION,
      scheduleOption: 'TODAY',
      budget: { amountMinor: 150000, currency: 'TRY' },
      address: { district: { id: m.cukurova } },
    });
    expect(request.photos).toHaveLength(2);
    expect(request.answers.map((a) => a.key)).toEqual(
      form.questions.filter((q) => q.required).map((q) => q.key),
    );
  });

  it('3. wave 1 reaches the eligible provider (MATCH_V1), never the suspended or paused one', async () => {
    const rows = await dispatchesOf(ctx, request.id);
    expect(rows.map((r) => r.providerId)).toEqual([provider.providerId]);
    expect(rows[0]).toMatchObject({ wave: 1, algorithmVersion: 'MATCH_V1', notifyMode: 'PUSH' });
    expect(Number(rows[0]?.matchScore)).toBeGreaterThan(0);
    expect(Object.keys(rows[0]?.scoreBreakdown as object).length).toBeGreaterThan(0);
    const notes = await dispatchNotifications(ctx, request.id);
    expect(notes.map((n) => n.userId)).toEqual([provider.userId]);
    expect(notes[0]?.type).toBe('service_request.new_opportunity');
    for (const p of [suspended, paused]) {
      expect(await ctx.prisma.notification.count({ where: { userId: p.userId } })).toBe(0);
    }
    expect((await getRequest(ctx, customer, request.id)).dispatch).toMatchObject({
      wave: 1,
      dispatchedCount: 1,
      supply: 'OK',
    });
  });

  it('4. "Sana Uygun İşler" lists it; the detail hides the address, name and phone', async () => {
    const list = await ctx
      .http()
      .get('/api/v1/providers/me/opportunities')
      .set('Authorization', bearer(provider))
      .expect(200);
    const feed = opportunityPage.parse(list.body);
    const item = feed.items.find((o) => o.id === request.id);
    expect(item).toMatchObject({
      description: DESCRIPTION,
      photoCount: 2,
      scheduleOption: 'TODAY',
      dispatch: { wave: 1 },
    });
    const res = await ctx
      .http()
      .get(`/api/v1/providers/me/opportunities/${request.id}`)
      .set('Authorization', bearer(provider))
      .expect(200);
    const detail = opportunitySchema.strict().parse(res.body);
    expect(detail.location.district.id).toBe(m.cukurova);
    const text = JSON.stringify(res.body);
    for (const secret of [
      'Gizlisokak',
      '47B',
      'Daire 19',
      '01170',
      '8642',
      'Zeynep',
      'Gizlisoyad',
      customer.phone.replace('+90', ''),
    ]) {
      expect(text).not.toContain(secret);
    }
    for (const suspendedOrPaused of [suspended, paused]) {
      const other = await ctx
        .http()
        .get(`/api/v1/providers/me/opportunities/${request.id}`)
        .set('Authorization', bearer(suspendedOrPaused));
      expect(other.status).not.toBe(200);
    }
  });

  it('5. the provider offers ₺2.500 with a note; the customer is notified and compares', async () => {
    const res = await ctx
      .http()
      .post(`/api/v1/service-requests/${request.id}/quotes`)
      .set('Authorization', bearer(provider))
      .send({ totalMinor: 250000, note: 'Malzeme durumuna göre fiyat değişebilir.' })
      .expect(201);
    const quote = quoteSchema.parse(res.body);
    quoteId = quote.id;
    expect(quote.latest.note).toBe('Malzeme durumuna göre fiyat değişebilir.');

    const notes = await notificationsOf(ctx, customer.userId);
    expect(notes.some((n) => n.type === 'quote.created')).toBe(true);

    const list = await ctx
      .http()
      .get(`/api/v1/service-requests/${request.id}/quotes`)
      .set('Authorization', bearer(customer))
      .expect(200);
    const quotes = (list.body as unknown[]).map((q) => quoteSchema.parse(q));
    expect(quotes.map((q) => q.id)).toEqual([quoteId]);
    // Comparison data is present (labels need two or more open offers).
    expect(quotes[0]?.comparisonLabels).toEqual([]);
    expect(quotes[0]).toHaveProperty('distance');
    expect(quotes[0]?.provider.displayName).toBe('Usta Elektrik Mehmet');

    // The customer opens the chat about the offer.
    const conv = await ctx
      .http()
      .post('/api/v1/conversations')
      .set('Authorization', bearer(customer))
      .send({ quoteId })
      .expect(200);
    conversationId = conversationDetailSchema.parse(conv.body).id;
  });

  it('6. ₺2.000 ↔ ₺2.200, accepted: the job is agreed at ₺2.200', async () => {
    await counter(ctx, customer, quoteId, 200000, 1).expect(200);
    await counter(ctx, provider, quoteId, 220000, 2).expect(200);
    const res = await accept(ctx, customer, quoteId, 3).expect(200);
    jobId = res.body.jobId as string;
    const job = await getJob(ctx, customer, jobId);
    expect(job.agreedPrice.amountMinor).toBe(220000);
    expect(job.currentTotal.amountMinor).toBe(220000);
  });

  it('7. chat: both messages visible to both sides, with the acceptance SYSTEM line', async () => {
    // Opening by job returns the same conversation.
    const byJob = await ctx
      .http()
      .post('/api/v1/conversations')
      .set('Authorization', bearer(provider))
      .send({ jobId })
      .expect(200);
    const detail = conversationDetailSchema.parse(byJob.body);
    expect(detail.id).toBe(conversationId);
    expect(detail.jobId).toBe(jobId);

    const send = async (actor: Actor, body: string) => {
      const res = await ctx
        .http()
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', bearer(actor))
        .send({ type: 'TEXT', clientMessageId: randomUUID(), body })
        .expect(201);
      return chatMessageSchema.parse(res.body);
    };
    await send(customer, 'Kapı kodunu mesajdan göndereceğim.');
    await send(provider, 'Yaklaşık 30 dakika içinde gelebilirim.');

    for (const actor of [customer, provider]) {
      const res = await ctx
        .http()
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', bearer(actor))
        .expect(200);
      const page = messagePageSchema.parse(res.body);
      const texts = page.items.filter((i) => i.type === 'TEXT').map((i) => i.body);
      expect(texts).toEqual(
        expect.arrayContaining([
          'Kapı kodunu mesajdan göndereceğim.',
          'Yaklaşık 30 dakika içinde gelebilirim.',
        ]),
      );
      const system = page.items.filter((i) => i.type === 'SYSTEM').map((i) => i.body ?? '');
      expect(system.some((b) => b.startsWith('Teklif kabul edildi: ₺2.200'))).toBe(true);
    }
  });

  it('8. after agreement the provider sees the full address and the customer contact', async () => {
    const res = await ctx
      .http()
      .get(`/api/v1/jobs/${jobId}`)
      .set('Authorization', bearer(provider))
      .expect(200);
    const job = jobSchema.parse(res.body);
    expect(job.address).toMatchObject({
      district: { id: m.cukurova },
      addressLine: 'Gizlisokak Caddesi No: 12',
      buildingNo: '47B',
      apartmentNo: 'Daire 19',
    });
    expect(job.customer).toMatchObject({ name: 'Zeynep Gizlisoyad', phone: customer.phone });
  });

  it('9. on the way → arrived → started; +₺500 change order approved: total ₺2.700', async () => {
    await stepOk(ctx, provider, jobId, 'en-route');
    await stepOk(ctx, provider, jobId, 'arrive');
    const started = await stepOk(ctx, provider, jobId, 'start');
    expect(started.status).toBe('IN_PROGRESS');
    const co = await createChangeOrder(ctx, provider, jobId, 50000);
    await answerChangeOrder(ctx, customer, co.id, 'accept').expect(200);
    const job = await getJob(ctx, customer, jobId);
    expect(job.agreedPrice.amountMinor).toBe(220000);
    expect(job.currentTotal.amountMinor).toBe(270000);
    expect((await summaryOf(ctx, customer, jobId)).outstanding.amountMinor).toBe(270000);
  });

  it('10. TEST payment of ₺2.700: platform fee ₺405, provider earning ₺2.295', async () => {
    const payment = await payOnline(ctx, customer, jobId, 'SUCCESS');
    expect(payment.status).toBe('SUCCEEDED');
    expect(payment.amount.amountMinor).toBe(270000);
    const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.platformFeeMinor).toBe(40500n);
    const earning = await ctx.prisma.providerEarning.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(earning).toMatchObject({ grossMinor: 270000n, feeMinor: 40500n, netMinor: 229500n });
    const summary = await summaryOf(ctx, customer, jobId);
    expect(summary.outstanding.amountMinor).toBe(0);
    await expectLedgerConsistent(ctx, [jobId]);
  });

  it('11. completed and confirmed; 5-star review; provider added to favorites', async () => {
    await stepOk(ctx, provider, jobId, 'request-completion');
    const done = await stepOk(ctx, customer, jobId, 'complete');
    expect(done.status).toBe('COMPLETED');
    const wallet = await walletOf(ctx, provider);
    expect(wallet.balances.available.amountMinor).toBe(229500);

    await postReview(ctx, customer, jobId, {
      rating: 5,
      comment: 'Çok hızlı geldi, prizi temiz bir şekilde onardı. Teşekkürler.',
    }).expect(201);
    await ctx
      .http()
      .put(`/api/v1/me/favorites/${provider.providerId}`)
      .set('Authorization', bearer(customer))
      .expect(204);
    const favs = await ctx
      .http()
      .get('/api/v1/me/favorites')
      .set('Authorization', bearer(customer))
      .expect(200);
    expect(favs.body.items.map((f: { provider: { id: string } }) => f.provider.id)).toEqual([
      provider.providerId,
    ]);
    expect(favs.body.items[0].provider.rating).toEqual({ average: 5, count: 1 });
  });

  it('12. rehire: a draft, then a new request for the same provider; the old job is unchanged', async () => {
    const funnelAfter = await funnel();
    for (const key of [
      'created',
      'dispatched',
      'viewed',
      'quoted',
      'accepted',
      'started',
      'completed',
    ]) {
      expect(funnelAfter.get(key), key).toBe((funnelBefore.get(key) ?? 0) + 1);
    }

    const res = await ctx
      .http()
      .get(`/api/v1/jobs/${jobId}/rehire`)
      .set('Authorization', bearer(customer))
      .expect(200);
    const draft = rehireDraftSchema.parse(res.body);
    expect(draft).toMatchObject({
      jobId,
      category: { id: elektrikId },
      provider: { id: provider.providerId, available: true },
      addressId: customer.addressId,
    });
    const again = await createRequestV2(ctx, customer, {
      categoryId: draft.category.id,
      title: draft.title,
      preferredProviderId: draft.provider.id,
      rehireOfJobId: jobId,
      answers: requiredAnswers(form),
    });
    expect(again.rehireOfJobId).toBe(jobId);
    expect(again.dispatch?.preferredProvider).toMatchObject({ id: provider.providerId });
    const rows = await dispatchesOf(ctx, again.id);
    expect(rows.find((r) => r.providerId === provider.providerId)?.isPreferred).toBe(true);

    const old = await getJob(ctx, customer, jobId);
    expect(old.status).toBe('COMPLETED');
    expect(old.agreedPrice.amountMinor).toBe(220000);
    expect(old.currentTotal.amountMinor).toBe(270000);
  });

  it('13. admin: marketplace events recorded for the request', async () => {
    const res = await ctx
      .http()
      .get('/api/v1/admin/marketplace/overview?days=1')
      .set('Authorization', bearer(admin))
      .expect(200);
    const overview = marketplaceOverviewSchema.parse(res.body);
    expect(overview.search.searches).toBeGreaterThanOrEqual(1);
    const events = await ctx.prisma.marketplaceEvent.findMany({
      where: { serviceRequestId: request.id },
      select: { type: true, providerId: true, metadata: true },
    });
    const types = new Set(events.map((e) => e.type));
    for (const type of [
      'request_created',
      'request_dispatched',
      'provider_viewed_request',
      'quote_created',
      'quote_accepted',
      'job_started',
      'job_completed',
      'conversation_started',
      'message_sent',
    ] as const) {
      expect(types.has(type), type).toBe(true);
    }
    // Events never carry message bodies, addresses or phone numbers.
    const text = JSON.stringify(events);
    for (const secret of ['Kapı kodunu', 'Gizlisokak', customer.phone.replace('+90', '')]) {
      expect(text).not.toContain(secret);
    }
  });

  it('14. the ledger balances and reconciliation finds nothing for this job', async () => {
    await expectLedgerConsistent(ctx, [jobId]);
    const res = await ctx
      .http()
      .get('/api/v1/admin/finance/reconciliation')
      .set('Authorization', bearer(admin))
      .expect(200);
    const report = reconciliationReportSchema.parse(res.body);
    expect(report.ledgerBalanced).toBe(true);
    expect(report.totals.debit.amountMinor).toBe(report.totals.credit.amountMinor);
    const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { jobId } });
    const earning = await ctx.prisma.providerEarning.findFirstOrThrow({ where: { jobId } });
    const mine = report.mismatches.filter((x) =>
      [jobId, payment.id, earning.id, provider.providerId].includes(x.entityId),
    );
    expect(mine).toEqual([]);
  });
});
