import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';
import type { ProviderAvailability, WeeklyHoursInterval } from '@ustago/types';
import type { CreateTimeOff, SetWeeklyHours, UpdateAvailabilitySettings } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { notFound, unprocessable } from '../common/http/errors.js';
import { endOfLocalDay } from '../common/utils/local-time.js';
import { API_ENV } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeAvailability } from '../providers/domain/availability.js';
import { ProviderStore } from '../providers/provider.store.js';

type Db = Prisma.TransactionClient | PrismaService;

/** Upcoming time-off entries a provider may have at once. */
const MAX_OPEN_TIME_OFF = 20;

/**
 * Provider availability (docs/adr/0031): weekly hours, time off, "Bugün
 * müsait değilim" and "Yeni iş alma", evaluated in MARKETPLACE_TIME_ZONE.
 * The same evaluation feeds matching, dispatch, NOW, discovery and the
 * public profile, so every surface agrees on who is available.
 */
@Injectable()
export class ProviderAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get timeZone(): string {
    return this.env.MARKETPLACE_TIME_ZONE;
  }

  async getMine(userId: string): Promise<ProviderAvailability> {
    const profile = await this.store.findByUserId(userId);
    return this.view(profile.id);
  }

  async view(
    providerId: string,
    now = new Date(),
    db: Db = this.prisma,
  ): Promise<ProviderAvailability> {
    const row = await db.providerProfile.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        acceptingNewJobs: true,
        unavailableUntil: true,
        nowEnabled: true,
        isAvailableNow: true,
        weeklyHours: {
          orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
          select: { weekday: true, startMinute: true, endMinute: true },
        },
        timeOff: {
          where: { cancelledAt: null, endsAt: { gt: now } },
          orderBy: { startsAt: 'asc' },
          select: { id: true, startsAt: true, endsAt: true, note: true },
        },
      },
    });
    if (!row) throw notFound('PROVIDER_NOT_FOUND', 'Usta profili bulunamadı.');
    const result = computeAvailability({
      acceptingNewJobs: row.acceptingNewJobs,
      unavailableUntil: row.unavailableUntil,
      weeklyHours: row.weeklyHours,
      timeOff: row.timeOff,
      now,
      timeZone: this.timeZone,
    });
    return {
      state: result.state,
      receivesNewJobs: result.receivesNewJobs,
      acceptingNewJobs: row.acceptingNewJobs,
      unavailableUntil:
        row.unavailableUntil && row.unavailableUntil > now
          ? row.unavailableUntil.toISOString()
          : null,
      nowEnabled: row.nowEnabled,
      isAvailableNow: row.isAvailableNow,
      weeklyHours: row.weeklyHours,
      timeOff: row.timeOff.map((t) => ({
        id: t.id,
        startsAt: t.startsAt.toISOString(),
        endsAt: t.endsAt.toISOString(),
        note: t.note,
        current: t.startsAt <= now,
      })),
      timeZone: this.timeZone,
    };
  }

  /**
   * "Yeni iş alma" and "Bugün müsait değilim". Pausing also ends the NOW
   * "müsaitim" state: a paused provider must not get emergency jobs.
   */
  async updateSettings(
    userId: string,
    input: UpdateAvailabilitySettings,
    ipAddress: string | null,
    now = new Date(),
  ): Promise<ProviderAvailability> {
    const providerId = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      const data: Prisma.ProviderProfileUpdateInput = { lastActiveAt: now };
      if (input.acceptingNewJobs !== undefined) {
        data.acceptingNewJobs = input.acceptingNewJobs;
        if (!input.acceptingNewJobs) data.isAvailableNow = false;
      }
      if (input.availableToday !== undefined) {
        data.unavailableUntil = input.availableToday ? null : endOfLocalDay(now, this.timeZone);
        if (!input.availableToday) data.isAvailableNow = false;
      }
      await tx.providerProfile.update({ where: { id: profile.id }, data });
      await this.audit.recordIn(tx, {
        action: 'provider.availability_settings_updated',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: profile.id,
        ipAddress,
        metadata: { ...input },
      });
      return profile.id;
    });
    return this.view(providerId, now);
  }

  /** Replaces the week. Empty = flexible hours. */
  async setWeeklyHours(
    userId: string,
    input: SetWeeklyHours,
    ipAddress: string | null,
  ): Promise<ProviderAvailability> {
    const providerId = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      await tx.providerWeeklyHours.deleteMany({ where: { providerId: profile.id } });
      if (input.hours.length > 0) {
        await tx.providerWeeklyHours.createMany({
          data: input.hours.map((h: WeeklyHoursInterval) => ({ providerId: profile.id, ...h })),
        });
      }
      await tx.providerProfile.update({
        where: { id: profile.id },
        data: { lastActiveAt: new Date() },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.weekly_hours_updated',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: profile.id,
        ipAddress,
        metadata: { intervals: input.hours.length },
      });
      return profile.id;
    });
    return this.view(providerId);
  }

  async addTimeOff(
    userId: string,
    input: CreateTimeOff,
    ipAddress: string | null,
    now = new Date(),
  ): Promise<ProviderAvailability> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (endsAt <= now) {
      throw unprocessable('TIME_OFF_IN_PAST', 'Geçmiş tarihli izin eklenemez.');
    }
    const providerId = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      const open = await tx.providerTimeOff.count({
        where: { providerId: profile.id, cancelledAt: null, endsAt: { gt: now } },
      });
      if (open >= MAX_OPEN_TIME_OFF) {
        throw unprocessable(
          'TIME_OFF_LIMIT',
          `En fazla ${MAX_OPEN_TIME_OFF} ileri tarihli izin girilebilir.`,
        );
      }
      const created = await tx.providerTimeOff.create({
        data: { providerId: profile.id, startsAt, endsAt, note: input.note ?? null },
      });
      // Time off that starts now also ends the NOW "müsaitim" state.
      if (startsAt <= now) {
        await tx.providerProfile.update({
          where: { id: profile.id },
          data: { isAvailableNow: false },
        });
      }
      await this.audit.recordIn(tx, {
        action: 'provider.time_off_added',
        actorId: userId,
        entityType: 'provider_time_off',
        entityId: created.id,
        ipAddress,
        metadata: { startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return profile.id;
    });
    return this.view(providerId, now);
  }

  async cancelTimeOff(
    userId: string,
    timeOffId: string,
    ipAddress: string | null,
  ): Promise<ProviderAvailability> {
    const providerId = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockByUserId(tx, userId);
      const updated = await tx.providerTimeOff.updateMany({
        where: { id: timeOffId, providerId: profile.id, cancelledAt: null },
        data: { cancelledAt: new Date() },
      });
      if (updated.count === 0) throw notFound('TIME_OFF_NOT_FOUND', 'İzin kaydı bulunamadı.');
      await this.audit.recordIn(tx, {
        action: 'provider.time_off_cancelled',
        actorId: userId,
        entityType: 'provider_time_off',
        entityId: timeOffId,
        ipAddress,
      });
      return profile.id;
    });
    return this.view(providerId);
  }
}
