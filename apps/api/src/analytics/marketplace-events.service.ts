import { Injectable } from '@nestjs/common';
import type { MarketplaceEventName } from '@ustago/types';

import type { Prisma } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Db = Prisma.TransactionClient | PrismaService;

export interface MarketplaceEventInput {
  type: MarketplaceEventName;
  serviceRequestId?: string | null;
  providerId?: string | null;
  categoryId?: string | null;
  provinceId?: number | null;
  districtId?: string | null;
  value?: number | null;
  /** Low-cardinality extras only: no names, phones, addresses, bodies or user ids. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Append-only marketplace analytics (docs/adr/0028). Records carry only
 * marketplace ids, region and category, never message bodies, addresses,
 * phone numbers or user ids, so the admin dashboards need no personal data.
 */
@Injectable()
export class MarketplaceEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Inside the caller's transaction so the event exists only if the action committed. */
  async recordIn(db: Db, event: MarketplaceEventInput): Promise<void> {
    await db.marketplaceEvent.create({ data: toRow(event) });
    metrics.marketplaceEvents.inc({ type: event.type });
  }

  async recordManyIn(db: Db, events: MarketplaceEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await db.marketplaceEvent.createMany({ data: events.map(toRow) });
    for (const e of events) metrics.marketplaceEvents.inc({ type: e.type });
  }

  /** Best effort outside a transaction (search analytics): never fails the request. */
  async record(event: MarketplaceEventInput): Promise<void> {
    try {
      await this.recordIn(this.prisma, event);
    } catch {
      metrics.domainEvents.inc({ event: 'marketplace_event.dropped' });
    }
  }
}

function toRow(e: MarketplaceEventInput): Prisma.MarketplaceEventCreateManyInput {
  return {
    type: e.type,
    serviceRequestId: e.serviceRequestId ?? null,
    providerId: e.providerId ?? null,
    categoryId: e.categoryId ?? null,
    provinceId: e.provinceId ?? null,
    districtId: e.districtId ?? null,
    value: e.value ?? null,
    ...(e.metadata ? { metadata: e.metadata } : {}),
  };
}
