import { z } from 'zod';

/** Faz 7 admin marketplace analytics queries (docs/adr/0028). */

export const marketplaceOverviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
export type MarketplaceOverviewQuery = z.infer<typeof marketplaceOverviewQuerySchema>;

export const regionStatsQuerySchema = z.object({
  /** Without it: one row per province; with it: one row per district. */
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});
export type RegionStatsQuery = z.infer<typeof regionStatsQuerySchema>;

export const categoryStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type CategoryStatsQuery = z.infer<typeof categoryStatsQuerySchema>;

export const noOfferQuerySchema = z.object({
  /** Minutes since publication without any quote. */
  olderThanMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30)
    .default(60),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});
export type NoOfferQuery = z.infer<typeof noOfferQuerySchema>;

export const matchPreviewQuerySchema = z.object({ requestId: z.uuid() });
export type MatchPreviewQuery = z.infer<typeof matchPreviewQuerySchema>;

/** Counts below this are hidden ("<5") in region analytics (small-sample privacy). */
export const REGION_PRIVACY_THRESHOLD = 5;
