import type {
  Address,
  AppNotification,
  ChangeOrder,
  CurrentUser,
  Device,
  District,
  DisputeReason,
  Job,
  JobListItem,
  NotificationPreferences,
  Opportunity,
  OtpRequestResponse,
  OtpVerifyResponse,
  Paginated,
  ProviderOnboardingStatus,
  ProviderProfile,
  ProviderQuoteListItem,
  ProviderServiceAreaGroup,
  ProviderServiceItem,
  ProviderVerification,
  Province,
  PublicProviderProfile,
  PublicReview,
  Quote,
  Review,
  ServiceCategoryNode,
  ServiceRequest,
  ServiceRequestListItem,
  SignedUrl,
  UnreadNotificationCount,
  UploadIntentResponse,
  VerificationType,
} from '@ustago/types';

import { api } from './session';

/** Typed calls to /api/v1. Screens use these, never raw paths. */

export const authApi = {
  requestOtp: (phone: string) =>
    api.post<OtpRequestResponse>(
      '/auth/otp/request',
      { phone, purpose: 'REGISTER_OR_LOGIN' },
      { auth: false },
    ),
  verifyOtp: (phone: string, code: string, profile: { firstName?: string; lastName?: string }) =>
    api.post<OtpVerifyResponse>(
      '/auth/otp/verify',
      { phone, code, purpose: 'REGISTER_OR_LOGIN', ...profile },
      { auth: false },
    ),
  me: () => api.get<CurrentUser>('/me'),
  updateMe: (body: { firstName?: string; lastName?: string }) =>
    api.patch<CurrentUser>('/me', body),
  logout: async (): Promise<void> => {
    await api.post<unknown>('/auth/logout');
  },
};

export const catalogApi = {
  categories: () => api.get<ServiceCategoryNode[]>('/categories', { auth: false }),
  provinces: () => api.get<Province[]>('/locations/provinces?active=true', { auth: false }),
  districts: (provinceId: number) =>
    api.get<District[]>(`/locations/provinces/${provinceId}/districts`, { auth: false }),
};

export interface AddressInput {
  label?: string | null;
  provinceId: number;
  districtId: string;
  neighborhood?: string | null;
  addressLine: string;
  buildingNo?: string | null;
  apartmentNo?: string | null;
  instructions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isDefault?: boolean;
}

export const addressApi = {
  list: () => api.get<Address[]>('/me/addresses'),
  get: (id: string) => api.get<Address>(`/me/addresses/${id}`),
  create: (body: AddressInput) => api.post<Address>('/me/addresses', body),
  update: (id: string, body: Partial<AddressInput>) =>
    api.patch<Address>(`/me/addresses/${id}`, body),
  remove: async (id: string): Promise<void> => {
    await api.delete<unknown>(`/me/addresses/${id}`);
  },
};

export interface CreateRequestInput {
  type: 'QUOTE' | 'NOW';
  categoryId: string;
  addressId: string;
  title: string;
  description: string;
  budgetMinor: number | null;
  preferredStartAt?: string | null;
  preferredEndAt?: string | null;
  photoUploadIds?: string[];
  idempotencyKey: string;
}

export const requestApi = {
  create: (body: CreateRequestInput) => api.post<ServiceRequest>('/service-requests', body),
  photoUploadIntent: (mimeType: 'image/jpeg' | 'image/png', sizeBytes: number) =>
    api.post<UploadIntentResponse>('/service-requests/photos/upload-intent', {
      mimeType,
      sizeBytes,
    }),
  get: (id: string) => api.get<ServiceRequest>(`/service-requests/${id}`),
  mine: (group: 'OPEN' | 'AGREED' | 'CLOSED') =>
    api.get<Paginated<ServiceRequestListItem>>(`/me/service-requests?group=${group}&limit=50`),
  cancel: (id: string, reason?: string) =>
    api.post<ServiceRequest>(`/service-requests/${id}/cancel`, reason ? { reason } : {}),
  quotes: (id: string) => api.get<Quote[]>(`/service-requests/${id}/quotes`),
  photoUrl: (id: string, photoId: string) =>
    api.get<SignedUrl>(`/service-requests/${id}/photos/${photoId}/url`),
};

export interface CreateQuoteInput {
  totalMinor: number;
  note?: string | null;
  materialsIncluded?: boolean | null;
  estimatedDurationMinutes?: number | null;
}

export const quoteApi = {
  create: (requestId: string, body: CreateQuoteInput) =>
    api.post<Quote>(`/service-requests/${requestId}/quotes`, body),
  get: (id: string) => api.get<Quote>(`/quotes/${id}`),
  counter: (id: string, totalMinor: number, expectedRevisionNo: number, note?: string) =>
    api.post<Quote>(`/quotes/${id}/counter`, {
      totalMinor,
      expectedRevisionNo,
      ...(note ? { note } : {}),
    }),
  accept: (id: string, expectedRevisionNo: number) =>
    api.post<Quote>(`/quotes/${id}/accept`, { expectedRevisionNo }),
  reject: (id: string) => api.post<Quote>(`/quotes/${id}/reject`, {}),
  withdraw: (id: string) => api.post<Quote>(`/quotes/${id}/withdraw`, {}),
};

export type ProviderQuoteFilter = 'WAITING' | 'NEGOTIATING' | 'ACCEPTED' | 'CLOSED';

