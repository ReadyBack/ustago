import type { AuditEvent } from '@ustago/types';
import { z } from 'zod';

import { paginationQuerySchema } from './common.js';

export const listAuditEventsQuerySchema = paginationQuerySchema
  .extend({
    entityType: z.string().trim().min(1).max(60).optional(),
    entityId: z.string().trim().min(1).max(64).optional(),
    actorId: z.uuid().optional(),
    /** Exact action ("provider.approved") or a prefix ending in "." ("provider."). */
    action: z
      .string()
      .trim()
      .regex(/^[a-z_]+(\.[a-z_]*)*$/)
      .max(60)
      .optional(),
    /** Inclusive date range (ISO date or date-time). */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Başlangıç tarihi bitişten sonra olamaz.',
    path: ['from'],
  });
export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuerySchema>;

export const auditEventSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actor: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<AuditEvent>;
