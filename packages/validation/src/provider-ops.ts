import type {
  PortfolioItem,
  ProfileCompleteness,
  ProviderAvailability,
  ProviderCoverage,
  ProviderHome,
  ProviderServiceRegion,
} from '@ustago/types';
import { z } from 'zod';

/**
 * Faz 7 provider operations (docs/adr/0028, 0031): service regions, travel
 * distance, availability, weekly hours, time off, portfolio and photo.
 */

export const MAX_SERVICE_REGIONS = 20;
export const MAX_RADIUS_KM = 200;
export const MAX_TRAVEL_KM = 500;
/** Offered in the app; any whole number 1-500 is accepted. */
export const TRAVEL_DISTANCE_PRESETS_KM = [5, 10, 20, 30, 50] as const;
export const MAX_WEEKLY_INTERVALS = 21;
export const MAX_TIME_OFF_DAYS = 90;
export const MAX_PORTFOLIO_ITEMS = 30;
export const MAX_PORTFOLIO_MEDIA_PER_ITEM = 6;
export const MAX_BIO_LENGTH = 1000;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

const isoDate = z.iso.datetime({ offset: true });

export const providerRegionKindSchema = z.enum(['PROVINCE', 'RADIUS']);

const regionInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PROVINCE'), provinceId: z.number().int().min(1).max(81) }).strict(),
  z
    .object({
      kind: z.literal('RADIUS'),
      centerDistrictId: z.uuid(),
      radiusKm: z.number().int().min(1).max(MAX_RADIUS_KM),
    })
    .strict(),
]);

/** PUT /providers/me/regions: replaces the provider's wider service regions. */
export const setProviderRegionsSchema = z
  .object({ regions: z.array(regionInput).max(MAX_SERVICE_REGIONS) })
  .strict()
  .refine(
    (v) => {
      const provinces = v.regions.flatMap((r) => (r.kind === 'PROVINCE' ? [r.provinceId] : []));
      return new Set(provinces).size === provinces.length;
    },
    { message: 'Aynı il iki kez eklenemez.' },
  );
export type SetProviderRegions = z.infer<typeof setProviderRegionsSchema>;

