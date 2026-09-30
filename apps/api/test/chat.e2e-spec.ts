import { randomUUID } from 'node:crypto';

import type { ChatMessage, ConversationDetail } from '@ustago/types';
import {
  badgeCountsSchema,
  chatMessageSchema,
  conversationDetailSchema,
  conversationListItemSchema,
  messagePageSchema,
  paginatedSchema,
  signedUrlSchema,
  uploadIntentResponseSchema,
} from '@ustago/validation';

import { ConversationsService } from '../src/conversations/conversations.service.js';
import {
  bearer,
  cleanup,
  createStaffUser,
  createTestApp,
  resetRateLimits,
  type TestContext,
} from './helpers.js';
import { notificationsOf } from './job-helpers.js';
import {
  accept,
  adanaMarket,
  createQuote,
  createRequest,
  type Customer,
  customerIn,
  type Market,
  type ProviderActor,
  providerIn,
} from './marketplace-helpers.js';
import { type Actor, asActor, FILES, pathOf } from './provider-helpers.js';

const RATE_PER_MINUTE = 8;

describe('Request/job-bound chat (e2e)', () => {
  let ctx: TestContext;
  let m: Market;

  beforeAll(async () => {
    ctx = await createTestApp({ CHAT_RATE_LIMIT_PER_MINUTE: String(RATE_PER_MINUTE) });
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const klimaProvider = (displayName = 'Test Klima Ustası') =>
    providerIn(ctx, { categoryIds: [m.klimaId], districtIds: [m.seyhan], displayName });

  interface Setup {
    customer: Customer;
    provider: ProviderActor;
    requestId: string;
    quoteId: string;
  }

  async function quoted(options: { provider?: ProviderActor; customer?: Customer } = {}) {
    const customer = options.customer ?? (await customerIn(ctx, m.seyhan));
    const provider = options.provider ?? (await klimaProvider());
    const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
    const quote = await createQuote(ctx, provider, request.id, 250000);
    return { customer, provider, requestId: request.id, quoteId: quote.id } satisfies Setup;
  }

  const openConv = (actor: Actor, body: Record<string, unknown>) =>
    ctx.http().post('/api/v1/conversations').set('Authorization', bearer(actor)).send(body);

  async function opened(s: Setup, by: Actor = s.customer): Promise<ConversationDetail> {
    const res = await openConv(by, { quoteId: s.quoteId }).expect(200);
    return conversationDetailSchema.parse(res.body);
  }

  const send = (actor: Actor, conversationId: string, body: Record<string, unknown>) =>
    ctx
      .http()
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(actor))
      .send(body);

  async function sendText(actor: Actor, conversationId: string, text: string) {
    const res = await send(actor, conversationId, {
      type: 'TEXT',
      clientMessageId: randomUUID(),
      body: text,
    }).expect(201);
    return chatMessageSchema.parse(res.body);
  }

  const get = (actor: Actor, path: string) =>
    ctx.http().get(`/api/v1${path}`).set('Authorization', bearer(actor));

  async function detail(actor: Actor, id: string) {
    return conversationDetailSchema.parse(
      (await get(actor, `/conversations/${id}`).expect(200)).body,
    );
  }

  async function messages(actor: Actor, id: string, query = '') {
    return messagePageSchema.parse(
      (await get(actor, `/conversations/${id}/messages${query}`).expect(200)).body,
    );
  }

  const markRead = (actor: Actor, id: string, messageId: string) =>
    ctx
      .http()
      .post(`/api/v1/conversations/${id}/read`)
      .set('Authorization', bearer(actor))
      .send({ messageId });

  async function badges(actor: Actor) {
    return badgeCountsSchema.parse((await get(actor, '/me/badges').expect(200)).body);
  }

  describe('opening', () => {
    it('opens only for the quote parties, idempotently, with privacy-safe names', async () => {
      const s = await quoted({ provider: await klimaProvider('Demir Klima') });
      await ctx.prisma.user.update({
        where: { id: s.customer.userId },
        data: { firstName: 'Ayşe', lastName: 'Kaya' },
      });
      const otherProvider = await klimaProvider();
      const otherCustomer = await customerIn(ctx, m.seyhan);

      // Nobody else can open it, not even with the quote id.
      for (const outsider of [otherProvider, otherCustomer]) {
        const res = await openConv(outsider, { quoteId: s.quoteId });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('QUOTE_NOT_FOUND');
      }
      await openConv(s.customer, {}).expect(400);
      await openConv(s.customer, { quoteId: s.quoteId, jobId: randomUUID() }).expect(400);

      const byCustomer = await opened(s);
      expect(byCustomer.myRole).toBe('CUSTOMER');
      expect(byCustomer.counterpart).toEqual({
        role: 'PROVIDER',
        name: 'Demir Klima',
        providerId: s.provider.providerId,
      });
      expect(byCustomer.canSend).toBe(true);
      expect(byCustomer.cannotSendReason).toBeNull();
      expect(byCustomer.lastMessage).toBeNull();

      // The provider opening it gets the same conversation.
      const byProvider = await opened(s, s.provider);
      expect(byProvider.id).toBe(byCustomer.id);
      expect(byProvider.myRole).toBe('PROVIDER');
      expect(byProvider.counterpart).toEqual({
        role: 'CUSTOMER',
        name: 'Ayşe K.',
        providerId: null,
      });
      // No phone, e-mail or address anywhere in the response.
      const raw = JSON.stringify(byProvider);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: s.customer.userId } });
      expect(raw).not.toContain(user.phone ?? '§');
      expect(raw).not.toContain('Atatürk');
      expect(raw).not.toContain('Kaya');

      expect(
        await ctx.prisma.conversation.count({ where: { serviceRequestId: s.requestId } }),
      ).toBe(1);
      expect(
        await ctx.prisma.marketplaceEvent.count({
          where: { type: 'conversation_started', serviceRequestId: s.requestId },
        }),
      ).toBe(1);
    });

    it('opens concurrently to a single conversation', async () => {
      const s = await quoted();
      const results = await Promise.all([
        openConv(s.customer, { quoteId: s.quoteId }),
        openConv(s.provider, { quoteId: s.quoteId }),
        openConv(s.customer, { quoteId: s.quoteId }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    });

    it('opens from a job and links it; only the job parties may', async () => {
      const s = await quoted();
      const conv = await opened(s);
      expect(conv.jobId).toBeNull();
      const res = await accept(ctx, s.customer, s.quoteId, 1).expect(200);
      const jobId = res.body.jobId as string;

      // The job is linked to the existing conversation on next sight.
      expect((await detail(s.provider, conv.id)).jobId).toBe(jobId);
      const viaJob = conversationDetailSchema.parse(
        (await openConv(s.provider, { jobId }).expect(200)).body,
      );
      expect(viaJob.id).toBe(conv.id);
      expect(viaJob.canSend).toBe(true);

      const stranger = await klimaProvider();
      const denied = await openConv(stranger, { jobId });
      expect(denied.status).toBe(404);
      expect(denied.body.code).toBe('JOB_NOT_FOUND');
    });
  });

  describe('access', () => {
    it('hides the conversation from everyone but its two participants (IDOR)', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const msg = await sendText(s.customer, conv.id, 'Merhaba, yarın gelebilir misiniz?');
      const otherProvider = await klimaProvider();
      const otherCustomer = await customerIn(ctx, m.seyhan);
      const admin = asActor(await createStaffUser(ctx, ['ADMIN']));
      const superAdmin = asActor(await createStaffUser(ctx, ['SUPER_ADMIN']));

      for (const outsider of [otherProvider, otherCustomer, admin, superAdmin]) {
        const auth = bearer(outsider);
        const calls = [
          ctx.http().get(`/api/v1/conversations/${conv.id}`).set('Authorization', auth),
          ctx.http().get(`/api/v1/conversations/${conv.id}/messages`).set('Authorization', auth),
          ctx
            .http()
            .post(`/api/v1/conversations/${conv.id}/messages`)
            .set('Authorization', auth)
            .send({ type: 'TEXT', clientMessageId: randomUUID(), body: 'selam' }),
          ctx
            .http()
            .post(`/api/v1/conversations/${conv.id}/read`)
            .set('Authorization', auth)
            .send({ messageId: msg.id }),
          ctx.http().put(`/api/v1/conversations/${conv.id}/block`).set('Authorization', auth),
          ctx
            .http()
            .post(`/api/v1/conversations/${conv.id}/images/upload-intent`)
            .set('Authorization', auth)
            .send({ mimeType: 'image/png', sizeBytes: 100 }),
          ctx
            .http()
            .post(`/api/v1/messages/${msg.id}/report`)
            .set('Authorization', auth)
            .send({ reason: 'SPAM' }),
        ];
        for (const res of await Promise.all(calls)) {
          expect(res.status).toBe(404);
          expect(JSON.stringify(res.body)).not.toContain('yarın gelebilir');
        }
        const list = await get(outsider, '/conversations').expect(200);
        expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(conv.id);
      }
      // Nothing was written by the outsiders.
      expect(await ctx.prisma.message.count({ where: { conversationId: conv.id } })).toBe(1);
      expect(await ctx.prisma.userBlock.count({ where: { blockedId: s.customer.userId } })).toBe(0);
      await ctx.http().get(`/api/v1/conversations/${conv.id}`).expect(401);
    });
  });

  describe('messages', () => {
    it('sends text, flags contact info without censoring it, and pages by id', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const first = await sendText(s.customer, conv.id, '  Merhaba usta  ');
      expect(first).toMatchObject({
        type: 'TEXT',
        body: 'Merhaba usta',
        mine: true,
        senderRole: 'CUSTOMER',
        containsContactInfo: false,
        state: 'SENT',
        hasImage: false,
      });
      const contact = await sendText(
        s.provider,
        conv.id,
        'Beni 0532 123 45 67 numarasından arayın',
      );
      expect(contact.containsContactInfo).toBe(true);
      expect(contact.body).toBe('Beni 0532 123 45 67 numarasından arayın');
      const email = await sendText(s.provider, conv.id, 'ya da usta@example.com');
      expect(email.containsContactInfo).toBe(true);

      await send(s.customer, conv.id, {
        type: 'TEXT',
        clientMessageId: randomUUID(),
        body: '   ',
      }).expect(400);
      await send(s.customer, conv.id, {
        type: 'TEXT',
        clientMessageId: randomUUID(),
        body: 'x'.repeat(2001),
      }).expect(400);
      await send(s.customer, conv.id, {
        type: 'SYSTEM',
        clientMessageId: randomUUID(),
        body: 'hack',
      }).expect(400);

      const page = await messages(s.customer, conv.id);
      expect(page.items.map((i) => i.id)).toEqual([first.id, contact.id, email.id]);
      expect(page.hasMoreBefore).toBe(false);
      expect(page.items.map((i) => i.mine)).toEqual([true, false, false]);
      expect(page.items[1]?.senderRole).toBe('PROVIDER');

      const older = await messages(s.customer, conv.id, `?before=${email.id}&limit=1`);
      expect(older.items.map((i) => i.id)).toEqual([contact.id]);
      expect(older.hasMoreBefore).toBe(true);
      const newer = await messages(s.customer, conv.id, `?after=${first.id}`);
      expect(newer.items.map((i) => i.id)).toEqual([contact.id, email.id]);
      expect(newer.hasMoreBefore).toBe(true);
      expect((await messages(s.customer, conv.id, `?after=${email.id}`)).items).toEqual([]);

      // Chat never touches the price.
      const quote = await ctx.prisma.quote.findUniqueOrThrow({ where: { id: s.quoteId } });
      expect(quote.version).toBe(0);
      expect(
        await ctx.prisma.marketplaceEvent.count({
          where: { type: 'message_sent', serviceRequestId: s.requestId },
        }),
      ).toBe(3);
      const events = await ctx.prisma.marketplaceEvent.findMany({
        where: { type: 'message_sent', serviceRequestId: s.requestId },
      });
      expect(JSON.stringify(events)).not.toContain('Merhaba');
      expect(JSON.stringify(events)).not.toContain(s.customer.userId);
    });

    it('is idempotent on clientMessageId, sequentially and concurrently', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const clientMessageId = randomUUID();
      const body = { type: 'TEXT', clientMessageId, body: 'Tekrar denenen mesaj' };
      const a = await send(s.customer, conv.id, body).expect(201);
      const b = await send(s.customer, conv.id, body).expect(201);
      expect(b.body.id).toBe(a.body.id);

      const concurrentId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          send(s.provider, conv.id, {
            type: 'TEXT',
            clientMessageId: concurrentId,
            body: 'Aynı anda',
          }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(
        await ctx.prisma.message.count({
          where: {
            conversationId: conv.id,
            clientMessageId: { in: [clientMessageId, concurrentId] },
          },
        }),
      ).toBe(2);
      // The same client id from the other participant is a different message.
      const other = await send(s.provider, conv.id, body).expect(201);
      expect(other.body.id).not.toBe(a.body.id);
    });

    it('rate limits a sender with 429', async () => {
      const s = await quoted();
      const conv = await opened(s);
      for (let i = 0; i < RATE_PER_MINUTE; i += 1) {
        await sendText(s.customer, conv.id, `mesaj ${i}`);
      }
      const res = await send(s.customer, conv.id, {
        type: 'TEXT',
        clientMessageId: randomUUID(),
        body: 'bir tane daha',
      });
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      // The other side is not affected.
      await sendText(s.provider, conv.id, 'Ben yazabiliyorum');
    });
  });

  describe('images', () => {
    const uploadIntent = (actor: Actor, convId: string, mimeType = 'image/png', size = 72) =>
      ctx
        .http()
        .post(`/api/v1/conversations/${convId}/images/upload-intent`)
        .set('Authorization', bearer(actor))
        .send({ mimeType, sizeBytes: size, fileName: 'klima.png' });

    it('uploads, checks the bytes and serves the image only to participants', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const intent = uploadIntentResponseSchema.parse(
        (await uploadIntent(s.customer, conv.id).expect(201)).body,
      );
      await ctx
        .http()
        .put(pathOf(intent.uploadUrl))
        .set('Content-Type', 'image/png')
        .send(FILES.png)
        .expect(204);
      const clientMessageId = randomUUID();
      const res = await send(s.customer, conv.id, {
        type: 'IMAGE',
        clientMessageId,
        uploadId: intent.uploadId,
      }).expect(201);
      const image = chatMessageSchema.parse(res.body);
      expect(image).toMatchObject({ type: 'IMAGE', hasImage: true, body: null });
      // Retry with the same client id: same message, upload not reused.
      const retry = await send(s.customer, conv.id, {
        type: 'IMAGE',
        clientMessageId,
        uploadId: intent.uploadId,
      }).expect(201);
      expect(retry.body.id).toBe(image.id);
      // The consumed upload cannot be sent again as another message.
      const reuse = await send(s.customer, conv.id, {
        type: 'IMAGE',
        clientMessageId: randomUUID(),
        uploadId: intent.uploadId,
      });
      expect(reuse.status).toBe(404);
      expect(reuse.body.code).toBe('UPLOAD_NOT_FOUND');

      for (const participant of [s.customer, s.provider]) {
        signedUrlSchema.parse(
          (await get(participant, `/messages/${image.id}/image-url`).expect(200)).body,
        );
      }
      const outsider = await klimaProvider();
      const admin = asActor(await createStaffUser(ctx, ['ADMIN']));
      for (const who of [outsider, admin]) {
        const denied = await get(who, `/messages/${image.id}/image-url`);
        expect(denied.status).toBe(404);
        expect(denied.body.code).toBe('MESSAGE_NOT_FOUND');
      }
      // A text message has no image.
      const text = await sendText(s.customer, conv.id, 'metin');
      await get(s.customer, `/messages/${text.id}/image-url`).expect(404);

      // The upload belongs to this conversation only.
      const s2 = await quoted({ customer: s.customer });
      const conv2 = await opened(s2);
      const intent2 = uploadIntentResponseSchema.parse(
        (await uploadIntent(s.customer, conv.id).expect(201)).body,
      );
      await ctx
        .http()
        .put(pathOf(intent2.uploadUrl))
        .set('Content-Type', 'image/png')
        .send(FILES.png)
        .expect(204);
      const cross = await send(s.customer, conv2.id, {
        type: 'IMAGE',
        clientMessageId: randomUUID(),
        uploadId: intent2.uploadId,
      });
      expect(cross.status).toBe(404);
    });

    it('rejects non-image bytes, bad types and oversize declarations', async () => {
      const s = await quoted();
      const conv = await opened(s);
      await uploadIntent(s.customer, conv.id, 'image/svg+xml').expect(400);
      await uploadIntent(s.customer, conv.id, 'image/png', 50 * 1024 * 1024).expect(422);

      const intent = uploadIntentResponseSchema.parse(
        (await uploadIntent(s.customer, conv.id, 'image/png', FILES.html.length).expect(201)).body,
      );
      await ctx
        .http()
        .put(pathOf(intent.uploadUrl))
        .set('Content-Type', 'image/png')
        .send(FILES.html)
        .expect(204);
      const res = await send(s.customer, conv.id, {
        type: 'IMAGE',
        clientMessageId: randomUUID(),
        uploadId: intent.uploadId,
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_CHAT_IMAGE');

      // Another user's upload id is unknown.
      const own = uploadIntentResponseSchema.parse(
        (await uploadIntent(s.provider, conv.id).expect(201)).body,
      );
      const stolen = await send(s.customer, conv.id, {
        type: 'IMAGE',
        clientMessageId: randomUUID(),
        uploadId: own.uploadId,
      });
      expect(stolen.status).toBe(404);
      // Not yet uploaded.
      const notYet = await send(s.provider, conv.id, {
        type: 'IMAGE',
        clientMessageId: randomUUID(),
        uploadId: own.uploadId,
      });
      expect(notYet.status).toBe(422);
      expect(notYet.body.code).toBe('UPLOAD_NOT_COMPLETED');
      expect(await ctx.prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
    });
  });

  describe('read state and badges', () => {
    it('tracks read markers, unread counts, READ state and badges', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const before = await badges(s.provider);

      const m1 = await sendText(s.customer, conv.id, 'Bir');
      const m2 = await sendText(s.customer, conv.id, 'İki');
      const m3 = await sendText(s.customer, conv.id, 'Üç');
      expect((await detail(s.provider, conv.id)).unreadCount).toBe(3);
      expect((await detail(s.customer, conv.id)).unreadCount).toBe(0);
      const after = await badges(s.provider);
      expect(after.messages).toBe(before.messages + 3);
      // One coalesced notification for the three messages.
      expect(after.notifications).toBe(before.notifications + 1);

      const listed = paginatedSchema(conversationListItemSchema).parse(
        (await get(s.provider, '/conversations').expect(200)).body,
      );
      const row = listed.items.find((c) => c.id === conv.id);
      expect(row?.unreadCount).toBe(3);
      expect(row?.lastMessage).toMatchObject({ type: 'TEXT', preview: 'Üç', mine: false });

      await markRead(s.provider, conv.id, m2.id).expect(204);
      expect((await detail(s.provider, conv.id)).unreadCount).toBe(1);
      const seen = await messages(s.customer, conv.id);
      expect(seen.items.map((i) => i.state)).toEqual(['READ', 'READ', 'SENT']);
      const customerView = await detail(s.customer, conv.id);
      expect(customerView.counterpartLastReadAt).toBe(m2.createdAt);

      // The marker never moves back.
      await markRead(s.provider, conv.id, m1.id).expect(204);
      expect((await detail(s.provider, conv.id)).unreadCount).toBe(1);
      await markRead(s.provider, conv.id, m3.id).expect(204);
      expect((await detail(s.provider, conv.id)).unreadCount).toBe(0);
      const cleared = await badges(s.provider);
      expect(cleared.messages).toBe(before.messages);
      // Reading the conversation also reads its message notifications.
      expect(cleared.notifications).toBe(before.notifications);

      // A message from another conversation cannot be used as a marker.
      const s2 = await quoted({ customer: s.customer });
      const conv2 = await opened(s2);
      const foreign = await sendText(s.customer, conv2.id, 'Başka');
      const res = await markRead(s.provider, conv.id, foreign.id);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('MESSAGE_NOT_FOUND');
    });

    it('lists conversations newest activity first with a keyset cursor', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const a = await opened(await quoted({ customer }));
      const b = await opened(await quoted({ customer }));
      const c = await opened(await quoted({ customer }));
      await sendText(customer, a.id, 'en yeni');
      const page = (q: string) =>
        get(customer, `/conversations${q}`)
          .expect(200)
          .then((r) => paginatedSchema(conversationListItemSchema).parse(r.body));
      const first = await page('?limit=2');
      expect(first.items.map((i) => i.id)).toEqual([a.id, c.id]);
      expect(first.nextCursor).not.toBeNull();
      const second = await page(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`);
      expect(second.items.map((i) => i.id)).toEqual([b.id]);
      expect(second.nextCursor).toBeNull();
      await get(customer, '/conversations?cursor=bozuk').expect(400);
    });
  });

  describe('notifications', () => {
    it('notifies the other side without the body and coalesces a burst', async () => {
      const s = await quoted({ provider: await klimaProvider('Yıldız Klima') });
      const conv = await opened(s);
      await sendText(s.provider, conv.id, 'Gizli fiyat detayı 1234');
      await sendText(s.provider, conv.id, 'İkinci mesaj');
      const rows = (await notificationsOf(ctx, s.customer.userId)).filter(
        (n) => n.type === 'message.new',
      );
      expect(rows).toHaveLength(1);
      const n = rows[0];
      expect(n?.title).toBe('Yeni mesaj');
      expect(n?.body).toBe('Yıldız Klima: yeni bir mesaj gönderdi');
      expect(n?.deepLink).toBe(`/messages/${conv.id}`);
      expect(n?.entityId).toBe(conv.id);
      expect(n?.pushDelivery).not.toBeNull();
      expect(JSON.stringify(rows)).not.toContain('Gizli');
      // The sender gets nothing for their own messages.
      expect(
        (await notificationsOf(ctx, s.provider.userId)).filter((x) => x.type === 'message.new'),
      ).toHaveLength(0);

      // Once read, the next message notifies again.
      const last = (await messages(s.customer, conv.id)).items.at(-1);
      await markRead(s.customer, conv.id, last?.id ?? '').expect(204);
      await sendText(s.provider, conv.id, 'Üçüncü');
      expect(
        (await notificationsOf(ctx, s.customer.userId)).filter((x) => x.type === 'message.new'),
      ).toHaveLength(2);

      // With the message push switched off only the in-app row is written.
      await ctx.prisma.notificationPreference.upsert({
        where: { userId: s.provider.userId },
        create: { userId: s.provider.userId, newMessagePush: false },
        update: { newMessagePush: false },
      });
      const image = await sendText(s.customer, conv.id, 'Tamam');
      expect(image.type).toBe('TEXT');
      const forProvider = (await notificationsOf(ctx, s.provider.userId)).filter(
        (x) => x.type === 'message.new',
      );
      expect(forProvider).toHaveLength(1);
      expect(forProvider[0]?.body).toBe('Test M.: yeni bir mesaj gönderdi');
      expect(forProvider[0]?.pushDelivery).toBeNull();
    });
  });

  describe('block and closed conversations', () => {
    it('blocks and unblocks the counterpart', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const blocked = conversationDetailSchema.parse(
        (
          await ctx
            .http()
            .put(`/api/v1/conversations/${conv.id}/block`)
            .set('Authorization', bearer(s.customer))
            .expect(200)
        ).body,
      );
      expect(blocked).toMatchObject({
        canSend: false,
        cannotSendReason: 'BLOCKED',
        blockedByMe: true,
      });
      // Idempotent.
      await ctx
        .http()
        .put(`/api/v1/conversations/${conv.id}/block`)
        .set('Authorization', bearer(s.customer))
        .expect(200);
      const providerSide = await detail(s.provider, conv.id);
      expect(providerSide).toMatchObject({
        canSend: false,
        cannotSendReason: 'BLOCKED',
        blockedByMe: false,
      });
      for (const who of [s.customer, s.provider]) {
        const res = await send(who, conv.id, {
          type: 'TEXT',
          clientMessageId: randomUUID(),
          body: 'engelli',
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('CONVERSATION_BLOCKED');
      }
      // History stays readable.
      await messages(s.provider, conv.id);

      const unblocked = conversationDetailSchema.parse(
        (
          await ctx
            .http()
            .delete(`/api/v1/conversations/${conv.id}/block`)
            .set('Authorization', bearer(s.customer))
            .expect(200)
        ).body,
      );
      expect(unblocked).toMatchObject({
        canSend: true,
        cannotSendReason: null,
        blockedByMe: false,
      });
      await sendText(s.provider, conv.id, 'Tekrar merhaba');
    });

    it('closes after the request is cancelled, keeping history', async () => {
      const s = await quoted();
      const conv = await opened(s);
      await sendText(s.customer, conv.id, 'Vazgeçebilirim');
      await ctx
        .http()
        .post(`/api/v1/service-requests/${s.requestId}/cancel`)
        .set('Authorization', bearer(s.customer))
        .send({ reason: 'Başka çözüm buldum' })
        .expect(200);
      const view = await detail(s.provider, conv.id);
      expect(view).toMatchObject({ canSend: false, cannotSendReason: 'CLOSED' });
      const res = await send(s.provider, conv.id, {
        type: 'TEXT',
        clientMessageId: randomUUID(),
        body: 'hâlâ orada mısınız?',
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CONVERSATION_CLOSED');
      expect((await messages(s.provider, conv.id)).items).toHaveLength(1);
    });

    it('closes for the providers whose quote was not accepted', async () => {
      const customer = await customerIn(ctx, m.seyhan);
      const winner = await klimaProvider('Kazanan');
      const loser = await klimaProvider('Kaybeden');
      const request = await createRequest(ctx, customer, { categoryId: m.klimaId });
      const q1 = await createQuote(ctx, winner, request.id, 200000);
      const q2 = await createQuote(ctx, loser, request.id, 210000);
      const c1 = await opened({
        customer,
        provider: winner,
        requestId: request.id,
        quoteId: q1.id,
      });
      const c2 = await opened({ customer, provider: loser, requestId: request.id, quoteId: q2.id });
      await accept(ctx, customer, q1.id, 1).expect(200);
      expect(await detail(winner, c1.id)).toMatchObject({ canSend: true });
      expect(await detail(loser, c2.id)).toMatchObject({
        canSend: false,
        cannotSendReason: 'CLOSED',
      });
      expect(await detail(customer, c2.id)).toMatchObject({ canSend: false });
    });
  });

  describe('reports and support access', () => {
    it('reports once, lists without bodies and opens only with a reason (audited)', async () => {
      const s = await quoted();
      const conv = await opened(s);
      const own = await sendText(s.customer, conv.id, 'Benim mesajım');
      const bad = await sendText(s.provider, conv.id, 'Kaba ve uygunsuz bir mesaj');
      const report = (actor: Actor, id: string, body: Record<string, unknown>) =>
        ctx
          .http()
          .post(`/api/v1/messages/${id}/report`)
          .set('Authorization', bearer(actor))
          .send(body);

      const selfReport = await report(s.customer, own.id, { reason: 'SPAM' });
      expect(selfReport.status).toBe(422);
      await report(s.customer, bad.id, { reason: 'HARASSMENT', note: 'Hakaret içeriyor' }).expect(
        204,
      );
      await report(s.customer, bad.id, { reason: 'HARASSMENT' }).expect(204);
      expect(await ctx.prisma.messageReport.count({ where: { messageId: bad.id } })).toBe(1);

      const support = asActor(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_SUPPORT']));
      const financeOnly = asActor(await createStaffUser(ctx, ['ADMIN'], ['ADMIN_FINANCE']));
      await get(s.customer, '/admin/message-reports').expect(403);
      await get(financeOnly, '/admin/message-reports').expect(403);

      const list = await get(support, '/admin/message-reports?status=OPEN&limit=100').expect(200);
      const row = list.body.items.find((r: { messageId: string }) => r.messageId === bad.id);
      expect(row).toMatchObject({
        conversationId: conv.id,
        reason: 'HARASSMENT',
        status: 'OPEN',
        reporterRole: 'CUSTOMER',
      });
      expect(JSON.stringify(list.body)).not.toContain('Kaba ve uygunsuz');

      // The normal route still hides the conversation from support.
      await get(support, `/conversations/${conv.id}/messages`).expect(404);

      const access = (actor: Actor, body: Record<string, unknown>) =>
        ctx
          .http()
          .post(`/api/v1/admin/message-reports/${row.id}/access`)
          .set('Authorization', bearer(actor))
          .send(body);
      await access(support, {}).expect(400);
      await access(support, { reason: 'kısa' }).expect(400);
      await access(financeOnly, { reason: 'Şikayet incelemesi için gerekli' }).expect(403);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'message_report.conversation_accessed', entityId: row.id },
        }),
      ).toBe(0);

      const opened_ = await access(support, { reason: 'Taciz şikayeti incelemesi' }).expect(200);
      expect(opened_.body.report.id).toBe(row.id);
      expect(opened_.body.messages.map((x: ChatMessage) => x.body)).toEqual([
        'Benim mesajım',
        'Kaba ve uygunsuz bir mesaj',
      ]);
      expect(opened_.body.messages[1].senderName).toBe('Test Klima Ustası');
      const audit = await ctx.prisma.auditLog.findFirst({
        where: { action: 'message_report.conversation_accessed', entityId: row.id },
      });
      expect(audit?.actorId).toBe(support.userId);
      expect(audit?.metadata).toMatchObject({
        conversationId: conv.id,
        reason: 'Taciz şikayeti incelemesi',
      });

      const resolve = (body: Record<string, unknown>) =>
        ctx
          .http()
          .post(`/api/v1/admin/message-reports/${row.id}/resolve`)
          .set('Authorization', bearer(support))
          .send(body);
      const resolved = await resolve({ status: 'REVIEWED', note: 'Uyarı verildi' }).expect(200);
      expect(resolved.body).toMatchObject({ status: 'REVIEWED' });
      expect(resolved.body.reviewedAt).not.toBeNull();
      const again = await resolve({ status: 'DISMISSED', note: 'Tekrar' });
      expect(again.status).toBe(409);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'message_report.resolved', entityId: row.id },
        }),
      ).toBe(1);
    });
  });

  describe('system events', () => {
    it('writes a SYSTEM message once per event key and only into an existing conversation', async () => {
      const service = ctx.app.get(ConversationsService);
      const s = await quoted();
      const other = await quoted({ customer: s.customer });

      const post = (target: Setup, eventKey: string, body: string) =>
        ctx.prisma.$transaction((tx) =>
          service.postSystemEventIn(tx, {
            serviceRequestId: target.requestId,
            providerId: target.provider.providerId,
            eventKey,
            body,
          }),
        );

      // No conversation: nothing written, nothing created.
      expect(await post(other, `quote_created:${other.quoteId}`, 'Teklif geldi')).toBe(false);
      expect(
        await ctx.prisma.conversation.count({ where: { serviceRequestId: other.requestId } }),
      ).toBe(0);

      const conv = await opened(s);
      const beforeNotifications = (await notificationsOf(ctx, s.customer.userId)).length;
      const key = `quote_created:${s.quoteId}`;
      expect(await post(s, key, 'Teklif geldi: ₺2.500')).toBe(true);
      expect(await post(s, key, 'Teklif geldi: ₺2.500')).toBe(false);
      // Concurrent duplicates do not fail the caller's transaction.
      const results = await Promise.all([
        post(s, 'job_started:x', 'İş başladı'),
        post(s, 'job_started:x', 'İş başladı'),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);

      const page = await messages(s.customer, conv.id);
      expect(page.items.map((i) => [i.type, i.body, i.senderRole, i.mine])).toEqual([
        ['SYSTEM', 'Teklif geldi: ₺2.500', null, false],
        ['SYSTEM', 'İş başladı', null, false],
      ]);
      // Not counted as unread, no notification.
      expect((await detail(s.customer, conv.id)).unreadCount).toBe(0);
      expect((await notificationsOf(ctx, s.customer.userId)).length).toBe(beforeNotifications);
      // The list shows it as the last activity.
      expect((await detail(s.customer, conv.id)).lastMessage).toMatchObject({
        type: 'SYSTEM',
        preview: 'İş başladı',
      });
    });
  });
});
