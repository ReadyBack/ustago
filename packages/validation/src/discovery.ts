import type {
  CategoryAnswerSnapshot,
  CategoryQuestion,
  CustomerHome,
  DispatchSummary,
  FavoriteProvider,
  PriceGuide,
  ProviderCard,
  PublicProviderProfileV2,
  RehireDraft,
  RequestForm,
  SearchResult,
} from '@ustago/types';
import { z } from 'zod';

import { publicReviewSchema } from './lifecycle.js';
import { moneySchema } from './money.js';
import { portfolioItemSchema } from './provider-ops.js';

/**
 * Faz 7 discovery (docs/adr/0028, 0029): search, provider discovery,
 * public profile V2, favorites, home, request form and price guide.
 */

export const SEARCH_QUERY_MAX = 80;
export const MAX_CATEGORY_QUESTIONS = 12;
export const MAX_QUESTION_OPTIONS = 12;
export const MAX_CATEGORY_ALIASES = 30;

export const providerSortSchema = z.enum([
  'RECOMMENDED',
  'NEAREST',
  'RATING',
  'COMPLETED_JOBS',
  'RESPONSE_TIME',
]);
export const scheduleOptionSchema = z.enum(['NOW', 'TODAY', 'TOMORROW', 'DATE']);
export const quoteEtaSchema = z.enum(['MIN_30', 'HOUR_1', 'HOUR_2', 'TODAY', 'TOMORROW', 'CUSTOM']);
export const categoryQuestionTypeSchema = z.enum([
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'BOOLEAN',
  'SHORT_TEXT',
  'NUMBER',
]);
export const requestPhotoPolicySchema = z.enum(['OPTIONAL', 'RECOMMENDED', 'REQUIRED']);
export const reviewSortSchema = z.enum(['NEWEST', 'HIGHEST', 'LOWEST']);

const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

/** GET /search */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** POST /search/click: the customer picked a category from the results. */
export const searchClickSchema = z
  .object({
    categoryId: z.uuid(),
    query: z.string().trim().max(SEARCH_QUERY_MAX).optional(),
  })
  .strict();
export type SearchClick = z.infer<typeof searchClickSchema>;

/**
 * GET /providers/discover. Location is coarse: a district (or province)
 * id, never coordinates from the customer's device.
 */
export const discoverProvidersQuerySchema = z.object({
  categoryId: z.uuid().optional(),
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
  districtId: z.uuid().optional(),
  sort: providerSortSchema.default('RECOMMENDED'),
  minRating: z.coerce.number().min(1).max(5).optional(),
  verifiedOnly: boolQuery,
  availableToday: boolQuery,
  maxDistanceKm: z.coerce.number().int().min(1).max(500).optional(),
  /** Opaque keyset cursor from the previous page. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type DiscoverProvidersQuery = z.infer<typeof discoverProvidersQuerySchema>;

/** GET /providers/:id?districtId= (approximate distance from that district). */
export const providerProfileQuerySchema = z.object({
  districtId: z.uuid().optional(),
});
export type ProviderProfileQuery = z.infer<typeof providerProfileQuerySchema>;

/** GET /categories/:id/price-guide */
export const priceGuideQuerySchema = z.object({
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
});
export type PriceGuideQuery = z.infer<typeof priceGuideQuerySchema>;

/** GET /categories/popular */
export const popularCategoriesQuerySchema = z.object({
  provinceId: z.coerce.number().int().min(1).max(81).optional(),
});

/** One answer: string (single select / short text), number, boolean or string[]. */
export const categoryAnswerValueSchema = z.union([
  z.string().trim().min(1).max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().trim().min(1).max(60)).min(1).max(MAX_QUESTION_OPTIONS),
]);
/** Keyed by CategoryQuestion.key; validated against the live questions on publish. */
export const categoryAnswersSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), categoryAnswerValueSchema)
  .refine((v) => Object.keys(v).length <= MAX_CATEGORY_QUESTIONS, 'Çok fazla cevap.');
export type CategoryAnswers = z.infer<typeof categoryAnswersSchema>;

/** POST /service-requests/:id/expand-search: widen now (customer's consent). */
export const expandSearchSchema = z
  .object({
    /** Rehire: also send to other providers, not only the preferred one. */
    includeOtherProviders: z.boolean().default(true),
  })
  .strict();
export type ExpandSearch = z.infer<typeof expandSearchSchema>;

// ---------------------------------------------------------------------------
// Admin: category questions and aliases
// ---------------------------------------------------------------------------

