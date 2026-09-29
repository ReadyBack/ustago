/** Roles a user can hold at the same time (docs/adr/0005). */
export type Role = 'CUSTOMER' | 'PROVIDER' | 'ADMIN' | 'SUPER_ADMIN';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED';

export type ProviderStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export type ProviderType = 'INDIVIDUAL' | 'COMPANY';

export interface AuthTokens {
  tokenType: 'Bearer';
  /** Short-lived JWT; send as `Authorization: Bearer <token>`. */
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Opaque, single-use. Exchange at POST /auth/refresh; store securely. */
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface ProviderProfileSummary {
  id: string;
  status: ProviderStatus;
  displayName: string;
}

/** The signed-in user as returned by GET /me. */
export interface CurrentUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  status: UserStatus;
  locale: string;
  roles: Role[];
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  createdAt: string;
  customerProfile: { id: string } | null;
  providerProfile: ProviderProfileSummary | null;
}

export interface AuthResponse {
  user: CurrentUser;
  tokens: AuthTokens;
}

export interface ProviderProfile {
  id: string;
  userId: string;
  type: ProviderType;
  status: ProviderStatus;
  displayName: string;
  bio: string | null;
  yearsOfExperience: number | null;
  /** Opted in to UstaGO NOW jobs (a preference; can be set before approval). */
  nowEnabled: boolean;
  /** "Müsaitim": dispatchable right now. Only an ACTIVE provider can be. */
  isAvailableNow: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  /** Shown while REJECTED or SUSPENDED. */
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  pushProvider: 'EXPO' | 'FCM' | 'APNS' | null;
  deviceName: string | null;
  appVersion: string | null;
  lastSeenAt: string;
  createdAt: string;
}
