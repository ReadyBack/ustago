import { randomUUID } from 'node:crypto';

import {
  paginatedSchema,
  serviceRequestListItemSchema,
  serviceRequestSchema,
  signedUrlSchema,
  uploadIntentResponseSchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import {
  adanaMarket,
  createQuote,
  createRequest,
  customerIn,
  type Market,
  opportunityIds,
  postRequest,
  providerIn,
} from './marketplace-helpers.js';
import { FILES, pathOf } from './provider-helpers.js';
import { RequestExpiryService } from '../src/service-requests/request-expiry.service.js';

describe('Service requests (e2e)', () => {
  let ctx: TestContext;
  let m: Market;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  describe('budget', () => {
    it('accepts "bütçem belli değil" (null budget)', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequest(ctx, customer, {
        categoryId: m.klimaId,
        budgetMinor: null,
      });
      expect(request.budget).toBeNull();
      expect(request.status).toBe('PUBLISHED');
      expect(request.publishedAt).not.toBeNull();
      expect(request.expiresAt).not.toBeNull();
    });

    it('stores a 1500 TL budget as 150000 minor units in TRY', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const request = await createRequest(ctx, customer, {
        categoryId: m.klimaId,
        budgetMinor: 150000,
      });
      expect(request.budget).toEqual({ amountMinor: 150000, currency: 'TRY' });
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.budgetMinor).toBe(150000n);
    });

    it('never treats the budget as a ceiling: a 2500 TL quote on a 1500 TL budget is accepted', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, {
        categoryId: m.klimaId,
        budgetMinor: 150000,
      });
      const quote = await createQuote(ctx, provider, request.id, 250000);
      expect(quote.latest.total.amountMinor).toBe(250000);
    });

    it('rejects a zero, negative or fractional budget', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      for (const budgetMinor of [0, -100, 1500.5]) {
        const res = await postRequest(ctx, customer, { categoryId: m.klimaId, budgetMinor });
        expect(res.status).toBe(400);
      }
    });

    it('requires the budget key so "unknown" is always an explicit choice', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .post('/api/v1/service-requests')
        .set('Authorization', bearer(customer))
        .send({
          type: 'QUOTE',
          categoryId: m.klimaId,
          addressId: customer.addressId,
          title: 'Klima bakımı',
          description: 'Yıllık bakım ve gaz kontrolü yapılacak.',
        })
        .expect(400);
    });
  });

  describe('lifecycle', () => {
    it('saves a draft and publishes it once; a second publish changes nothing', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const draft = await createRequest(ctx, customer, {
        categoryId: m.klimaId,
        publish: false,
      });
      expect(draft.status).toBe('DRAFT');
      expect(draft.publishedAt).toBeNull();
      expect(draft.actions.publish).toBe(true);

      const publish = () =>
        ctx
          .http()
          .post(`/api/v1/service-requests/${draft.id}/publish`)
          .set('Authorization', bearer(customer))
          .expect(200);
      const first = serviceRequestSchema.parse((await publish()).body);
      expect(first.status).toBe('PUBLISHED');
      const second = serviceRequestSchema.parse((await publish()).body);
      expect(second.publishedAt).toBe(first.publishedAt);
      expect(
        await ctx.prisma.auditLog.count({
          where: { entityId: draft.id, action: 'service_request.published' },
        }),
      ).toBe(1);
    });

    it('does not show drafts to providers', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const draft = await createRequest(ctx, customer, { categoryId: m.klimaId, publish: false });
      expect(await opportunityIds(ctx, provider)).not.toContain(draft.id);
    });

    it('returns the same request for a repeated idempotency key', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const idempotencyKey = randomUUID();
      const a = await createRequest(ctx, customer, { categoryId: m.klimaId, idempotencyKey });
      const b = await createRequest(ctx, customer, { categoryId: m.klimaId, idempotencyKey });
      expect(b.id).toBe(a.id);
      expect(
        await ctx.prisma.serviceRequest.count({ where: { customer: { userId: customer.userId } } }),
      ).toBe(1);
    });

    it('edits freely before quotes, locks category/address after the first quote', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, {
        categoryIds: [m.klimaId, m.elektrikId],
        districtIds: [m.seyhan],
      });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const patch = (body: Record<string, unknown>) =>
        ctx
          .http()
          .patch(`/api/v1/service-requests/${request.id}`)
          .set('Authorization', bearer(customer))
          .send(body);

      await patch({ title: 'Klima montajı ve bakım' }).expect(200);
      await createQuote(ctx, provider, request.id, 200000);

      const locked = await patch({ categoryId: m.elektrikId }).expect(409);
      expect(locked.body.code).toBe('REQUEST_FIELD_LOCKED');
      // Budget and description may still change: they are the customer's own estimate.
      const edited = serviceRequestSchema.parse(
        (await patch({ budgetMinor: 180000 }).expect(200)).body,
      );
      expect(edited.budget?.amountMinor).toBe(180000);
      expect(edited.status).toBe('QUOTED');
    });

    it('cancels an open request, closes its quotes and notifies the provider', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const quote = await createQuote(ctx, provider, request.id, 200000);

      const res = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({ reason: 'Başka bir çözüm buldum.' })
        .expect(200);
      const cancelled = serviceRequestSchema.parse(res.body);
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelledAt).not.toBeNull();

      const row = await ctx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(row.status).toBe('EXPIRED');
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      expect(
        await ctx.prisma.notification.count({
          where: { userId: provider.userId, type: 'service_request.cancelled' },
        }),
      ).toBe(1);

      // Cancelled is final.
      const again = await ctx
        .http()
        .post(`/api/v1/service-requests/${request.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(409);
      expect(again.body.code).toBe('INVALID_REQUEST_STATE');
    });

    it('expires an old request in the sweep and closes its quotes', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const quote = await createQuote(ctx, provider, request.id, 200000);
      await ctx.prisma.serviceRequest.update({
        where: { id: request.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // Past its expiry it is already hidden, before the sweep runs.
      expect(await opportunityIds(ctx, provider)).not.toContain(request.id);
      const accept = await ctx
        .http()
        .post(`/api/v1/quotes/${quote.id}/accept`)
        .set('Authorization', bearer(customer))
        .send({ expectedRevisionNo: 1 })
        .expect(409);
      expect(accept.body.code).toBe('REQUEST_EXPIRED');

      await ctx.app.get(RequestExpiryService).sweep();
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.status).toBe('EXPIRED');
      expect((await ctx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe(
        'EXPIRED',
      );
    });

    it('lists the customer’s own requests by group', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const open = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const cancelled = await createRequest(ctx, customer, { categoryId: m.klimaId });
      await ctx
        .http()
        .post(`/api/v1/service-requests/${cancelled.id}/cancel`)
        .set('Authorization', bearer(customer))
        .send({})
        .expect(200);

      const list = async (group: string) => {
        const res = await ctx
          .http()
          .get(`/api/v1/me/service-requests?group=${group}`)
          .set('Authorization', bearer(customer))
          .expect(200);
        return paginatedSchema(serviceRequestListItemSchema)
          .parse(res.body)
          .items.map((r) => r.id);
      };
      expect(await list('OPEN')).toEqual([open.id]);
      expect(await list('CLOSED')).toEqual([cancelled.id]);
      expect(await list('AGREED')).toEqual([]);
    });
  });

  describe('service availability', () => {
    it('refuses a category that is not open in the province', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      await ctx.prisma.provinceCategory.create({
        data: { provinceId: m.provinceId, categoryId: m.elektrikId, isActive: false },
      });
      try {
        const res = await postRequest(ctx, customer, { categoryId: m.elektrikId }).expect(422);
        expect(res.body.code).toBe('SERVICE_NOT_AVAILABLE_IN_AREA');
      } finally {
        await ctx.prisma.provinceCategory.deleteMany({
          where: { provinceId: m.provinceId, categoryId: m.elektrikId },
        });
      }
    });

    it('refuses NOW for a category that has no emergency service', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const res = await postRequest(ctx, customer, { type: 'NOW', categoryId: m.boyaId }).expect(
        422,
      );
      expect(res.body.code).toBe('NOW_NOT_AVAILABLE_IN_AREA');
    });

    it('refuses NOW where the province closed emergency service for the category', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      await ctx.prisma.provinceCategory.create({
        data: {
          provinceId: m.provinceId,
          categoryId: m.elektrikId,
          isActive: true,
          nowEnabled: false,
        },
      });
      try {
        const res = await postRequest(ctx, customer, {
          type: 'NOW',
          categoryId: m.elektrikId,
        }).expect(422);
        expect(res.body.code).toBe('NOW_NOT_AVAILABLE_IN_AREA');
      } finally {
        await ctx.prisma.provinceCategory.deleteMany({
          where: { provinceId: m.provinceId, categoryId: m.elektrikId },
        });
      }
    });

    it('refuses someone else’s address', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const other = await customerIn(ctx, m.seyhan);
      const res = await postRequest(
        ctx,
        { ...customer, addressId: other.addressId },
        {
          categoryId: m.klimaId,
        },
      ).expect(422);
      expect(res.body.code).toBe('ADDRESS_NOT_FOUND');
    });
  });

  describe('authorization', () => {
    it('hides other customers’ requests (IDOR → 404)', async () => {
      const owner = await customerIn(ctx, m.seyhan);
      const stranger = await customerIn(ctx, m.seyhan);
      const request = await createRequest(ctx, owner, { categoryId: m.klimaId });
      const auth = bearer(stranger);
      const calls = [
        () => ctx.http().get(`/api/v1/service-requests/${request.id}`).set('Authorization', auth),
        () =>
          ctx
            .http()
            .patch(`/api/v1/service-requests/${request.id}`)
            .set('Authorization', auth)
            .send({ title: 'Ele geçirildi' }),
        () =>
          ctx
            .http()
            .post(`/api/v1/service-requests/${request.id}/cancel`)
            .set('Authorization', auth)
            .send({}),
        () =>
          ctx
            .http()
            .post(`/api/v1/service-requests/${request.id}/publish`)
            .set('Authorization', auth),
        () =>
          ctx
            .http()
            .get(`/api/v1/service-requests/${request.id}/quotes`)
            .set('Authorization', auth),
      ];
      for (const call of calls) {
        const res = await call();
        expect(res.status).toBe(404);
      }
      const row = await ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
      expect(row.status).toBe('PUBLISHED');
      expect(row.title).toBe(request.title);
    });

    it('requires authentication', async () => {
      await ctx.http().get('/api/v1/me/service-requests').expect(401);
      await ctx.http().post('/api/v1/service-requests').send({}).expect(401);
    });
  });

  describe('photos', () => {
    async function uploadPhoto(customer: { tokens: { accessToken: string } }) {
      const res = await ctx
        .http()
        .post('/api/v1/service-requests/photos/upload-intent')
        .set('Authorization', `Bearer ${customer.tokens.accessToken}`)
        .send({ mimeType: 'image/png', sizeBytes: FILES.png.length, fileName: 'klima.png' })
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

    it('attaches an uploaded photo and serves it only to allowed viewers', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const provider = await providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan] });
      const outsider = await providerIn(ctx, {
        categoryIds: [m.klimaId],
        districtIds: [m.yuregir],
      });
      const stranger = await customerIn(ctx, m.seyhan);
      const admin = await createStaffUser(ctx, ['ADMIN']);

      const uploadId = await uploadPhoto(customer);
      const request = await createRequest(ctx, customer, {
        categoryId: m.klimaId,
        photoUploadIds: [uploadId],
      });
      expect(request.photos).toHaveLength(1);
      const photoId = request.photos[0]?.id;
      const url = (auth: string) =>
        ctx
          .http()
          .get(`/api/v1/service-requests/${request.id}/photos/${photoId}/url`)
          .set('Authorization', auth);

      signedUrlSchema.parse((await url(bearer(customer)).expect(200)).body);
      signedUrlSchema.parse((await url(bearer(provider)).expect(200)).body);
      signedUrlSchema.parse((await url(bearer(admin)).expect(200)).body);
      expect((await url(bearer(outsider))).status).toBe(404);
      expect((await url(bearer(stranger))).status).toBe(404);

      // A consumed upload cannot be attached to a second request.
      const reuse = await postRequest(ctx, customer, {
        categoryId: m.klimaId,
        photoUploadIds: [uploadId],
      });
      expect(reuse.status).toBe(404);
      expect(reuse.body.code).toBe('UPLOAD_NOT_FOUND');
    });

    it('refuses a photo that was never uploaded or is not an image', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const res = await ctx
        .http()
        .post('/api/v1/service-requests/photos/upload-intent')
        .set('Authorization', bearer(customer))
        .send({ mimeType: 'image/png', sizeBytes: FILES.html.length })
        .expect(201);
      const intent = uploadIntentResponseSchema.parse(res.body);
      const notUploaded = await postRequest(ctx, customer, {
        categoryId: m.klimaId,
        photoUploadIds: [intent.uploadId],
      }).expect(422);
      expect(notUploaded.body.code).toBe('UPLOAD_NOT_COMPLETED');

      await ctx
        .http()
        .put(pathOf(intent.uploadUrl))
        .set('Content-Type', 'image/png')
        .send(FILES.html);
      const disguised = await postRequest(ctx, customer, {
        categoryId: m.klimaId,
        photoUploadIds: [intent.uploadId],
      });
      expect(disguised.status).toBe(422);
    });

    it('refuses PDFs and files over 10 MB at the intent step', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const intent = (body: Record<string, unknown>) =>
        ctx
          .http()
          .post('/api/v1/service-requests/photos/upload-intent')
          .set('Authorization', bearer(customer))
          .send(body);
      expect((await intent({ mimeType: 'application/pdf', sizeBytes: 100 })).status).toBe(400);
      const big = await intent({ mimeType: 'image/jpeg', sizeBytes: 10 * 1024 * 1024 + 1 });
      expect([400, 422]).toContain(big.status);
    });
  });
});
