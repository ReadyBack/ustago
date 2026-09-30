import type {
  AppNotification,
  BadgeCounts,
  CategoryRef,
  ConversationDetail,
  CustomerHome,
  FavoriteProvider,
  NotificationCategory,
  NotificationPreferences,
  Paginated,
  PriceGuide,
  ProviderCard,
  ProviderSort,
  PublicProviderProfileV2,
  PublicReview,
  RehireDraft,
  RequestForm,
  ReviewSort,
  ScheduleOption,
  SearchResult,
  ServiceRequest,
} from '@ustago/types';

import { api } from './session';

/**
 * Faz 7 customer calls (docs/faz7/API-CONTRACT.md). Screens use these,
 * never raw paths. Location sent to the server is always coarse (a
 * district or province id), never device coordinates.
 */

/** Builds "?a=1&b=2", skipping undefined, null and empty values. */
export function query(params: Record<string, string | number | boolean | null | undefined>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const homeApi = {
  get: () => api.get<CustomerHome>('/me/home'),
  badges: () => api.get<BadgeCounts>('/me/badges'),
  popularCategories: (provinceId?: number) =>
    api.get<CategoryRef[]>(`/categories/popular${query({ provinceId })}`),
};

export const searchApi = {
  search: (q: string, signal?: AbortSignal) =>
    api.get<SearchResult>(`/search${query({ q })}`, { signal }),
  /** Analytics only; a failure never blocks the customer. */
  click: async (categoryId: string, q?: string): Promise<void> => {
    await api.post<unknown>('/search/click', { categoryId, ...(q ? { query: q } : {}) });
  },
};

export interface DiscoverFilters {
  categoryId?: string;
  districtId?: string;
  provinceId?: number;
  sort: ProviderSort;
  availableToday?: boolean;
  verifiedOnly?: boolean;
  minRating?: number;
  cursor?: string;
  limit?: number;
}

export const discoveryApi = {
  providers: (f: DiscoverFilters) =>
    api.get<Paginated<ProviderCard>>(
      `/providers${query({
        categoryId: f.categoryId,
        districtId: f.districtId,
        provinceId: f.provinceId,
        sort: f.sort,
        availableToday: f.availableToday ? 'true' : undefined,
        verifiedOnly: f.verifiedOnly ? 'true' : undefined,
        minRating: f.minRating,
        cursor: f.cursor,
        limit: f.limit ?? 20,
      })}`,
    ),
  profile: (id: string, districtId?: string | null) =>
    api.get<PublicProviderProfileV2>(`/providers/${id}${query({ districtId })}`),
  /**
   * NEWEST pages by cursor; HIGHEST / LOWEST by page number
   * (listProviderReviewsQuerySchema). `rating` narrows to one star value.
   */
  reviews: (
    id: string,
    opts: { sort: ReviewSort; rating?: number | null; cursor?: string | null; page?: number },
  ) =>
    api.get<Paginated<PublicReview>>(
      `/providers/${id}/reviews${query({
        limit: 10,
        sort: opts.sort,
        rating: opts.rating,
        cursor: opts.sort === 'NEWEST' ? opts.cursor : undefined,
        page: opts.sort === 'NEWEST' ? undefined : opts.page,
      })}`,
    ),
};

export const favoritesApi = {
  list: (cursor?: string | null) =>
    api.get<Paginated<FavoriteProvider>>(`/me/favorites${query({ cursor, limit: 30 })}`),
  add: async (providerId: string): Promise<void> => {
    await api.put<unknown>(`/me/favorites/${providerId}`);
  },
  remove: async (providerId: string): Promise<void> => {
    await api.delete<unknown>(`/me/favorites/${providerId}`);
  },
};

export interface CreateRequestV2Input {
  type: 'QUOTE' | 'NOW';
  categoryId: string;
  addressId: string;
  title: string;
  description: string;
  budgetMinor: number | null;
  budgetMaxMinor?: number | null;
  preferredStartAt?: string | null;
  preferredEndAt?: string | null;
  photoUploadIds?: string[];
  idempotencyKey: string;
  scheduleOption?: ScheduleOption | null;
  answers?: Record<string, string | number | boolean | string[]>;
  preferredProviderId?: string | null;
  preferredOnly?: boolean;
  rehireOfJobId?: string | null;
}

export const requestV2Api = {
  create: (body: CreateRequestV2Input) => api.post<ServiceRequest>('/service-requests', body),
  form: (categoryId: string) => api.get<RequestForm>(`/categories/${categoryId}/request-form`),
  priceGuide: (categoryId: string, provinceId?: number | null) =>
    api.get<PriceGuide>(`/categories/${categoryId}/price-guide${query({ provinceId })}`),
  rehire: (jobId: string) => api.get<RehireDraft>(`/jobs/${jobId}/rehire`),
  expandSearch: (requestId: string, includeOtherProviders = true) =>
    api.post<ServiceRequest>(`/service-requests/${requestId}/expand-search`, {
      includeOtherProviders,
    }),
};

/**
 * The chat screen belongs to the messaging feature; the customer side only
 * needs the conversation id for a quote. An existing one is reused, else
 * POST /conversations returns the (possibly already existing) conversation.
 */
export async function conversationIdForQuote(quote: {
  id: string;
  conversationId: string | null;
}): Promise<string> {
  if (quote.conversationId) return quote.conversationId;
  const detail = await api.post<ConversationDetail>('/conversations', { quoteId: quote.id });
  return detail.id;
}

export const notificationV2Api = {
  list: (opts: { category?: NotificationCategory | null; cursor?: string | null }) =>
    api.get<Paginated<AppNotification>>(
      `/me/notifications${query({ limit: 30, category: opts.category, cursor: opts.cursor })}`,
    ),
  /** No ids = all of the caller's notifications. */
  markRead: async (ids?: string[]): Promise<void> => {
    await api.post<unknown>('/me/notifications/read', ids ? { ids } : {});
  },
  preferences: () => api.get<NotificationPreferences>('/me/notification-preferences'),
  updatePreferences: (
    body: Partial<
      Pick<
        NotificationPreferences,
        | 'quoteUpdatesPush'
        | 'newMessagePush'
        | 'marketingPush'
        | 'quietHoursStart'
        | 'quietHoursEnd'
      >
    >,
  ) => api.patch<NotificationPreferences>('/me/notification-preferences', body),
};
