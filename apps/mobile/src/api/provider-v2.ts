import type {
  Opportunity,
  Paginated,
  PortfolioItem,
  ProviderAvailability,
  ProviderCoverage,
  ProviderHome,
  ProviderReviewReply,
  ProviderServiceAreaGroup,
  PublicProviderProfileV2,
  PublicReview,
  Quote,
  UploadIntentResponse,
} from '@ustago/types';
import type {
  CreatePortfolioItem,
  CreateQuote,
  CreateTimeOff,
  SetProviderRegions,
  SetWeeklyHours,
  UpdateAvailabilitySettings,
  UpdateCoverageSettings,
  UpdatePortfolioItem,
} from '@ustago/validation';

import { api } from './session';

/** Faz 7 provider operations (docs/faz7/API-CONTRACT.md). */

export type OpportunitySort = 'NEW' | 'NEAREST' | 'BUDGET';

export interface OpportunityQuery {
  sort?: OpportunitySort;
  maxDistanceKm?: number | null;
  categoryId?: string | null;
  dispatchedOnly?: boolean;
  cursor?: string | null;
  limit?: number;
}

type ImageMime = 'image/jpeg' | 'image/png';

export function opportunityQueryString(q: OpportunityQuery): string {
  const parts = [`limit=${q.limit ?? 20}`, `sort=${q.sort ?? 'NEW'}`];
  if (q.maxDistanceKm) parts.push(`maxDistanceKm=${q.maxDistanceKm}`);
  if (q.categoryId) parts.push(`categoryId=${encodeURIComponent(q.categoryId)}`);
  if (q.dispatchedOnly) parts.push('dispatchedOnly=true');
  if (q.cursor) parts.push(`cursor=${encodeURIComponent(q.cursor)}`);
  return parts.join('&');
}

export const providerV2Api = {
  home: () => api.get<ProviderHome>('/providers/me/home'),

  // Availability
  availability: () => api.get<ProviderAvailability>('/providers/me/availability-settings'),
  updateAvailability: (body: UpdateAvailabilitySettings) =>
    api.patch<ProviderAvailability>('/providers/me/availability-settings', body),
  setWeeklyHours: (body: SetWeeklyHours) =>
    api.put<ProviderAvailability>('/providers/me/weekly-hours', body),
  addTimeOff: (body: CreateTimeOff) =>
    api.post<ProviderAvailability>('/providers/me/time-off', body),
  removeTimeOff: (id: string) => api.delete<ProviderAvailability>(`/providers/me/time-off/${id}`),

  // Coverage
  coverage: () => api.get<ProviderCoverage>('/providers/me/coverage'),
  setRegions: (body: SetProviderRegions) =>
    api.put<ProviderCoverage>('/providers/me/regions', body),
  updateCoverage: (body: UpdateCoverageSettings) =>
    api.patch<ProviderCoverage>('/providers/me/coverage', body),
  /** The Faz 2 district list (unchanged endpoint); replaces every province group. */
  setServiceAreas: (areas: { provinceId: number; districtIds: string[] }[]) =>
    api.put<ProviderServiceAreaGroup[]>('/providers/me/service-areas', { areas }),

  // "Sana Uygun İşler"
  opportunities: (q: OpportunityQuery = {}) =>
    api.get<Paginated<Opportunity>>(`/opportunities?${opportunityQueryString(q)}`),
  opportunity: (id: string) => api.get<Opportunity>(`/opportunities/${id}`),
  createQuote: (requestId: string, body: CreateQuote) =>
    api.post<Quote>(`/service-requests/${requestId}/quotes`, body),

  // Portfolio
  portfolio: () => api.get<PortfolioItem[]>('/providers/me/portfolio'),
  portfolioUploadIntent: (mimeType: ImageMime, sizeBytes: number) =>
    api.post<UploadIntentResponse>('/providers/me/portfolio/upload-intent', {
      mimeType,
      sizeBytes,
    }),
  createPortfolioItem: (body: CreatePortfolioItem) =>
    api.post<PortfolioItem>('/providers/me/portfolio', body),
  updatePortfolioItem: (id: string, body: UpdatePortfolioItem) =>
    api.patch<PortfolioItem>(`/providers/me/portfolio/${id}`, body),
  deletePortfolioItem: async (id: string): Promise<void> => {
    await api.delete<unknown>(`/providers/me/portfolio/${id}`);
  },
  reorderPortfolio: (itemIds: string[]) =>
    api.put<PortfolioItem[]>('/providers/me/portfolio/order', { itemIds }),

  // Profile photo
  photoUploadIntent: (mimeType: ImageMime, sizeBytes: number) =>
    api.post<UploadIntentResponse>('/providers/me/photo/upload-intent', { mimeType, sizeBytes }),
  setPhoto: (uploadId: string) =>
    api.put<{ photoUrl: string }>('/providers/me/photo', { uploadId }),
  removePhoto: async (): Promise<void> => {
    await api.delete<unknown>('/providers/me/photo');
  },

  // Own public profile and reviews (what customers see)
  publicProfile: (providerId: string) =>
    api.get<PublicProviderProfileV2>(`/providers/${providerId}`),
  reviews: (providerId: string, cursor?: string) =>
    api.get<Paginated<PublicReview>>(
      `/providers/${providerId}/reviews?limit=10&sort=NEWEST${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
  replyToReview: (reviewId: string, body: string) =>
    api.post<ProviderReviewReply>(`/reviews/${reviewId}/reply`, { body }),
};