export const providerApi = {
  create: (displayName: string) => api.post<ProviderProfile>('/providers/me', { displayName }),
  me: () => api.get<ProviderProfile>('/providers/me'),
  update: (body: {
    displayName?: string;
    bio?: string | null;
    yearsOfExperience?: number | null;
  }) => api.patch<ProviderProfile>('/providers/me', body),
  onboarding: () => api.get<ProviderOnboardingStatus>('/providers/me/onboarding'),
  services: () => api.get<ProviderServiceItem[]>('/providers/me/services'),
  setServices: (categoryIds: string[]) =>
    api.put<ProviderServiceItem[]>('/providers/me/services', { categoryIds }),
  areas: () => api.get<ProviderServiceAreaGroup[]>('/providers/me/service-areas'),
  setAreas: (provinceId: number, districtIds: string[]) =>
    api.put<ProviderServiceAreaGroup[]>('/providers/me/service-areas', {
      areas: [{ provinceId, districtIds }],
    }),
  availability: (body: { nowEnabled?: boolean; isAvailableNow?: boolean }) =>
    api.patch<ProviderProfile>('/providers/me/availability', body),
  verifications: () => api.get<ProviderVerification[]>('/providers/me/verifications'),
  verificationIntent: (body: {
    type: VerificationType;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) => api.post<UploadIntentResponse>('/providers/me/verifications/upload-intent', body),
  submitVerification: (type: VerificationType, uploadId: string) =>
    api.post<ProviderVerification>('/providers/me/verifications', { type, uploadId }),
  submit: () => api.post<ProviderProfile>('/providers/me/submit'),
  reapply: () => api.post<ProviderProfile>('/providers/me/reapply'),
  opportunities: (type?: 'QUOTE' | 'NOW') =>
    api.get<Paginated<Opportunity>>(
      `/providers/me/opportunities?limit=50${type ? `&type=${type}` : ''}`,
    ),
  opportunity: (id: string) => api.get<Opportunity>(`/providers/me/opportunities/${id}`),
  quotes: (filter?: ProviderQuoteFilter) =>
    api.get<Paginated<ProviderQuoteListItem>>(
      `/providers/me/quotes?limit=50${filter ? `&filter=${filter}` : ''}`,
    ),
};

export type JobScope = 'ALL' | 'ACTIVE' | 'FINISHED';

export const jobApi = {
  list: (role: 'CUSTOMER' | 'PROVIDER', scope: JobScope = 'ALL') =>
    api.get<Paginated<JobListItem>>(`/jobs?role=${role}&scope=${scope}&limit=50`),
  get: (id: string) => api.get<Job>(`/jobs/${id}`),
  enRoute: (id: string) => api.post<Job>(`/jobs/${id}/en-route`),
  arrive: (id: string) => api.post<Job>(`/jobs/${id}/arrive`),
  start: (id: string) => api.post<Job>(`/jobs/${id}/start`),
  requestCompletion: (id: string) => api.post<Job>(`/jobs/${id}/request-completion`),
  complete: (id: string) => api.post<Job>(`/jobs/${id}/complete`),
  cancel: (id: string, reason: string) => api.post<Job>(`/jobs/${id}/cancel`, { reason }),
  dispute: (id: string, reason: DisputeReason, description: string) =>
    api.post<Job>(`/jobs/${id}/dispute`, { reason, description }),
};

export const changeOrderApi = {
  create: (jobId: string, amountMinor: number, description: string) =>
    api.post<ChangeOrder>(`/jobs/${jobId}/change-orders`, { amountMinor, description }),
  accept: (id: string) => api.post<ChangeOrder>(`/change-orders/${id}/accept`),
  reject: (id: string) => api.post<ChangeOrder>(`/change-orders/${id}/reject`),
  cancel: (id: string) => api.post<ChangeOrder>(`/change-orders/${id}/cancel`),
};

export interface ReviewInput {
  rating: number;
  qualityRating?: number | null;
  communicationRating?: number | null;
  punctualityRating?: number | null;
  valueRating?: number | null;
  comment?: string | null;
}

export const reviewApi = {
  create: (jobId: string, body: ReviewInput) => api.post<Review>(`/jobs/${jobId}/review`, body),
  update: (id: string, body: Partial<ReviewInput>) => api.patch<Review>(`/reviews/${id}`, body),
};

export const publicProviderApi = {
  get: (id: string) => api.get<PublicProviderProfile>(`/providers/${id}`, { auth: false }),
  reviews: (id: string, cursor?: string) =>
    api.get<Paginated<PublicReview>>(
      `/providers/${id}/reviews?limit=10${cursor ? `&cursor=${cursor}` : ''}`,
      { auth: false },
    ),
};

export const notificationApi = {
  list: (cursor?: string) =>
    api.get<Paginated<AppNotification>>(
      `/me/notifications?limit=30${cursor ? `&cursor=${cursor}` : ''}`,
    ),
  unreadCount: () => api.get<UnreadNotificationCount>('/me/notifications/unread-count'),
  markRead: async (ids?: string[]): Promise<void> => {
    await api.post<unknown>('/me/notifications/read', ids ? { ids } : {});
  },
  preferences: () => api.get<NotificationPreferences>('/me/notification-preferences'),
  updatePreferences: (body: { quoteUpdatesPush?: boolean; marketingPush?: boolean }) =>
    api.patch<NotificationPreferences>('/me/notification-preferences', body),
};

export const deviceApi = {
  register: (body: { platform: 'IOS' | 'ANDROID'; pushProvider: 'EXPO'; pushToken: string }) =>
    api.post<Device>('/me/devices', body),
};
