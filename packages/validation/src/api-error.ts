import type { ApiErrorResponse } from '@ustago/types';
import { z } from 'zod';

export const apiErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
  path: z.string(),
  timestamp: z.iso.datetime(),
  requestId: z.string().optional(),
}) satisfies z.ZodType<ApiErrorResponse>;
