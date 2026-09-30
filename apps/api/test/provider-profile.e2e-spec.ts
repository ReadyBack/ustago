import type { PortfolioItem, PublicProviderProfileV2 } from '@ustago/types';
import {
  categoryQuestionSchema,
  paginatedSchema,
  portfolioItemSchema,
  priceGuideSchema,
  publicProviderProfileV2Schema,
  publicReviewSchema,
  requestFormSchema,
  uploadIntentResponseSchema,
} from '@ustago/validation';

import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  RUN_ID,
  type TestContext,
} from './helpers.js';
import { agreedJob, completedJob, postReview } from './job-helpers.js';
import {
  ADANA,
  type Customer,
  customerIn,
  type Market,
  adanaMarket,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import { type Actor, FILES, pathOf } from './provider-helpers.js';

const api = (path: string) => `/api/v1${path}`;

describe('Provider profile: portfolio, photo, public profile V2, reviews, category content (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let admin: Awaited<ReturnType<typeof createStaffUser>>;
  const providerIds: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    admin = await createStaffUser(ctx, ['ADMIN']);
  });

  afterAll(async () => {
    // Portfolio media restrict deleting their upload intents: remove first.
    await ctx.prisma.providerPortfolioItem.deleteMany({
      where: { providerId: { in: providerIds } },
    });
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  async function provider(
    options: Partial<Parameters<typeof providerIn>[1]> = {},
  ): Promise<ProviderActor> {
    const p = await providerIn(ctx, {
      categoryIds: [m.klimaId],
      districtIds: [m.seyhan, m.cukurova],
      displayName: 'Profil Test Ustası',
      ...options,
    });
    providerIds.push(p.providerId);
    return p;
  }

  async function uploadImage(
    actor: Actor,
    target: 'portfolio' | 'photo',
    bytes: Buffer = FILES.png,
    mimeType = 'image/png',
  ): Promise<string> {
    const res = await ctx
      .http()
      .post(api(`/providers/me/${target}/upload-intent`))
      .set('Authorization', bearer(actor))
      .send({ mimeType, sizeBytes: bytes.length, fileName: 'is.png' })
      .expect(201);
    const intent = uploadIntentResponseSchema.parse(res.body);
    await ctx
      .http()
      .put(pathOf(intent.uploadUrl))
      .set('Content-Type', intent.headers['Content-Type'] ?? mimeType)
      .send(bytes)
      .expect(204);
    return intent.uploadId;
  }

  function createItem(actor: Actor, body: Record<string, unknown>) {
    return ctx
      .http()
      .post(api('/providers/me/portfolio'))
      .set('Authorization', bearer(actor))
      .send(body);
  }

  async function newItem(actor: Actor, title = 'Salon klima montajı'): Promise<PortfolioItem> {
    const uploadId = await uploadImage(actor, 'portfolio');
    const res = await createItem(actor, {
      title,
      categoryId: m.klimaId,
      uploadIds: [uploadId],
      consentConfirmed: true,
    }).expect(201);
    return portfolioItemSchema.parse(res.body);
  }

  async function publicProfile(
    providerId: string,
    options: { auth?: Actor; districtId?: string } = {},
  ): Promise<PublicProviderProfileV2> {
    const req = ctx.http().get(api(`/providers/${providerId}`));
    if (options.districtId) req.query({ districtId: options.districtId });
    if (options.auth) req.set('Authorization', bearer(options.auth));
    const res = await req.expect(200);
    return publicProviderProfileV2Schema.parse(res.body);
  }

  // -------------------------------------------------------------------------
  describe('portfolio', () => {
    it('creates, lists, edits, reorders and soft-deletes items', async () => {
      const p = await provider();
      const auth = bearer(p);

      const noConsent = await uploadImage(p, 'portfolio');
      for (const consent of [undefined, false]) {
        await createItem(p, {
          title: 'Kombi bakımı',
          uploadIds: [noConsent],
          ...(consent === undefined ? {} : { consentConfirmed: consent }),
        }).expect(400);
      }

      const first = await newItem(p, 'Salon klima montajı');
      expect(first).toMatchObject({
        title: 'Salon klima montajı',
        description: null,
        category: { id: m.klimaId },
        sortOrder: 0,
      });
      expect(first.media).toHaveLength(1);
      expect(first.media[0]).toMatchObject({ kind: 'IMAGE', mimeType: 'image/png' });
      // The signed URL serves the stored image.
      const file = await ctx
        .http()
        .get(pathOf(first.media[0]?.url ?? ''))
        .expect(200);
      expect(Buffer.from(file.body as Buffer).subarray(0, 4)).toEqual(FILES.png.subarray(0, 4));
      const row = await ctx.prisma.providerPortfolioItem.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(row.consentConfirmedAt).toBeInstanceOf(Date);

      const second = await newItem(p, 'Çift klima bakımı');
      expect(second.sortOrder).toBe(1);

      const patched = await ctx
        .http()
        .patch(api(`/providers/me/portfolio/${first.id}`))
        .set('Authorization', auth)
        .send({ title: 'Salon split klima montajı', description: 'İki gün sürdü.' })
        .expect(200);
      expect(patched.body).toMatchObject({
        title: 'Salon split klima montajı',
        description: 'İki gün sürdü.',
      });

      const reordered = await ctx
        .http()
        .put(api('/providers/me/portfolio/order'))
        .set('Authorization', auth)
        .send({ itemIds: [second.id, first.id] })
        .expect(200);
      expect((reordered.body as PortfolioItem[]).map((i) => i.id)).toEqual([second.id, first.id]);
      const partial = await ctx
        .http()
        .put(api('/providers/me/portfolio/order'))
        .set('Authorization', auth)
        .send({ itemIds: [first.id] })
        .expect(422);
      expect(partial.body.code).toBe('PORTFOLIO_ORDER_INCOMPLETE');

      await ctx
        .http()
        .delete(api(`/providers/me/portfolio/${second.id}`))
        .set('Authorization', auth)
        .expect(204);
      const list = await ctx
        .http()
        .get(api('/providers/me/portfolio'))
        .set('Authorization', auth)
        .expect(200);
      expect((list.body as PortfolioItem[]).map((i) => i.id)).toEqual([first.id]);
      const deleted = await ctx.prisma.providerPortfolioItem.findUniqueOrThrow({
        where: { id: second.id },
      });
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      // Its file is gone from storage too (best effort, synchronous here).
      await ctx
        .http()
        .get(pathOf(second.media[0]?.url ?? ''))
        .expect(404);
      const audit = await ctx.prisma.auditLog.findMany({
        where: { entityId: { in: [first.id, second.id] } },
        select: { action: true },
      });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'portfolio.item_created',
        'portfolio.item_created',
        'portfolio.item_deleted',
        'portfolio.item_updated',
      ]);
    });

    it("hides another provider's items (404) and refuses customers (403)", async () => {
      const owner = await provider();
      const other = await provider();
      const item = await newItem(owner);
      const as = bearer(other);
      await ctx
        .http()
        .patch(api(`/providers/me/portfolio/${item.id}`))
        .set('Authorization', as)
        .send({ title: 'Başkasının işi' })
        .expect(404);
      await ctx
        .http()
        .delete(api(`/providers/me/portfolio/${item.id}`))
        .set('Authorization', as)
        .expect(404);
      await ctx
        .http()
        .put(api('/providers/me/portfolio/order'))
        .set('Authorization', as)
        .send({ itemIds: [item.id] })
        .expect(404);
      // Someone else's upload cannot be attached either.
      const foreignUpload = await uploadImage(owner, 'portfolio');
      const res = await createItem(other, {
        title: 'Çalıntı fotoğraf',
        uploadIds: [foreignUpload],
        consentConfirmed: true,
      }).expect(404);
      expect(res.body.code).toBe('UPLOAD_NOT_FOUND');

      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .get(api('/providers/me/portfolio'))
        .set('Authorization', bearer(customer))
        .expect(403);
      await ctx.http().get(api('/providers/me/portfolio')).expect(401);
    });

    it('accepts only real JPEG/PNG within the size limit, once', async () => {
      const p = await provider();
      const auth = bearer(p);
      // Declared type outside the allow-list.
      await ctx
        .http()
        .post(api('/providers/me/portfolio/upload-intent'))
        .set('Authorization', auth)
        .send({ mimeType: 'image/svg+xml', sizeBytes: 100 })
        .expect(400);
      const tooBig = await ctx
        .http()
        .post(api('/providers/me/portfolio/upload-intent'))
        .set('Authorization', auth)
        .send({ mimeType: 'image/png', sizeBytes: 50 * 1024 * 1024 })
        .expect(422);
      expect(tooBig.body.code).toBe('INVALID_IMAGE');

      // HTML labelled as PNG: caught by the magic bytes, file deleted.
      for (const bytes of [FILES.html, FILES.svg, FILES.pdf]) {
        const fake = await uploadImage(p, 'portfolio', bytes, 'image/png');
        const res = await createItem(p, {
          title: 'Sahte fotoğraf',
          uploadIds: [fake],
          consentConfirmed: true,
        }).expect(422);
        expect(res.body.code).toBe('INVALID_IMAGE');
      }

      // A JPEG declared as PNG is refused as well.
      const mismatch = await uploadImage(p, 'portfolio', FILES.jpeg, 'image/png');
      await createItem(p, {
        title: 'Yanlış tür',
        uploadIds: [mismatch],
        consentConfirmed: true,
      }).expect(422);

      // A profile-photo upload is not a portfolio upload.
      const photoUpload = await uploadImage(p, 'photo');
      await createItem(p, {
        title: 'Yanlış amaç',
        uploadIds: [photoUpload],
        consentConfirmed: true,
      }).expect(404);

      const ok = await uploadImage(p, 'portfolio', FILES.jpeg, 'image/jpeg');
      await createItem(p, { title: 'Mutfak', uploadIds: [ok], consentConfirmed: true }).expect(201);
      // An upload is single use.
      const reuse = await createItem(p, {
        title: 'Tekrar',
        uploadIds: [ok],
        consentConfirmed: true,
      }).expect(404);
      expect(reuse.body.code).toBe('UPLOAD_NOT_FOUND');
    });

    it('enforces the per-item photo and per-provider item limits', async () => {
      const p = await provider();
      const ids = await Promise.all(Array.from({ length: 7 }, () => uploadImage(p, 'portfolio')));
      await createItem(p, { title: 'Çok foto', uploadIds: ids, consentConfirmed: true }).expect(
        400,
      );
      const six = await createItem(p, {
        title: 'Altı foto',
        uploadIds: ids.slice(0, 6),
        consentConfirmed: true,
      }).expect(201);
      expect(portfolioItemSchema.parse(six.body).media).toHaveLength(6);

      await ctx.prisma.providerPortfolioItem.createMany({
        data: Array.from({ length: 29 }, (_, i) => ({
          providerId: p.providerId,
          title: `Eski iş ${i}`,
          sortOrder: i + 1,
          consentConfirmedAt: new Date(),
        })),
      });
      const limit = await createItem(p, {
        title: 'Otuz birinci',
        uploadIds: [ids[6]],
        consentConfirmed: true,
      }).expect(422);
      expect(limit.body.code).toBe('PORTFOLIO_LIMIT_REACHED');
    });
  });

  // -------------------------------------------------------------------------
  describe('profile photo', () => {
    it('sets, serves and removes the photo; refuses non-images', async () => {
      const p = await provider();
      const auth = bearer(p);
      expect((await publicProfile(p.providerId)).photoUrl).toBeNull();

      const fake = await uploadImage(p, 'photo', FILES.html, 'image/png');
      const bad = await ctx
        .http()
        .put(api('/providers/me/photo'))
        .set('Authorization', auth)
        .send({ uploadId: fake })
        .expect(422);
      expect(bad.body.code).toBe('INVALID_IMAGE');

      const uploadId = await uploadImage(p, 'photo', FILES.jpeg, 'image/jpeg');
      const res = await ctx
        .http()
        .put(api('/providers/me/photo'))
        .set('Authorization', auth)
        .send({ uploadId })
        .expect(200);
      const photoUrl = res.body.photoUrl as string;
      await ctx.http().get(pathOf(photoUrl)).expect(200);
      const profile = await publicProfile(p.providerId);
      expect(profile.photoUrl).not.toBeNull();
      expect(profile.photoUrl).not.toContain('profile-photos/');

      // Replacing removes the previous object.
      const next = await uploadImage(p, 'photo');
      await ctx
        .http()
        .put(api('/providers/me/photo'))
        .set('Authorization', auth)
        .send({ uploadId: next })
        .expect(200);
      await ctx.http().get(pathOf(photoUrl)).expect(404);

      await ctx.http().delete(api('/providers/me/photo')).set('Authorization', auth).expect(204);
      expect((await publicProfile(p.providerId)).photoUrl).toBeNull();
      const row = await ctx.prisma.providerProfile.findUniqueOrThrow({
        where: { id: p.providerId },
      });
      expect(row.photoStorageKey).toBeNull();

      const customer = await customerIn(ctx, m.seyhan);
      await ctx
        .http()
        .post(api('/providers/me/photo/upload-intent'))
        .set('Authorization', bearer(customer))
        .send({ mimeType: 'image/png', sizeBytes: 100 })
        .expect(403);
    });

    it('rejects a bio with markup on PATCH /providers/me', async () => {
      const p = await provider();
      await ctx
        .http()
        .patch(api('/providers/me'))
        .set('Authorization', bearer(p))
        .send({ bio: 'Merhaba <script>alert(1)</script> klima ustasıyım.' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('public profile V2', () => {
    it('shows real aggregates and coverage, never private data', async () => {
      const p = await provider();
      await ctx.prisma.providerServiceRegion.create({
        data: { providerId: p.providerId, kind: 'PROVINCE', provinceId: 33 },
      });
      await newItem(p, 'Villa klima montajı');

      const res = await ctx
        .http()
        .get(api(`/providers/${p.providerId}`))
        .expect(200);
      const profile = publicProviderProfileV2Schema.parse(res.body);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'id',
          'displayName',
          'photoUrl',
          'bio',
          'yearsOfExperience',
          'isVerified',
          'ustaScore',
          'isNewProvider',
          'rating',
          'reviewDistribution',
          'completedJobCount',
          'categories',
          'serviceAreaLabels',
          'distance',
          'availability',
          'responseStats',
          'portfolio',
          'recentReviews',
          'isFavorite',
          'memberSince',
        ].sort(),
      );
      expect(profile).toMatchObject({
        displayName: 'Profil Test Ustası',
        isVerified: true,
        isNewProvider: true,
        ustaScore: null,
        rating: null,
        completedJobCount: 0,
        reviewDistribution: { five: 0, four: 0, three: 0, two: 0, one: 0 },
        distance: null,
        responseStats: null,
        isFavorite: false,
        availability: { acceptingNewJobs: true, onTimeOff: false },
        recentReviews: [],
      });
      expect(profile.categories.map((c) => c.id)).toEqual([m.klimaId]);
      expect(profile.serviceAreaLabels).toEqual(['Adana: Çukurova, Seyhan', 'Mersin (tüm il)']);
      expect(profile.portfolio.map((i) => i.title)).toEqual(['Villa klima montajı']);

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(user.phone ?? '<none>');
      expect(text).not.toContain(p.userId);
      expect(text).not.toMatch(
        /phone|e-?mail|nationalId|tckn|taxNumber|iban|address|documentKey|storageKey|statusReason|Atatürk/i,
      );
    });

    it('gives an approximate distance only when a district is sent', async () => {
      const p = await provider({ districtIds: [m.seyhan] });
      expect((await publicProfile(p.providerId)).distance).toBeNull();
      const far = await publicProfile(p.providerId, { districtId: m.yuregir });
      expect(far.distance).toMatchObject({ approximate: true });
      expect(far.distance?.km).toBeGreaterThan(0);
      // Same district: centres coincide, the floor is "Yaklaşık 1 km".
      expect((await publicProfile(p.providerId, { districtId: m.seyhan })).distance).toEqual({
        km: 1,
        approximate: true,
      });
      // The service centre wins over the first service area.
      await ctx.prisma.providerProfile.update({
        where: { id: p.providerId },
        data: { serviceCenterDistrictId: m.yuregir },
      });
      expect((await publicProfile(p.providerId, { districtId: m.yuregir })).distance?.km).toBe(1);
      await ctx
        .http()
        .get(api(`/providers/${p.providerId}`))
        .query({ districtId: 'not-a-uuid' })
        .expect(400);
    });

    it('reports availability from the provider settings', async () => {
      const p = await provider();
      const now = Date.now();
      await ctx.prisma.providerTimeOff.create({
        data: {
          providerId: p.providerId,
          startsAt: new Date(now - 3_600_000),
          endsAt: new Date(now + 86_400_000),
        },
      });
      expect((await publicProfile(p.providerId)).availability).toEqual({
        availableToday: false,
        onTimeOff: true,
        acceptingNewJobs: true,
      });
      await ctx.prisma.providerProfile.update({
        where: { id: p.providerId },
        data: { acceptingNewJobs: false },
      });
      expect((await publicProfile(p.providerId)).availability).toMatchObject({
        availableToday: false,
        acceptingNewJobs: false,
      });
    });

    it('marks favorites only for the customer who saved the provider', async () => {
      const p = await provider();
      const fan = await customerIn(ctx, m.seyhan);
      const stranger = await customerIn(ctx, m.seyhan);
      const fanProfile = await ctx.prisma.customerProfile.findUniqueOrThrow({
        where: { userId: fan.userId },
      });
      await ctx.prisma.favoriteProvider.create({
        data: { customerId: fanProfile.id, providerId: p.providerId },
      });
      expect((await publicProfile(p.providerId, { auth: fan })).isFavorite).toBe(true);
      expect((await publicProfile(p.providerId, { auth: stranger })).isFavorite).toBe(false);
      expect((await publicProfile(p.providerId)).isFavorite).toBe(false);
      expect((await publicProfile(p.providerId, { auth: p })).isFavorite).toBe(false);
      // A token that is sent must be valid.
      await ctx
        .http()
        .get(api(`/providers/${p.providerId}`))
        .set('Authorization', 'Bearer not-a-token')
        .expect(401);
    });

    it('is a 404 for suspended, banned, unapproved or unknown providers', async () => {
      const suspended = await provider();
      await ctx.prisma.providerProfile.update({
        where: { id: suspended.providerId },
        data: { accountStatus: 'SUSPENDED' },
      });
      const banned = await provider();
      await ctx.prisma.providerProfile.update({
        where: { id: banned.providerId },
        data: { accountStatus: 'BANNED' },
      });
      const pending = await provider({ status: 'PENDING_REVIEW' });
      for (const id of [
        suspended.providerId,
        banned.providerId,
        pending.providerId,
        '0199a000-0000-7000-8000-000000000000',
      ]) {
        const res = await ctx
          .http()
          .get(api(`/providers/${id}`))
          .expect(404);
        expect(res.body.code).toBe('PROVIDER_NOT_FOUND');
        await ctx
          .http()
          .get(api(`/providers/${id}/reviews`))
          .expect(404);
        await ctx
          .http()
          .get(api(`/providers/${id}/review-distribution`))
          .expect(404);
      }
    });

    it('does not mark an unverified provider as verified', async () => {
      const p = await provider({ verification: 'SUBMITTED' });
      expect((await publicProfile(p.providerId)).isVerified).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('reviews: sort, filter, distribution and reply', () => {
    let reviewed: ProviderActor;
    const reviewIds: Record<number, string> = {};
    const customers: Record<number, Customer> = {};

    beforeAll(async () => {
      reviewed = await provider({ districtIds: [m.seyhan] });
      for (const rating of [5, 3, 4]) {
        const job = await completedJob(ctx, m, await agreedJob(ctx, m, { provider: reviewed }));
        const res = await postReview(ctx, job.customer, job.jobId, {
          rating,
          comment: `${rating} yıldızlık iş.`,
        }).expect(201);
        reviewIds[rating] = res.body.id as string;
        customers[rating] = job.customer;
      }
    });

    const list = async (query: Record<string, string | number>) =>
      paginatedSchema(publicReviewSchema).parse(
        (
          await ctx
            .http()
            .get(api(`/providers/${reviewed.providerId}/reviews`))
            .query(query)
            .expect(200)
        ).body,
      );

    it('sorts and filters by rating', async () => {
      expect((await list({ sort: 'HIGHEST' })).items.map((r) => r.rating)).toEqual([5, 4, 3]);
      expect((await list({ sort: 'LOWEST' })).items.map((r) => r.rating)).toEqual([3, 4, 5]);
      expect((await list({})).items.map((r) => r.rating)).toEqual([4, 3, 5]);
      expect((await list({ rating: 4 })).items.map((r) => r.id)).toEqual([reviewIds[4]]);
      expect((await list({ rating: 1 })).items).toEqual([]);
      await ctx
        .http()
        .get(api(`/providers/${reviewed.providerId}/reviews`))
        .query({ rating: 6 })
        .expect(400);
    });

    it('pages with a stable cursor for every sort', async () => {
      for (const [sort, expected] of [
        ['HIGHEST', [5, 4, 3]],
        ['LOWEST', [3, 4, 5]],
        ['NEWEST', [4, 3, 5]],
      ] as const) {
        const seen: number[] = [];
        let cursor: string | null = null;
        do {
          const page = await list({ sort, limit: 1, ...(cursor ? { cursor } : {}) });
          seen.push(...page.items.map((r) => r.rating));
          cursor = page.nextCursor;
        } while (cursor);
        expect(seen).toEqual(expected);
      }
    });

    it('counts published reviews per star; hidden ones never count', async () => {
      const dist = await ctx
        .http()
        .get(api(`/providers/${reviewed.providerId}/review-distribution`))
        .expect(200);
      expect(dist.body).toEqual({ five: 1, four: 1, three: 1, two: 0, one: 0 });
      const profile = await publicProfile(reviewed.providerId);
      expect(profile.reviewDistribution).toEqual(dist.body);
      expect(profile.rating).toEqual({ average: 4, count: 3 });
      expect(profile.completedJobCount).toBe(3);
      expect(profile.recentReviews).toHaveLength(3);
    });

    it('lets the reviewed provider reply once, publicly and in plain text', async () => {
      const reviewId = reviewIds[3] ?? '';
      const reply = (actor: Actor, body: string) =>
        ctx
          .http()
          .post(api(`/reviews/${reviewId}/reply`))
          .set('Authorization', bearer(actor))
          .send({ body });

      const other = await provider();
      const foreign = await reply(other, 'Ben cevap vereyim.').expect(404);
      expect(foreign.body.code).toBe('REVIEW_NOT_FOUND');
      await reply(customers[3] as Customer, 'Müşteri cevabı').expect(403);
      await reply(reviewed, '<b>Teşekkürler</b>').expect(400);
      await reply(reviewed, 'x'.repeat(1001)).expect(400);

      const ok = await reply(reviewed, 'Geri bildiriminiz için teşekkürler.').expect(201);
      expect(ok.body).toMatchObject({ body: 'Geri bildiriminiz için teşekkürler.' });
      const again = await reply(reviewed, 'İkinci cevap.').expect(409);
      expect(again.body.code).toBe('REVIEW_REPLY_EXISTS');

      const page = await list({ rating: 3 });
      expect(page.items[0]?.reply).toMatchObject({ body: 'Geri bildiriminiz için teşekkürler.' });
      const profile = await publicProfile(reviewed.providerId);
      expect(profile.recentReviews.find((r) => r.id === reviewId)?.reply).not.toBeNull();

      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'review.replied', entityId: reviewId },
      });
      expect(audit?.actorId).toBe(reviewed.userId);
      const notification = await ctx.prisma.notification.findFirst({
        where: { userId: customers[3]?.userId, type: 'review.replied' },
      });
      expect(notification).toMatchObject({ entityType: 'JOB' });
    });

    it('refuses a reply to a hidden review and hides it from the counts', async () => {
      const reviewId = reviewIds[5] ?? '';
      await ctx.prisma.review.update({
        where: { id: reviewId },
        data: { status: 'HIDDEN', moderatedAt: new Date() },
      });
      const res = await ctx
        .http()
        .post(api(`/reviews/${reviewId}/reply`))
        .set('Authorization', bearer(reviewed))
        .send({ body: 'Gizli yoruma cevap.' })
        .expect(409);
      expect(res.body.code).toBe('REVIEW_NOT_REPLYABLE');
      const dist = await ctx
        .http()
        .get(api(`/providers/${reviewed.providerId}/review-distribution`))
        .expect(200);
      expect(dist.body).toEqual({ five: 0, four: 1, three: 1, two: 0, one: 0 });
      expect((await list({})).items.map((r) => r.id)).not.toContain(reviewId);
    });
  });

  // -------------------------------------------------------------------------
  describe('admin category content and the request form', () => {
    const adminReq = (method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      ctx.http()[method](api(path)).set('Authorization', bearer(admin));

    it('refuses customers and providers (403) and anonymous callers (401)', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const p = await provider();
      for (const actor of [customer, p]) {
        const as = bearer(actor);
        await ctx
          .http()
          .get(api(`/admin/categories/${m.elektrikId}/questions`))
          .set('Authorization', as)
          .expect(403);
        await ctx
          .http()
          .post(api(`/admin/categories/${m.elektrikId}/questions`))
          .set('Authorization', as)
          .send({ key: 'x_key', label: 'Soru?', type: 'BOOLEAN' })
          .expect(403);
        await ctx
          .http()
          .post(api(`/admin/categories/${m.elektrikId}/aliases`))
          .set('Authorization', as)
          .send({ alias: 'hacker' })
          .expect(403);
        await ctx
          .http()
          .patch(api(`/categories/${m.elektrikId}`))
          .set('Authorization', as)
          .send({ requestPhotoPolicy: 'REQUIRED' })
          .expect(403);
      }
      await ctx
        .http()
        .get(api(`/admin/categories/${m.elektrikId}/aliases`))
        .expect(401);
    });

    it('manages questions without hard delete, validates types and audits', async () => {
      const path = `/admin/categories/${m.elektrikId}/questions`;
      const problem = await adminReq('post', path)
        .send({
          key: 'problem',
          label: 'Sorun ne?',
          type: 'SINGLE_SELECT',
          required: true,
          sortOrder: 10,
          options: [
            { value: 'power_out', label: 'Tamamen elektrik yok' },
            { value: 'breaker_trips', label: 'Sigorta atıyor' },
          ],
        })
        .expect(201);
      const q = categoryQuestionSchema.parse(problem.body);
      expect(q).toMatchObject({ key: 'problem', required: true, isActive: true });
      await adminReq('post', path)
        .send({ key: 'urgent', label: 'Acil mi?', type: 'BOOLEAN', sortOrder: 0 })
        .expect(201);
      const count = await adminReq('post', path)
        .send({
          key: 'count',
          label: 'Kaç priz?',
          type: 'NUMBER',
          minValue: 1,
          maxValue: 30,
          sortOrder: 20,
        })
        .expect(201);

      // Validation: options, ranges, keys, duplicates.
      await adminReq('post', path)
        .send({ key: 'noopts', label: 'Seçim?', type: 'SINGLE_SELECT' })
        .expect(400);
      await adminReq('post', path)
        .send({
          key: 'oneopt',
          label: 'Seçim?',
          type: 'MULTI_SELECT',
          options: [{ value: 'a', label: 'A' }],
        })
        .expect(400);
      await adminReq('post', path)
        .send({ key: 'range', label: 'Aralık?', type: 'NUMBER', minValue: 5, maxValue: 1 })
        .expect(400);
      const rangeOnBool = await adminReq('post', path)
        .send({ key: 'boolrange', label: 'Evet mi?', type: 'BOOLEAN', minValue: 1 })
        .expect(422);
      expect(rangeOnBool.body.code).toBe('INVALID_QUESTION');
      for (const key of ['Bad-Key', '1abc', 'a'.repeat(41)]) {
        await adminReq('post', path).send({ key, label: 'Soru?', type: 'BOOLEAN' }).expect(400);
      }
      const dup = await adminReq('post', path)
        .send({ key: 'problem', label: 'Tekrar?', type: 'BOOLEAN' })
        .expect(409);
      expect(dup.body.code).toBe('QUESTION_KEY_TAKEN');

      // Edits: label, options; options on a non-select type are refused.
      const edited = await adminReq('patch', `/admin/category-questions/${q.id}`)
        .send({
          label: 'Sorun nedir?',
          options: [
            { value: 'power_out', label: 'Elektrik tamamen yok' },
            { value: 'breaker_trips', label: 'Sigorta atıyor' },
            { value: 'other', label: 'Diğer' },
          ],
        })
        .expect(200);
      expect(edited.body.options).toHaveLength(3);
      const countId = count.body.id as string;
      await adminReq('patch', `/admin/category-questions/${countId}`)
        .send({
          options: [
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ],
        })
        .expect(422);
      await adminReq('patch', `/admin/category-questions/${countId}`)
        .send({ minValue: 50 })
        .expect(422);
      // "Delete" = deactivate.
      await adminReq('patch', `/admin/category-questions/${countId}`)
        .send({ isActive: false })
        .expect(200);
      await adminReq('patch', '/admin/category-questions/0199a000-0000-7000-8000-000000000000')
        .send({ label: 'Yok' })
        .expect(404);

      const all = await adminReq('get', path).expect(200);
      expect(
        (all.body as { key: string; isActive: boolean }[]).map((x) => [x.key, x.isActive]),
      ).toEqual([
        ['urgent', true],
        ['problem', true],
        ['count', false],
      ]);

      // The public form shows only active questions, in order.
      const form = requestFormSchema.parse(
        (
          await ctx
            .http()
            .get(api(`/categories/${m.elektrikId}/request-form`))
            .expect(200)
        ).body,
      );
      expect(form.questions.map((x) => x.key)).toEqual(['urgent', 'problem']);
      expect(form).toMatchObject({
        category: { id: m.elektrikId },
        photoPolicy: 'OPTIONAL',
        maxPhotos: 5,
        supportsNow: true,
      });
      expect(form.maxPhotoBytes).toBeGreaterThan(0);

      const audit = await ctx.prisma.auditLog.findMany({
        where: { actorId: admin.user.id, entityType: 'category_question' },
        select: { action: true },
      });
      expect(audit.filter((a) => a.action === 'category.question_created')).toHaveLength(3);
      expect(audit.filter((a) => a.action === 'category.question_updated')).toHaveLength(2);
    });

    it('sets the photo policy through PATCH /categories/:id', async () => {
      const res = await adminReq('patch', `/categories/${m.boyaId}`)
        .send({ requestPhotoPolicy: 'REQUIRED' })
        .expect(200);
      expect(res.body.requestPhotoPolicy).toBe('REQUIRED');
      await adminReq('patch', `/categories/${m.boyaId}`)
        .send({ requestPhotoPolicy: 'ALWAYS' })
        .expect(400);
      const form = await ctx
        .http()
        .get(api(`/categories/${m.boyaId}/request-form`))
        .expect(200);
      expect(form.body).toMatchObject({
        photoPolicy: 'REQUIRED',
        supportsNow: false,
        questions: [],
      });
    });

    it('is a 404 for an inactive or unknown category', async () => {
      const closed = await ctx.prisma.serviceCategory.create({
        data: { slug: `e2e-${RUN_ID}-closed`, name: `Kapalı ${RUN_ID}`, isActive: false },
      });
      await ctx
        .http()
        .get(api(`/categories/${closed.id}/request-form`))
        .expect(404);
      await ctx
        .http()
        .get(api(`/categories/${closed.id}/price-guide`))
        .expect(404);
      await adminReq(
        'get',
        '/admin/categories/0199a000-0000-7000-8000-000000000000/questions',
      ).expect(404);
    });

    it('manages aliases: normalised, unique, never another category name', async () => {
      const path = `/admin/categories/${m.elektrikId}/aliases`;
      const alias = `elektrikçi ${RUN_ID}`;
      const created = await adminReq('post', path).send({ alias }).expect(201);
      expect(created.body).toEqual({ id: expect.any(String), alias });
      const row = await ctx.prisma.categoryAlias.findUniqueOrThrow({
        where: { id: created.body.id as string },
      });
      expect(row.normalized).toBe(`elektrikci ${RUN_ID}`);

      // Same normalised text, other spelling, even on another category.
      const taken = await adminReq('post', `/admin/categories/${m.klimaId}/aliases`)
        .send({ alias: `  ELEKTRİKÇİ   ${RUN_ID.toUpperCase()} ` })
        .expect(409);
      expect(taken.body.code).toBe('ALIAS_TAKEN');
      const klima = await ctx.prisma.serviceCategory.findUniqueOrThrow({
        where: { id: m.klimaId },
      });
      const named = await adminReq('post', path).send({ alias: klima.name }).expect(409);
      expect(named.body.code).toBe('ALIAS_MATCHES_CATEGORY_NAME');
      await adminReq('post', path).send({ alias: '!!' }).expect(422);

      const list = await adminReq('get', path).expect(200);
      expect(list.body).toEqual([{ id: created.body.id, alias }]);

      await adminReq('delete', `/admin/category-aliases/${created.body.id}`).expect(204);
      await adminReq('delete', `/admin/category-aliases/${created.body.id}`).expect(404);
      expect((await adminReq('get', path).expect(200)).body).toEqual([]);

      const audit = await ctx.prisma.auditLog.findMany({
        where: { entityId: created.body.id as string },
        select: { action: true, actorId: true },
      });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'category.alias_created',
        'category.alias_deleted',
      ]);
      expect(audit.every((a) => a.actorId === admin.user.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('price guide', () => {
    async function seedCompletedJobs(
      categoryId: string,
      amounts: { amountMinor: number; provider: ProviderActor; daysAgo?: number }[],
    ) {
      const customer = await customerIn(ctx, m.seyhan);
      const profile = await ctx.prisma.customerProfile.findUniqueOrThrow({
        where: { userId: customer.userId },
      });
      for (const [i, a] of amounts.entries()) {
        const done = new Date(Date.now() - (a.daysAgo ?? 1) * 86_400_000);
        const at = (minutes: number) => new Date(done.getTime() - minutes * 60_000);
        const request = await ctx.prisma.serviceRequest.create({
          data: {
            customerId: profile.id,
            categoryId,
            addressId: customer.addressId,
            provinceId: ADANA,
            districtId: m.seyhan,
            type: 'QUOTE',
            status: 'COMPLETED',
            title: `Fiyat rehberi işi ${i}`,
            description: 'Gerçek tamamlanmış iş kaydı (test).',
            publishedAt: at(600),
          },
        });
        await ctx.prisma.job.create({
          data: {
            serviceRequestId: request.id,
            customerId: profile.id,
            providerId: a.provider.providerId,
            categoryId,
            status: 'COMPLETED',
            agreedPriceMinor: BigInt(a.amountMinor),
            currentTotalMinor: BigInt(a.amountMinor),
            enRouteAt: at(300),
            arrivedAt: at(240),
            startedAt: at(200),
            completionRequestedAt: at(10),
            completedAt: done,
          },
        });
      }
    }

    it('says INSUFFICIENT_DATA until enough jobs from enough providers exist', async () => {
      const guide = async (query: Record<string, number> = {}) =>
        priceGuideSchema.parse(
          (
            await ctx
              .http()
              .get(api(`/categories/${m.boyaId}/price-guide`))
              .query(query)
              .expect(200)
          ).body,
        );
      expect(await guide()).toEqual({
        status: 'INSUFFICIENT_DATA',
        scope: 'COUNTRY',
        minSample: 10,
      });
      // 12 jobs, but all from one provider: still not enough.
      const solo = await provider({ categoryIds: [m.boyaId] });
      await seedCompletedJobs(
        m.boyaId,
        Array.from({ length: 12 }, () => ({ amountMinor: 150_000, provider: solo })),
      );
      expect(await guide({ provinceId: ADANA })).toMatchObject({ status: 'INSUFFICIENT_DATA' });
    });

    it('computes p25/median/p75 from real completed jobs, without outliers', async () => {
      const category = await ctx.prisma.serviceCategory.create({
        data: { slug: `e2e-${RUN_ID}-fiyat`, name: `Fiyat ${RUN_ID}` },
      });
      const ps = [await provider(), await provider(), await provider()];
      await seedCompletedJobs(category.id, [
        // 1000, 1100, ..., 2100 TL from three providers.
        ...Array.from({ length: 12 }, (_, i) => ({
          amountMinor: 100_000 + i * 10_000,
          provider: ps[i % 3] as ProviderActor,
        })),
        // An absurd total: dropped by the IQR fences.
        { amountMinor: 50_000_000, provider: ps[0] as ProviderActor },
        // Older than 180 days: outside the period.
        ...Array.from({ length: 9 }, () => ({
          amountMinor: 150_000,
          provider: ps[1] as ProviderActor,
          daysAgo: 200,
        })),
      ]);
      const res = await ctx
        .http()
        .get(api(`/categories/${category.id}/price-guide`))
        .query({ provinceId: ADANA })
        .expect(200);
      expect(priceGuideSchema.parse(res.body)).toEqual({
        status: 'OK',
        scope: 'PROVINCE',
        p25: { amountMinor: 127_500, currency: 'TRY' },
        median: { amountMinor: 155_000, currency: 'TRY' },
        p75: { amountMinor: 182_500, currency: 'TRY' },
        sampleSizeFloor: 10,
        periodDays: 180,
      });
      // Nothing in Mersin: falls back to the whole country.
      const country = await ctx
        .http()
        .get(api(`/categories/${category.id}/price-guide`))
        .query({ provinceId: 33 })
        .expect(200);
      expect(country.body).toMatchObject({ status: 'OK', scope: 'COUNTRY' });
      await ctx
        .http()
        .get(api(`/categories/${category.id}/price-guide`))
        .query({ provinceId: 99 })
        .expect(400);
    });
  });
});