const questionOption = z
  .object({
    value: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,40}$/, 'Değer küçük harf, rakam ve _ olmalı.'),
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const questionShape = {
  label: z.string().trim().min(3).max(200),
  helpText: z.string().trim().min(1).max(300).nullable().optional(),
  type: categoryQuestionTypeSchema,
  options: z.array(questionOption).max(MAX_QUESTION_OPTIONS).optional(),
  required: z.boolean().default(false),
  minValue: z.number().int().nullable().optional(),
  maxValue: z.number().int().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).default(0),
};

function optionsFitType(v: { type: string; options?: { value: string }[] | undefined }) {
  const select = v.type === 'SINGLE_SELECT' || v.type === 'MULTI_SELECT';
  if (!select) return !v.options || v.options.length === 0;
  const values = (v.options ?? []).map((o) => o.value);
  return values.length >= 2 && new Set(values).size === values.length;
}

export const createCategoryQuestionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Anahtar küçük harfle başlamalı; harf, rakam ve _ içerir.'),
    ...questionShape,
  })
  .strict()
  .refine(optionsFitType, {
    path: ['options'],
    message: 'Seçmeli sorular en az iki farklı seçenek ister; diğer türler seçenek almaz.',
  })
  .refine(
    (v) =>
      typeof v.minValue !== 'number' || typeof v.maxValue !== 'number' || v.minValue <= v.maxValue,
    {
      path: ['maxValue'],
      message: 'En büyük değer en küçükten küçük olamaz.',
    },
  );
export type CreateCategoryQuestion = z.infer<typeof createCategoryQuestionSchema>;

/** Type and key never change (published answers keep their meaning). */
export const updateCategoryQuestionSchema = z
  .object({
    label: questionShape.label.optional(),
    helpText: questionShape.helpText,
    options: questionShape.options,
    required: z.boolean().optional(),
    minValue: questionShape.minValue,
    maxValue: questionShape.maxValue,
    sortOrder: z.number().int().min(0).max(10000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateCategoryQuestion = z.infer<typeof updateCategoryQuestionSchema>;

export const createCategoryAliasSchema = z
  .object({ alias: z.string().trim().min(2).max(80) })
  .strict();
export type CreateCategoryAlias = z.infer<typeof createCategoryAliasSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const namedRef = z.object({ id: z.uuid(), name: z.string() });
const provinceRef = z.object({ id: z.number().int(), name: z.string() });
export const categoryRefLiteSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});
const ratingSchema = z.object({ average: z.number(), count: z.number().int() });
const distanceSchema = z.object({ km: z.number(), approximate: z.literal(true) });
const responseStatsSchema = z.object({
  medianMinutes: z.number().int(),
  responseRatePercent: z.number().int(),
  sampleSize: z.number().int(),
});

export const searchResultSchema = z.object({
  query: z.string(),
  categories: z.array(
    z.object({
      category: categoryRefLiteSchema,
      matchKind: z.enum(['NAME', 'ALIAS', 'PREFIX', 'FUZZY']),
      matchedText: z.string(),
    }),
  ),
  suggestions: z.array(categoryRefLiteSchema),
  noResult: z.boolean(),
}) satisfies z.ZodType<SearchResult>;

export const providerCardSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  photoUrl: z.string().nullable(),
  isVerified: z.boolean(),
  rating: ratingSchema.nullable(),
  completedJobCount: z.number().int(),
  ustaScore: z.number().nullable(),
  isNewProvider: z.boolean(),
  categories: z.array(categoryRefLiteSchema),
  areaLabel: z.string(),
  distance: distanceSchema.nullable(),
  availableToday: z.boolean(),
  responseStats: responseStatsSchema.nullable(),
  isFavorite: z.boolean(),
  approxPoint: z.object({ lat: z.number(), lng: z.number() }).nullable(),
}) satisfies z.ZodType<ProviderCard>;

export const publicProviderProfileV2Schema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  photoUrl: z.string().nullable(),
  bio: z.string().nullable(),
  yearsOfExperience: z.number().int().nullable(),
  isVerified: z.boolean(),
  ustaScore: z.number().nullable(),
  isNewProvider: z.boolean(),
  rating: ratingSchema.nullable(),
  reviewDistribution: z.object({
    five: z.number().int(),
    four: z.number().int(),
    three: z.number().int(),
    two: z.number().int(),
    one: z.number().int(),
  }),
  completedJobCount: z.number().int(),
  categories: z.array(categoryRefLiteSchema),
  serviceAreaLabels: z.array(z.string()),
  distance: distanceSchema.nullable(),
  availability: z.object({
    availableToday: z.boolean(),
    onTimeOff: z.boolean(),
    acceptingNewJobs: z.boolean(),
  }),
  responseStats: responseStatsSchema.nullable(),
  portfolio: z.array(portfolioItemSchema),
  recentReviews: z.array(publicReviewSchema),
  isFavorite: z.boolean(),
  memberSince: z.iso.datetime(),
}) satisfies z.ZodType<PublicProviderProfileV2>;

