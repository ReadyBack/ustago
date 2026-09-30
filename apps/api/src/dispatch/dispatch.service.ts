import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';
import type { DispatchSummary } from '@ustago/types';
import { formatMoney } from '@ustago/validation';

import { MarketplaceEventsService } from '../analytics/marketplace-events.service.js';
import { conflict, notFound } from '../common/http/errors.js';
import { API_ENV } from '../config/env.js';
import type { DispatchNotifyMode, Prisma } from '../generated/prisma/client.js';
import { ProviderMatchingService } from '../matching/provider-matching.service.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import {
  type NotificationDraft,
  NotificationsService,
} from '../notifications/notifications.service.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { planWave, type WaveConfig } from './domain/wave-plan.js';

type Tx = Prisma.TransactionClient;

export type DispatchReason = 'PUBLISHED' | 'SCHEDULED' | 'EXPANDED';

/** NOW requests live an hour: their waves come every few minutes. */
const NOW_WAVE_INTERVAL_MINUTES = 5;
/** "Arama alanını genişlet" at most this often. */
const EXPAND_COOLDOWN_MS = 2 * 60_000;
const SWEEP_BATCH = 25;
const OPEN = ['PUBLISHED', 'MATCHING', 'QUOTED'] as const;

const dispatchRequestSelect = {
  id: true,
  type: true,
  status: true,
  expiresAt: true,
  categoryId: true,
  provinceId: true,
  districtId: true,
  budgetMinor: true,
  budgetMaxMinor: true,
  preferredProviderId: true,
  preferredOnly: true,
  dispatchWave: true,
  customer: { select: { userId: true } },
  category: { select: { name: true } },
  district: { select: { name: true } },
} satisfies Prisma.ServiceRequestSelect;

/**
 * Wave dispatch (docs/adr/0028): who is told about a new request, when,
 * and how. Every provider gets at most one RequestDispatch row per request
 * (unique), so no provider is notified twice. Runs inside the request's
 * row lock; the sweep takes that lock with SKIP LOCKED so several API
 * instances never dispatch the same wave twice.
 */