/** PATCH /providers/me/coverage-settings */
export const updateCoverageSettingsSchema = z
  .object({
    maxTravelKm: z.number().int().min(1).max(MAX_TRAVEL_KM).nullable().optional(),
    serviceCenterDistrictId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateCoverageSettings = z.infer<typeof updateCoverageSettingsSchema>;

/** PATCH /providers/me/availability/settings: "Yeni iş alma" and "Bugün müsaitim". */
export const updateAvailabilitySettingsSchema = z
  .object({
    acceptingNewJobs: z.boolean().optional(),
    availableToday: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdateAvailabilitySettings = z.infer<typeof updateAvailabilitySettingsSchema>;

export const weeklyHoursIntervalSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((v) => v.startMinute < v.endMinute, {
    path: ['endMinute'],
    message: 'Bitiş saati başlangıçtan sonra olmalı.',
  });

/** Intervals of one weekday must not overlap. */
export function weeklyIntervalsOverlap(
  hours: readonly { weekday: number; startMinute: number; endMinute: number }[],
): boolean {
  const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
  return sorted.some((cur, i) => {
    const prev = sorted[i - 1];
    return prev !== undefined && prev.weekday === cur.weekday && cur.startMinute < prev.endMinute;
  });
}

/** PUT /providers/me/weekly-hours: replaces the week. Empty = flexible. */
export const setWeeklyHoursSchema = z
  .object({ hours: z.array(weeklyHoursIntervalSchema).max(MAX_WEEKLY_INTERVALS) })
  .strict()
  .refine((v) => !weeklyIntervalsOverlap(v.hours), {
    message: 'Aynı gün için çakışan saat aralıkları var.',
  });
export type SetWeeklyHours = z.infer<typeof setWeeklyHoursSchema>;

/** POST /providers/me/time-off */
export const createTimeOffSchema = z
  .object({
    startsAt: isoDate,
    endsAt: isoDate,
    note: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((v) => new Date(v.startsAt) < new Date(v.endsAt), {
    path: ['endsAt'],
    message: 'İzin bitişi başlangıçtan sonra olmalı.',
  })
  .refine(
    (v) =>
      new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <=
      MAX_TIME_OFF_DAYS * 86_400_000,
    {
      path: ['endsAt'],
      message: `Tek seferde en fazla ${MAX_TIME_OFF_DAYS} gün izin girilebilir.`,
    },
  );
export type CreateTimeOff = z.infer<typeof createTimeOffSchema>;

export const imageUploadIntentSchema = z
  .object({
    mimeType: z.enum(IMAGE_MIME_TYPES),
    sizeBytes: z.number().int().min(1),
    fileName: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export type ImageUploadIntent = z.infer<typeof imageUploadIntentSchema>;

/** PUT /providers/me/photo */
export const setProfilePhotoSchema = z.object({ uploadId: z.uuid() }).strict();
export type SetProfilePhoto = z.infer<typeof setProfilePhotoSchema>;

const portfolioTitle = z.string().trim().min(3, 'Başlık en az 3 karakter olmalı.').max(120);
const portfolioDescription = z.string().trim().min(1).max(1000).nullable().optional();

/**
 * POST /providers/me/portfolio. `consentConfirmed` is the upload checklist:
 * no customer faces, addresses, documents or plates, and the provider may
 * publish the photos. No automatic face recognition is done.
 */
export const createPortfolioItemSchema = z
  .object({
    title: portfolioTitle,
    description: portfolioDescription,
    categoryId: z.uuid().nullable().optional(),
    uploadIds: z
      .array(z.uuid())
      .min(1, 'En az bir fotoğraf ekleyin.')
      .max(MAX_PORTFOLIO_MEDIA_PER_ITEM)
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı fotoğraf iki kez eklenemez.'),
    consentConfirmed: z.literal(true, {
      message: 'Fotoğrafların paylaşıma uygun olduğunu onaylayın.',
    }),
  })
  .strict();
export type CreatePortfolioItem = z.infer<typeof createPortfolioItemSchema>;

export const updatePortfolioItemSchema = z
  .object({
    title: portfolioTitle.optional(),
    description: portfolioDescription,
    categoryId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'En az bir alan gönderin.' });
export type UpdatePortfolioItem = z.infer<typeof updatePortfolioItemSchema>;

export const reorderPortfolioSchema = z
  .object({
    itemIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_PORTFOLIO_ITEMS)
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı öğe iki kez gönderildi.'),
  })
  .strict();
export type ReorderPortfolio = z.infer<typeof reorderPortfolioSchema>;

/** Plain text only: tags and control characters are refused, not stripped. */
export const plainTextBio = z
  .string()
  .trim()
  .min(20, 'Tanıtım en az 20 karakter olmalı.')
  .max(MAX_BIO_LENGTH)
  .refine((v) => !/[<>]/.test(v), 'Tanıtım metninde < ve > karakterleri kullanılamaz.')
  .refine(
    // eslint-disable-next-line no-control-regex
    (v) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v),
    'Tanıtım metni geçersiz karakter içeriyor.',
  );

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const namedRef = z.object({ id: z.uuid(), name: z.string() });
const provinceRef = z.object({ id: z.number().int(), name: z.string() });
const categoryRef = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});

export const providerServiceRegionSchema = z.object({
  id: z.uuid(),
  kind: providerRegionKindSchema,
  province: provinceRef,
  centerDistrict: namedRef.nullable(),
  radiusKm: z.number().int().nullable(),
  active: z.boolean(),
}) satisfies z.ZodType<ProviderServiceRegion>;

export const providerCoverageSchema = z.object({
  districts: z.array(z.object({ province: provinceRef, districts: z.array(namedRef) })),
  regions: z.array(providerServiceRegionSchema),
  maxTravelKm: z.number().int().nullable(),
  serviceCenter: z.object({ province: provinceRef, district: namedRef }).nullable(),
}) satisfies z.ZodType<ProviderCoverage>;

export const availabilityStateSchema = z.enum([
  'AVAILABLE',
  'OUTSIDE_HOURS',
  'UNAVAILABLE_TODAY',
  'TIME_OFF',
  'PAUSED',
]);

export const providerAvailabilitySchema = z.object({
  state: availabilityStateSchema,
  receivesNewJobs: z.boolean(),
  acceptingNewJobs: z.boolean(),
  unavailableUntil: z.iso.datetime().nullable(),
  nowEnabled: z.boolean(),
  isAvailableNow: z.boolean(),
  weeklyHours: z.array(
    z.object({
      weekday: z.number().int(),
      startMinute: z.number().int(),
      endMinute: z.number().int(),
    }),
  ),
  timeOff: z.array(
    z.object({
      id: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      note: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
  timeZone: z.string(),
}) satisfies z.ZodType<ProviderAvailability>;

export const portfolioItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: categoryRef.nullable(),
  sortOrder: z.number().int(),
  media: z.array(
    z.object({ id: z.uuid(), kind: z.literal('IMAGE'), mimeType: z.string(), url: z.string() }),
  ),
  createdAt: z.iso.datetime(),
}) satisfies z.ZodType<PortfolioItem>;

export const profileCompletenessSchema = z.object({
  percent: z.number().int().min(0).max(100),
  items: z.array(
    z.object({
      key: z.enum([
        'photo',
        'bio',
        'services',
        'areas',
        'portfolio',
        'availability',
        'verification',
      ]),
      done: z.boolean(),
      label: z.string(),
    }),
  ),
}) satisfies z.ZodType<ProfileCompleteness>;

export const providerHomeSchema = z.object({
  availability: providerAvailabilitySchema,
  newMatchingJobs: z.number().int(),
  openOpportunities: z.number().int(),
  activeJobs: z.number().int(),
  pendingQuotes: z.number().int(),
  unreadMessages: z.number().int(),
  todayEarningsMinor: z.number().int(),
  availableBalanceMinor: z.number().int(),
  verificationStatus: z.string(),
  profileCompleteness: profileCompletenessSchema,
}) satisfies z.ZodType<ProviderHome>;
