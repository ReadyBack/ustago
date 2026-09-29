import type { Money } from '@ustago/types';
import { z } from 'zod';

export const currencyCodeSchema = z.enum(['TRY']);

export const moneySchema = z.object({
  amountMinor: z.number().int().safe(),
  currency: currencyCodeSchema,
}) satisfies z.ZodType<Money>;