@Injectable()
export class DispatchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DispatchService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: ProviderMatchingService,
    private readonly notifications: NotificationsService,
    private readonly events: MarketplaceEventsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test' || this.env.DISPATCH_SWEEP_SECONDS === 0) return;
    this.timer = setInterval(() => void this.tick(), this.env.DISPATCH_SWEEP_SECONDS * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const waves = await this.sweep();
      const alerts = await this.alertNoOffer();
      if (waves + alerts > 0) {
        this.logger.log(`Dispatch sweep: ${waves} wave(s), ${alerts} no-offer alert(s)`);
      }
      metrics.workerRuns.inc({ worker: 'dispatch_sweep', outcome: 'ok' });
    } catch (error) {
      metrics.workerRuns.inc({ worker: 'dispatch_sweep', outcome: 'error' });
      this.logger.error('Dispatch sweep failed', error instanceof Error ? error.stack : String(error));
    }
  }

  waveConfig(type: 'QUOTE' | 'NOW'): WaveConfig {
    if (type === 'NOW') {
      return {
        sizes: this.env.DISPATCH_WAVE_RADII_KM.map(() => this.env.NOW_DISPATCH_WAVE_SIZE),
        radiiKm: this.env.DISPATCH_WAVE_RADII_KM,
      };
    }
    return { sizes: this.env.DISPATCH_WAVE_SIZES, radiiKm: this.env.DISPATCH_WAVE_RADII_KM };
  }

  private intervalMs(type: 'QUOTE' | 'NOW'): number {
    const minutes =
      type === 'NOW'
        ? Math.min(NOW_WAVE_INTERVAL_MINUTES, this.env.DISPATCH_WAVE_INTERVAL_MINUTES)
        : this.env.DISPATCH_WAVE_INTERVAL_MINUTES;
    return minutes * 60_000;
  }

  /**
   * Sends the next wave for a request the caller has locked. Returns how
   * many providers were reached. With nobody to reach, a retry is
   * scheduled (a provider may join or become available; waitlist provinces
   * get their first wave once opened).
   */
  async dispatchIn(tx: Tx, requestId: string, reason: DispatchReason, now = new Date()): Promise<number> {
    const req = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: dispatchRequestSelect,
    });
    const open = (OPEN as readonly string[]).includes(req.status);
    if (!open || (req.expiresAt && req.expiresAt <= now)) {
      await tx.serviceRequest.update({ where: { id: req.id }, data: { nextDispatchAt: null } });
      return 0;
    }
    if (reason === 'SCHEDULED') {
      const quotes = await tx.quote.count({ where: { serviceRequestId: req.id } });
      if (quotes >= this.env.DISPATCH_TARGET_QUOTES) {
        await tx.serviceRequest.update({ where: { id: req.id }, data: { nextDispatchAt: null } });
        return 0;
      }
    }

    const wave = req.dispatchWave + 1;
    const config = this.waveConfig(req.type);
    const ranked = await this.matching.rank(req.id, { excludeDispatched: true, db: tx, now });
    const plan = planWave({
      wave,
      ranked,
      preferredProviderId: req.preferredProviderId,
      preferredOnly: req.preferredOnly,
      config,
    });
    const interval = this.intervalMs(req.type);

    if (plan.selected.length === 0) {
      await tx.serviceRequest.update({
        where: { id: req.id },
        data: {
          nextDispatchAt: req.preferredOnly ? null : new Date(now.getTime() + interval),
        },
      });
      return 0;
    }

    const modes = await this.notifyModes(
      tx,
      req.type,
      plan.selected.map((s) => s.userId),
    );
    await tx.requestDispatch.createMany({
      data: plan.selected.map((s) => ({
        serviceRequestId: req.id,
        providerId: s.providerId,
        wave,
        algorithmVersion: this.matching.algorithmVersion,
        matchScore: s.score,
        scoreBreakdown: s.breakdown as unknown as Prisma.InputJsonValue,
        distanceKm: s.distanceKm,
        isPreferred: s.isPreferred,
        notifyMode: modes.get(s.userId) ?? 'IN_APP',
        dispatchedAt: now,
      })),
      skipDuplicates: true,
    });

    if (req.type === 'NOW') {
      await tx.emergencyDispatchOffer.createMany({
        data: plan.selected.map((s) => ({
          serviceRequestId: req.id,
          providerId: s.providerId,
          expiresAt: req.expiresAt ?? new Date(now.getTime() + this.env.NOW_REQUEST_TTL_MINUTES * 60_000),
        })),
        skipDuplicates: true,
      });
    }

    const budget = budgetLabel(req.budgetMinor, req.budgetMaxMinor);
    const drafts: NotificationDraft[] = [];
    for (const s of plan.selected) {
      const mode = modes.get(s.userId) ?? 'IN_APP';
      if (mode === 'NONE') continue;
      const type = s.isPreferred
        ? NotificationEvent.REQUEST_PREFERRED
        : req.type === 'NOW'
          ? NotificationEvent.NOW_NEW_REQUEST
          : NotificationEvent.NEW_OPPORTUNITY;
      drafts.push({
        userId: s.userId,
        type,
        title: s.isPreferred
          ? 'Bir müşteri seni tercih etti'
          : req.type === 'NOW'
            ? 'Yakınında acil iş var'
            : 'Sana uygun yeni iş var',
        body: `${req.category.name} · ${req.district.name}${budget}`,
        data: { serviceRequestId: req.id },
        ...(mode === 'IN_APP' ? { push: false } : {}),
      });
    }
    await this.notifications.enqueueIn(tx, drafts);

    await tx.serviceRequest.update({
      where: { id: req.id },
      data: {
        dispatchWave: wave,
        lastDispatchedAt: now,
        nextDispatchAt: plan.hasMoreWaves ? new Date(now.getTime() + interval) : null,
      },
    });
    await this.events.recordIn(tx, {
      type: 'request_dispatched',
      serviceRequestId: req.id,
      categoryId: req.categoryId,
      provinceId: req.provinceId,
      districtId: req.districtId,
      value: plan.selected.length,
      metadata: { wave, reason },
    });
    for (const s of plan.selected) {
      metrics.dispatchedProviders.inc({
        wave: String(Math.min(wave, 9)),
        mode: (modes.get(s.userId) ?? 'IN_APP').toLowerCase(),
      });
    }
    return plan.selected.length;
  }

  /** PUSH for "açık", IN_APP for "sessiz", NONE for "kapalı". NOW always alerts. */
  private async notifyModes(
    tx: Tx,
    type: 'QUOTE' | 'NOW',
    userIds: string[],
  ): Promise<Map<string, DispatchNotifyMode>> {
    const prefs = await tx.notificationPreference.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, newJobAlerts: true },
    });
    const byUser = new Map(prefs.map((p) => [p.userId, p.newJobAlerts]));
    return new Map(
      userIds.map((id) => {
        if (type === 'NOW') return [id, 'PUSH'];
        const mode = byUser.get(id) ?? 'ON';
        return [id, mode === 'ON' ? 'PUSH' : mode === 'SILENT' ? 'IN_APP' : 'NONE'];
      }),
    );
  }

  /** Due waves across all requests; safe to run on several instances at once. */
  async sweep(now = new Date(), limit = SWEEP_BATCH): Promise<number> {
    const due = await this.prisma.serviceRequest.findMany({
      where: {
        status: { in: [...OPEN] },
        nextDispatchAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { nextDispatchAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let waves = 0;
    for (const { id } of due) {
      const sent = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM service_requests
          WHERE id = ${id}::uuid AND next_dispatch_at <= ${now}
          FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return -1;
        return this.dispatchIn(tx, id, 'SCHEDULED', now);
      });
      if (sent > 0) waves += 1;
    }
    return waves;
  }

  /**
   * "Henüz teklif gelmedi": once per request, after NO_OFFER_ALERT_MINUTES
   * without any quote, the customer is told and offered to widen the search.
   */
  async alertNoOffer(now = new Date(), limit = SWEEP_BATCH): Promise<number> {
    const threshold = new Date(now.getTime() - this.env.NO_OFFER_ALERT_MINUTES * 60_000);
    const due = await this.prisma.serviceRequest.findMany({
      where: {
        type: 'QUOTE',
        status: { in: [...OPEN] },
        publishedAt: { lte: threshold },
        noOfferAlertedAt: null,
        quotes: { none: {} },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      take: limit,
      select: dispatchRequestSelect,
    });
    let sent = 0;
    for (const req of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.serviceRequest.updateMany({
          where: { id: req.id, noOfferAlertedAt: null },
          data: { noOfferAlertedAt: now },
        });
        if (claimed.count === 0) return false;
        await this.notifications.enqueueIn(tx, [
          {
            userId: req.customer.userId,
            type: NotificationEvent.REQUEST_NO_OFFER,
            title: 'Henüz teklif gelmedi',
            body: `${req.category.name} talebin için arama alanını genişletebilir veya talebini düzenleyebilirsin.`,
            data: { serviceRequestId: req.id },
          },
        ]);
        await this.events.recordIn(tx, {
          type: 'request_no_offer',
          serviceRequestId: req.id,
          categoryId: req.categoryId,
          provinceId: req.provinceId,
          districtId: req.districtId,
          value: Math.round((now.getTime() - threshold.getTime()) / 60_000),
        });
        return true;
      });
      if (done) sent += 1;
    }
    return sent;
  }

  /**
   * "Arama alanını genişlet": the customer asks for the next wave now, and
   * may drop "sadece bu usta". Owner-only; others get the same 404.
   */
  async expand(
    userId: string,
    requestId: string,
    includeOtherProviders: boolean,
    now = new Date(),
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT sr.id FROM service_requests sr
        JOIN customer_profiles cp ON cp.id = sr.customer_id
        WHERE sr.id = ${requestId}::uuid AND cp.user_id = ${userId}::uuid
        FOR UPDATE OF sr`;
      if (rows.length === 0) throw notFound('SERVICE_REQUEST_NOT_FOUND', 'Talep bulunamadı.');
      const req = await tx.serviceRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          status: true,
          expiresAt: true,
          lastDispatchedAt: true,
          preferredOnly: true,
          categoryId: true,
          provinceId: true,
          districtId: true,
        },
      });
      if (!(OPEN as readonly string[]).includes(req.status) || (req.expiresAt && req.expiresAt <= now)) {
        throw conflict('INVALID_REQUEST_STATE', 'Bu talep artık açık değil.', { status: req.status });
      }
      if (
        req.lastDispatchedAt &&
        now.getTime() - req.lastDispatchedAt.getTime() < EXPAND_COOLDOWN_MS &&
        !(req.preferredOnly && includeOtherProviders)
      ) {
        throw conflict(
          'SEARCH_RECENTLY_EXPANDED',
          'Arama az önce genişletildi; yeni ustalara ulaşılması için biraz bekleyin.',
        );
      }
      if (req.preferredOnly && includeOtherProviders) {
        await tx.serviceRequest.update({ where: { id: requestId }, data: { preferredOnly: false } });
      }
      const sent = await this.dispatchIn(tx, requestId, 'EXPANDED', now);
      await this.events.recordIn(tx, {
        type: 'request_search_expanded',
        serviceRequestId: requestId,
        categoryId: req.categoryId,
        provinceId: req.provinceId,
        districtId: req.districtId,
        value: sent,
      });
      return sent;
    });
  }

  /** Dispatch progress the customer sees on the request. */
  async summary(requestId: string, now = new Date()): Promise<DispatchSummary> {
    const req = await this.prisma.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        type: true,
        status: true,
        expiresAt: true,
        publishedAt: true,
        dispatchWave: true,
        lastDispatchedAt: true,
        nextDispatchAt: true,
        preferredProviderId: true,
        preferredOnly: true,
        province: { select: { isActive: true, waitlistOpen: true } },
        _count: { select: { quotes: true } },
      },
    });
    const [counts, preferred] = await Promise.all([
      this.prisma.requestDispatch.aggregate({
        where: { serviceRequestId: requestId },
        _count: { _all: true, viewedAt: true },
      }),
      req.preferredProviderId
        ? this.prisma.providerProfile.findUnique({
            where: { id: req.preferredProviderId },
            select: {
              id: true,
              displayName: true,
              dispatches: {
                where: { serviceRequestId: requestId },
                select: { viewedAt: true, respondedAt: true },
              },
              quotes: { where: { serviceRequestId: requestId }, select: { id: true } },
            },
          })
        : null,
    ]);
    const open =
      (OPEN as readonly string[]).includes(req.status) && !(req.expiresAt && req.expiresAt <= now);
    const maxWaves = this.waveConfig(req.type).sizes.length;
    const cooled =
      !req.lastDispatchedAt || now.getTime() - req.lastDispatchedAt.getTime() >= EXPAND_COOLDOWN_MS;
    const quoteCount = req._count.quotes;
    const dispatchRow = preferred?.dispatches[0];
    return {
      wave: req.dispatchWave,
      dispatchedCount: counts._count._all,
      viewedCount: counts._count.viewedAt,
      quoteCount,
      lastDispatchedAt: req.lastDispatchedAt?.toISOString() ?? null,
      nextDispatchAt: req.nextDispatchAt?.toISOString() ?? null,
      canExpand:
        open &&
        (req.preferredOnly || (cooled && (req.dispatchWave < maxWaves || req.nextDispatchAt !== null))),
      noOfferPrompt:
        open &&
        req.type === 'QUOTE' &&
        quoteCount === 0 &&
        req.publishedAt !== null &&
        now.getTime() - req.publishedAt.getTime() >= this.env.NO_OFFER_ALERT_MINUTES * 60_000,
      supply: !req.province.isActive
        ? 'WAITLIST'
        : req.publishedAt !== null && counts._count._all === 0
          ? 'NONE'
          : 'OK',
      preferredProvider: preferred
        ? {
            id: preferred.id,
            displayName: preferred.displayName,
            status:
              preferred.quotes.length > 0
                ? 'QUOTED'
                : dispatchRow?.viewedAt
                  ? 'VIEWED'
                  : dispatchRow
                    ? 'WAITING'
                    : 'UNAVAILABLE',
            only: req.preferredOnly,
          }
        : null,
    };
  }

  /** The provider opened the request: first view only. */
  async markViewed(providerId: string, requestId: string, now = new Date()): Promise<void> {
    const updated = await this.prisma.requestDispatch.updateMany({
      where: { serviceRequestId: requestId, providerId, viewedAt: null },
      data: { viewedAt: now },
    });
    if (updated.count > 0) {
      const req = await this.prisma.serviceRequest.findUnique({
        where: { id: requestId },
        select: { categoryId: true, provinceId: true, districtId: true },
      });
      await this.events.record({
        type: 'provider_viewed_request',
        serviceRequestId: requestId,
        providerId,
        categoryId: req?.categoryId ?? null,
        provinceId: req?.provinceId ?? null,
        districtId: req?.districtId ?? null,
      });
    }
  }

  /** A quote arrived: close the provider's dispatch row (same transaction as the quote). */
  async markRespondedIn(tx: Tx, providerId: string, requestId: string, now = new Date()): Promise<void> {
    await tx.requestDispatch.updateMany({
      where: { serviceRequestId: requestId, providerId, respondedAt: null },
      data: { respondedAt: now, result: 'QUOTED' },
    });
    await tx.requestDispatch.updateMany({
      where: { serviceRequestId: requestId, providerId, viewedAt: null },
      data: { viewedAt: now },
    });
  }
}

function budgetLabel(min: bigint | null, max: bigint | null): string {
  if (min === null && max === null) return '';
  if (min !== null && max !== null && max !== min) {
    return ` · Bütçe ${formatMoney(Number(min))}–${formatMoney(Number(max))}`;
  }
  return ` · Bütçe ${formatMoney(Number(min ?? max))}`;
}
