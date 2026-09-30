import { randomUUID } from 'node:crypto';

import {
  appNotificationSchema,
  notificationPreferencesSchema,
  paginatedSchema,
} from '@ustago/validation';

import { API_ENV, type ApiEnv } from '../src/config/env.js';
import { ExpoPushProvider } from '../src/push/expo-push.provider.js';
import { PUSH_PROVIDER, type PushProvider } from '../src/push/push-provider.js';
import { PushWorkerService } from '../src/push/push-worker.service.js';
import { bearer, cleanup, createTestApp, resetRateLimits, type TestContext } from './helpers.js';
import { agreedJob, notificationsOf, stepOk } from './job-helpers.js';
import { adanaMarket, type Market } from './marketplace-helpers.js';
import type { Actor } from './provider-helpers.js';

type FetchCall = { url: string; body: unknown };

/** An Expo API stand-in: records calls and answers with the given tickets. */
function fakeExpo(answer: (messages: { to: string }[]) => unknown, status = 200) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = (url, init) => {
    const body = JSON.parse(String(init?.body)) as unknown;
    calls.push({ url: String(url), body });
    return Promise.resolve(
      new Response(JSON.stringify(answer(body as { to: string }[])), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };
  return { calls, provider: new ExpoPushProvider(undefined, fetchImpl) };
}

describe('Notifications and push outbox (e2e)', () => {
  let ctx: TestContext;
  let m: Market;
  let env: ApiEnv;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetRateLimits(ctx);
    m = await adanaMarket(ctx);
    env = ctx.app.get<ApiEnv>(API_ENV);
  });

  afterAll(async () => {
    await m.restore();
    await cleanup(ctx);
    await ctx.app.close();
  });

  const worker = (provider: PushProvider) => new PushWorkerService(ctx.prisma, provider, env);

  const registerDevice = async (actor: Actor) => {
    const pushToken = `ExponentPushToken[${randomUUID()}]`;
    const res = await ctx
      .http()
      .post('/api/v1/me/devices')
      .set('Authorization', bearer(actor))
      .send({ platform: 'ANDROID', pushProvider: 'EXPO', pushToken })
      .expect(201);
    return { id: res.body.id as string, pushToken };
  };

  /** Keeps a test's worker run to its own rows. */
  const onlyMine = async (userIds: string[]) => {
    await ctx.prisma.pushDelivery.updateMany({
      where: { status: 'PENDING', notification: { userId: { notIn: userIds } } },
      data: { nextAttemptAt: new Date(Date.now() + 3600_000) },
    });
  };

  it('writes the in-app row and a push outbox row in the business transaction', async () => {
    const job = await agreedJob(ctx, m);
    await stepOk(ctx, job.provider, job.jobId, 'en-route');
    const [note] = (await notificationsOf(ctx, job.customer.userId)).filter(
      (n) => n.type === 'job.en_route',
    );
    expect(note).toMatchObject({ title: 'Ustanız yola çıktı.', channel: 'IN_APP', readAt: null });
    expect(note?.data).toMatchObject({ jobId: job.jobId });
    expect(note?.pushDelivery).toMatchObject({ status: 'PENDING', attemptCount: 0 });
  });

  it('pages the list, counts unread and marks read', async () => {
    const job = await agreedJob(ctx, m);
    await stepOk(ctx, job.provider, job.jobId, 'en-route');
    await stepOk(ctx, job.provider, job.jobId, 'arrive');
    await stepOk(ctx, job.provider, job.jobId, 'start');
    const auth = bearer(job.customer);
    const count = await ctx
      .http()
      .get('/api/v1/me/notifications/unread-count')
      .set('Authorization', auth)
      .expect(200);
    expect(count.body.unread).toBeGreaterThanOrEqual(3);

    const page1 = paginatedSchema(appNotificationSchema).parse(
      (
        await ctx
          .http()
          .get('/api/v1/me/notifications?limit=2')
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]?.title).toBe('Ustanız işe başladı.');
    expect(page1.nextCursor).not.toBeNull();
    const page2 = paginatedSchema(appNotificationSchema).parse(
      (
        await ctx
          .http()
          .get(`/api/v1/me/notifications?limit=2&cursor=${page1.nextCursor ?? ''}`)
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(page2.items.map((n) => n.id)).not.toContain(page1.items[0]?.id);

    await ctx
      .http()
      .post('/api/v1/me/notifications/read')
      .set('Authorization', auth)
      .send({ ids: [page1.items[0]?.id] })
      .expect(200);
    const after = await ctx
      .http()
      .get('/api/v1/me/notifications/unread-count')
      .set('Authorization', auth)
      .expect(200);
    expect(after.body.unread).toBe(count.body.unread - 1);
    await ctx
      .http()
      .post('/api/v1/me/notifications/read')
      .set('Authorization', auth)
      .send({})
      .expect(200);
    const none = await ctx
      .http()
      .get('/api/v1/me/notifications/unread-count')
      .set('Authorization', auth)
      .expect(200);
    expect(none.body.unread).toBe(0);
    // Someone else cannot mark my notifications.
    const mine = await ctx.prisma.notification.findFirstOrThrow({
      where: { userId: job.provider.userId },
    });
    const res = await ctx
      .http()
      .post('/api/v1/me/notifications/read')
      .set('Authorization', auth)
      .send({ ids: [mine.id] })
      .expect(200);
    expect(res.body.updated).toBe(0);
  });

  it('respects the quote push preference; job pushes cannot be turned off', async () => {
    const job = await agreedJob(ctx, m);
    const auth = bearer(job.customer);
    const prefs = notificationPreferencesSchema.parse(
      (
        await ctx
          .http()
          .get('/api/v1/me/notification-preferences')
          .set('Authorization', auth)
          .expect(200)
      ).body,
    );
    expect(prefs).toEqual({ jobUpdatesPush: true, quoteUpdatesPush: true, marketingPush: false });
    await ctx
      .http()
      .patch('/api/v1/me/notification-preferences')
      .set('Authorization', auth)
      .send({ jobUpdatesPush: false })
      .expect(400);
    const updated = await ctx
      .http()
      .patch('/api/v1/me/notification-preferences')
      .set('Authorization', auth)
      .send({ quoteUpdatesPush: false })
      .expect(200);
    expect(updated.body.quoteUpdatesPush).toBe(false);
    await stepOk(ctx, job.provider, job.jobId, 'en-route');
    const note = (await notificationsOf(ctx, job.customer.userId)).find(
      (n) => n.type === 'job.en_route',
    );
    expect(note?.pushDelivery?.status).toBe('PENDING');
  });

  it('console provider logs and records DEV_LOGGED, never SENT; no device → SKIPPED', async () => {
    const job = await agreedJob(ctx, m);
    await registerDevice(job.customer);
    await stepOk(ctx, job.provider, job.jobId, 'en-route');
    await onlyMine([job.customer.userId, job.provider.userId]);
    const consoleWorker = ctx.app.get(PushWorkerService);
    expect(ctx.app.get<PushProvider>(PUSH_PROVIDER).name).toBe('console');
    const result = await consoleWorker.runOnce();
    expect(result.sent).toBe(0);
    const notes = await notificationsOf(ctx, job.customer.userId);
    const enRoute = notes.find((n) => n.type === 'job.en_route');
    expect(enRoute?.pushDelivery?.status).toBe('DEV_LOGGED');
    // The provider has no device: their quote notifications are skipped.
    const providerNotes = await notificationsOf(ctx, job.provider.userId);
    expect(providerNotes.every((n) => n.pushDelivery?.status !== 'SENT')).toBe(true);
    expect(providerNotes.some((n) => n.pushDelivery?.status === 'SKIPPED')).toBe(true);
    // The in-app row is untouched by push.
    expect(enRoute?.readAt).toBeNull();
  });

  it('Expo provider: SENT with a ticket; DeviceNotRegistered clears the token', async () => {
    const job = await agreedJob(ctx, m);
    const good = await registerDevice(job.customer);
    const dead = await registerDevice(job.customer);
    await stepOk(ctx, job.provider, job.jobId, 'en-route');
    await onlyMine([job.customer.userId]);
    await ctx.prisma.pushDelivery.updateMany({
      where: { notification: { userId: job.provider.userId }, status: 'PENDING' },
      data: { nextAttemptAt: new Date(Date.now() + 3600_000) },
    });
    const expo = fakeExpo((messages) => ({
      data: messages.map((msg) =>
        msg.to === dead.pushToken
          ? {
              status: 'error',
              message: 'not registered',
              details: { error: 'DeviceNotRegistered' },
            }
          : { status: 'ok', id: randomUUID() },
      ),
    }));
    const result = await worker(expo.provider).runOnce();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const sent = expo.calls.flatMap(
      (c) => c.body as { to: string; title: string; data: Record<string, string> }[],
    );
    const msg = sent.find((b) => b.to === good.pushToken && b.title === 'Ustanız yola çıktı.');
    expect(msg).toMatchObject({ title: 'Ustanız yola çıktı.' });
    expect(msg?.data).toMatchObject({ jobId: job.jobId });

    const enRoute = (await notificationsOf(ctx, job.customer.userId)).find(
      (n) => n.type === 'job.en_route',
    );
    expect(enRoute?.pushDelivery).toMatchObject({ status: 'SENT', attemptCount: 1 });
    // The first push to the dead token reports DeviceNotRegistered; the
    // token is cleared at once, so later pushes go to the good device only.
    const tickets = await ctx.prisma.pushTicket.findMany({
      where: { delivery: { notification: { userId: job.customer.userId } } },
      orderBy: { createdAt: 'asc' },
    });
    expect(tickets.filter((t) => t.deviceId === dead.id)).toEqual([
      expect.objectContaining({ status: 'ERROR', error: 'DeviceNotRegistered' }),
    ]);
    expect(tickets.filter((t) => t.deviceId === good.id).every((t) => t.status === 'OK')).toBe(
      true,
    );
    const deadRow = await ctx.prisma.device.findUniqueOrThrow({ where: { id: dead.id } });
    expect(deadRow.pushToken).toBeNull();
    expect(deadRow.pushTokenInvalidatedAt).not.toBeNull();
    const goodRow = await ctx.prisma.device.findUniqueOrThrow({ where: { id: good.id } });
    expect(goodRow.pushToken).toBe(good.pushToken);

    // Receipts later report the good device as unregistered too.
    const receipts = fakeExpo((body) => {
      const ids = (body as unknown as { ids: string[] }).ids;
      return {
        data: Object.fromEntries(
          ids.map((id) => [
            id,
            { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          ]),
        ),
      };
    });
    await ctx.prisma.pushTicket.updateMany({
      where: { deliveryId: enRoute?.pushDelivery?.id ?? '' },
      data: { createdAt: new Date(Date.now() - 3600_000) },
    });
    const checked = await worker(receipts.provider).checkReceipts();
    expect(checked).toBeGreaterThanOrEqual(1);
    const later = await ctx.prisma.device.findUniqueOrThrow({ where: { id: good.id } });
    expect(later.pushToken).toBeNull();
  });

  it('retries a temporary failure with backoff and stops at the attempt limit', async () => {
    const job = await agreedJob(ctx, m);
    await registerDevice(job.customer);
    await stepOk(ctx, job.provider, job.jobId, 'en-route');
    await onlyMine([job.customer.userId]);
    await ctx.prisma.pushDelivery.updateMany({
      where: { notification: { userId: job.provider.userId }, status: 'PENDING' },
      data: { nextAttemptAt: new Date(Date.now() + 3600_000) },
    });
    const down = fakeExpo(() => ({ errors: [{ code: 'INTERNAL' }] }), 503);
    const w = worker(down.provider);
    const t0 = new Date();
    const first = await w.runOnce(t0);
    expect(first.retried).toBeGreaterThanOrEqual(1);
    const note = (await notificationsOf(ctx, job.customer.userId)).find(
      (n) => n.type === 'job.en_route',
    );
    const d1 = note?.pushDelivery;
    expect(d1).toMatchObject({ status: 'PENDING', attemptCount: 1 });
    expect(d1?.nextAttemptAt.getTime()).toBe(t0.getTime() + 30_000);
    expect(d1?.lastError).toMatch(/503/);
    // Not due yet: nothing is claimed.
    expect((await w.runOnce(new Date(t0.getTime() + 10_000))).claimed).toBe(0);

    let at = t0.getTime();
    for (let i = 0; i < env.PUSH_MAX_ATTEMPTS + 2; i += 1) {
      at += 3600_000;
      await w.runOnce(new Date(at));
    }
    const final = await ctx.prisma.pushDelivery.findUniqueOrThrow({ where: { id: d1?.id ?? '' } });
    expect(final.status).toBe('FAILED');
    expect(final.attemptCount).toBe(env.PUSH_MAX_ATTEMPTS);
    // The in-app notification is still there.
    expect(await ctx.prisma.notification.count({ where: { id: note?.id ?? '' } })).toBe(1);
  });
});