export const favoriteProviderSchema = z.object({
  provider: providerCardSchema,
  available: z.boolean(),
  unavailableReason: z.enum(['SUSPENDED', 'NOT_LISTED']).nullable(),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<FavoriteProvider>;

export const rehireDraftSchema = z.object({
  jobId: z.uuid(),
  category: categoryRefLiteSchema,
  provider: z.object({ id: z.uuid(), displayName: z.string(), available: z.boolean() }),
  addressId: z.uuid().nullable(),
  title: z.string(),
}) satisfies z.ZodType<RehireDraft>;

export const customerHomeSchema = z.object({
  area: z.object({ province: provinceRef, district: namedRef }).nullable(),
  launchStatus: z.enum(['ACTIVE', 'WAITLIST', 'DISABLED']).nullable(),
  activeJobs: z.array(
    z.object({
      jobId: z.uuid(),
      status: z.enum([
        'CREATED',
        'CONFIRMED',
        'PROVIDER_PREPARING',
        'PROVIDER_EN_ROUTE',
        'PROVIDER_ARRIVED',
        'IN_PROGRESS',
        'AWAITING_COMPLETION_CONFIRMATION',
        'COMPLETED',
        'DISPUTED',
        'CANCELLED',
      ]),
      category: categoryRefLiteSchema,
      providerName: z.string(),
      total: moneySchema,
      updatedAt: z.iso.datetime(),
    }),
  ),
  requestsWithQuotes: z.array(
    z.object({
      requestId: z.uuid(),
      title: z.string(),
      category: categoryRefLiteSchema,
      status: z.string(),
      openQuoteCount: z.number().int(),
      createdAt: z.iso.datetime(),
    }),
  ),
  favorites: z.array(providerCardSchema),
  rehire: z.array(
    z.object({
      jobId: z.uuid(),
      provider: providerCardSchema,
      category: categoryRefLiteSchema,
      completedAt: z.iso.datetime(),
    }),
  ),
  recentCategories: z.array(categoryRefLiteSchema),
  popularCategories: z.array(categoryRefLiteSchema),
  nearbyProviders: z.array(providerCardSchema),
}) satisfies z.ZodType<CustomerHome>;

export const categoryQuestionSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  label: z.string(),
  helpText: z.string().nullable(),
  type: categoryQuestionTypeSchema,
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  required: z.boolean(),
  minValue: z.number().int().nullable(),
  maxValue: z.number().int().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
}) satisfies z.ZodType<CategoryQuestion>;

export const requestFormSchema = z.object({
  category: categoryRefLiteSchema,
  photoPolicy: requestPhotoPolicySchema,
  maxPhotos: z.number().int(),
  maxPhotoBytes: z.number().int(),
  supportsNow: z.boolean(),
  questions: z.array(categoryQuestionSchema),
}) satisfies z.ZodType<RequestForm>;

export const priceGuideSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('INSUFFICIENT_DATA'),
    scope: z.enum(['PROVINCE', 'COUNTRY']),
    minSample: z.number().int(),
  }),
  z.object({
    status: z.literal('OK'),
    scope: z.enum(['PROVINCE', 'COUNTRY']),
    p25: moneySchema,
    median: moneySchema,
    p75: moneySchema,
    sampleSizeFloor: z.number().int(),
    periodDays: z.number().int(),
  }),
]) satisfies z.ZodType<PriceGuide>;

export const categoryAnswerSnapshotSchema = z.object({
  questionId: z.uuid(),
  key: z.string(),
  label: z.string(),
  type: categoryQuestionTypeSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  displayValue: z.string(),
}) satisfies z.ZodType<CategoryAnswerSnapshot>;

export const dispatchSummarySchema = z.object({
  wave: z.number().int(),
  dispatchedCount: z.number().int(),
  viewedCount: z.number().int(),
  quoteCount: z.number().int(),
  lastDispatchedAt: z.iso.datetime().nullable(),
  nextDispatchAt: z.iso.datetime().nullable(),
  canExpand: z.boolean(),
  noOfferPrompt: z.boolean(),
  supply: z.enum(['OK', 'NONE', 'WAITLIST']),
  preferredProvider: z
    .object({
      id: z.uuid(),
      displayName: z.string(),
      status: z.enum(['WAITING', 'VIEWED', 'QUOTED', 'UNAVAILABLE']),
      only: z.boolean(),
    })
    .nullable(),
}) satisfies z.ZodType<DispatchSummary>;
