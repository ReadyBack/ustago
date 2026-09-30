import { Inject, Injectable } from '@nestjs/common';
import type { RuntimeFlagView } from '@ustago/types';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound, serviceUnavailable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Feature kill switches (docs/adr/0025). The deploy decides whether a
 * feature exists at all (env); admins can only switch an existing feature
 * off (and back on). Effective = env AND admin. Env-only settings such as
 * the payment provider or dev routes are never exposed here.
 */
export const RUNTIME_FLAGS = {
  payments: { label: 'Online ödeme (yeni ödeme başlatma)', env: 'PAYMENTS_ENABLED' },
  payouts: { label: 'Para çekme talepleri ve onayı', env: 'PAYOUTS_ENABLED' },
  cash: { label: 'Nakit ödeme seçimi', env: 'CASH_ENABLED' },
  new_jobs: { label: 'Yeni talep oluşturma', env: 'NEW_JOBS_ENABLED' },
} as const satisfies Record<string, { label: string; env: keyof ApiEnv }>;

export type RuntimeFlagKey = keyof typeof RUNTIME_FLAGS;

export function isRuntimeFlagKey(key: string): key is RuntimeFlagKey {
  return Object.hasOwn(RUNTIME_FLAGS, key);
}

const CACHE_MS = 5000;

@Injectable()
export class RuntimeFlagsService {
  private cache: { at: number; values: Map<string, boolean> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private envEnabled(key: RuntimeFlagKey): boolean {
    return this.env[RUNTIME_FLAGS[key].env] === true;
  }

  async isEnabled(key: RuntimeFlagKey): Promise<boolean> {
    if (!this.envEnabled(key)) return false;
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      const rows = await this.prisma.runtimeFlag.findMany({ select: { key: true, enabled: true } });
      this.cache = { at: now, values: new Map(rows.map((r) => [r.key, r.enabled])) };
    }
    return this.cache.values.get(key) ?? true;
  }

  /** Throws 503 FEATURE_DISABLED when the feature is switched off. */
  async assertEnabled(key: RuntimeFlagKey): Promise<void> {
    if (!(await this.isEnabled(key))) {
      throw serviceUnavailable(
        'FEATURE_DISABLED',
        'Bu özellik şu anda geçici olarak kapalı. Lütfen daha sonra tekrar deneyin.',
      );
    }
  }

  async list(): Promise<RuntimeFlagView[]> {
    const rows = await this.prisma.runtimeFlag.findMany({
      include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return (Object.keys(RUNTIME_FLAGS) as RuntimeFlagKey[]).map((key) => {
      const row = byKey.get(key);
      const envEnabled = this.envEnabled(key);
      const adminEnabled = row?.enabled ?? true;
      return {
        key,
        label: RUNTIME_FLAGS[key].label,
        envEnabled,
        adminEnabled,
        effective: envEnabled && adminEnabled,
        reason: row?.reason ?? null,
        updatedBy: row?.updatedBy
          ? { id: row.updatedBy.id, name: `${row.updatedBy.firstName} ${row.updatedBy.lastName}` }
          : null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async set(
    actorId: string,
    key: string,
    enabled: boolean,
    reason: string,
    ipAddress: string | null,
  ): Promise<RuntimeFlagView> {
    if (!isRuntimeFlagKey(key)) throw notFound('RUNTIME_FLAG_NOT_FOUND', 'Anahtar bulunamadı.');
    if (enabled && !this.envEnabled(key)) {
      throw conflict(
        'RUNTIME_FLAG_ENV_DISABLED',
        'Bu özellik ortam ayarında kapalı; panelden açılamaz.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.runtimeFlag.findUnique({ where: { key } });
      await tx.runtimeFlag.upsert({
        where: { key },
        create: { key, enabled, reason, updatedById: actorId },
        update: { enabled, reason, updatedById: actorId },
      });
      await this.audit.recordIn(tx, {
        action: 'runtime_flag.changed',
        actorId,
        entityType: 'runtime_flag',
        entityId: key,
        ipAddress,
        metadata: { before: before?.enabled ?? true, after: enabled, reason },
      });
    });
    this.cache = null;
    const view = (await this.list()).find((f) => f.key === key);
    if (!view) throw notFound('RUNTIME_FLAG_NOT_FOUND', 'Anahtar bulunamadı.');
    return view;
  }
}
