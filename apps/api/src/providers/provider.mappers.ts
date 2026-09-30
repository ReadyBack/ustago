import type {
  AdminProviderVerification,
  ProviderProfile,
  ProviderRating,
  ProviderServiceAreaGroup,
  ProviderServiceItem,
  ProviderVerification,
  PublicProviderProfile,
  VerificationType,
} from '@ustago/types';

import type {
  Prisma,
  ProviderProfile as ProviderProfileRow,
  ProviderVerification as VerificationRow,
} from '../generated/prisma/client.js';
import { publicUstaScore } from '../quality/domain/usta-score.js';
import { providerPolicy } from './domain/provider-policy.js';

/** Categories and districts of a provider, for every view that lists them. */
export const catalogInclude = {
  services: {
    include: {
      category: {
        select: {
          id: true,
          slug: true,
          name: true,
          supportsNow: true,
          supportsQuote: true,
          isActive: true,
          sortOrder: true,
          parent: { select: { isActive: true } },
        },
      },
    },
  },
  serviceAreas: {
    include: {
      district: {
        select: {
          id: true,
          name: true,
          isActive: true,
          province: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.ProviderProfileInclude;

type WithCatalog = Prisma.ProviderProfileGetPayload<{ include: typeof catalogInclude }>;

export function toProviderProfile(p: ProviderProfileRow): ProviderProfile {
  return {
    id: p.id,
    userId: p.userId,
    type: p.type,
    status: p.status,
    displayName: p.displayName,
    bio: p.bio,
    yearsOfExperience: p.yearsOfExperience,
    nowEnabled: p.nowEnabled,
    isAvailableNow: p.isAvailableNow,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    statusReason: p.status === 'REJECTED' || p.status === 'SUSPENDED' ? p.statusReason : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/**
 * Is the category live in the marketplace? A sub-category counts only while
 * its parent is active too (same rule as `CategoriesService.getActiveBySlug`).
 */
export const liveCategoryWhere = {
  isActive: true,
  OR: [{ parentId: null }, { parent: { isActive: true } }],
} satisfies Prisma.ServiceCategoryWhereInput;

export function isCategoryLive(c: {
  isActive: boolean;
  parent: { isActive: boolean } | null;
}): boolean {
  return c.isActive && (c.parent?.isActive ?? true);
}

/** Live categories only, in catalogue order. */
export function toServiceItems(services: WithCatalog['services']): ProviderServiceItem[] {
  return services
    .filter((s) => isCategoryLive(s.category))
    .sort(
      (a, b) =>
        a.category.sortOrder - b.category.sortOrder ||
        a.category.name.localeCompare(b.category.name, 'tr'),
    )
    .map((s) => ({
      categoryId: s.category.id,
      slug: s.category.slug,
      name: s.category.name,
      supportsNow: s.category.supportsNow,
      supportsQuote: s.category.supportsQuote,
    }));
}

/** Active districts grouped by province (plate order), names in Turkish order. */
export function toServiceAreaGroups(
  areas: WithCatalog['serviceAreas'],
): ProviderServiceAreaGroup[] {
  const groups = new Map<number, ProviderServiceAreaGroup>();
  for (const { district } of areas) {
    if (!district.isActive) continue;
    const group = groups.get(district.province.id) ?? {
      province: { id: district.province.id, name: district.province.name },
      districts: [],
    };
    group.districts.push({ id: district.id, name: district.name });
    groups.set(district.province.id, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.province.id - b.province.id)
    .map((g) => ({
      ...g,
      districts: g.districts.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    }));
}

/** Provider's own view: never the storage key. */
export function toProviderVerification(v: VerificationRow): ProviderVerification {
  return {
    id: v.id,
    type: v.type,
    status: v.status,
    mimeType: v.mimeType,
    sizeBytes: v.sizeBytes,
    originalFileName: v.originalFileName,
    submittedAt: v.submittedAt.toISOString(),
    reviewedAt: v.reviewedAt?.toISOString() ?? null,
    rejectionReason: v.status === 'REJECTED' ? v.rejectionReason : null,
  };
}

export const adminVerificationInclude = {
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProviderVerificationInclude;

type AdminVerificationRow = Prisma.ProviderVerificationGetPayload<{
  include: typeof adminVerificationInclude;
}>;

/** Admin view: who reviewed it and whether a document exists; still no key. */
export function toAdminVerification(v: AdminVerificationRow): AdminProviderVerification {
  return {
    ...toProviderVerification(v),
    rejectionReason: v.rejectionReason,
    providerId: v.providerId,
    reviewedBy: v.reviewedBy
      ? {
          id: v.reviewedBy.id,
          name: `${v.reviewedBy.firstName} ${v.reviewedBy.lastName}`.trim(),
        }
      : null,
    hasDocument: v.documentKey !== null,
  };
}

export const publicProviderInclude = {
  ...catalogInclude,
  verifications: { where: { status: 'APPROVED' }, select: { type: true } },
  score: { select: { score: true, isNewProvider: true, algorithmVersion: true } },
  verificationCase: { select: { status: true } },
} satisfies Prisma.ProviderProfileInclude;

type PublicRow = Prisma.ProviderProfileGetPayload<{ include: typeof publicProviderInclude }>;

/**
 * Customer-facing profile. Built field by field from an allow-list so a new
 * column (phone, documents, admin notes...) can never leak by accident.
 */
export interface PublicProviderStats {
  rating: ProviderRating | null;
  completedJobCount: number;
}

export function toPublicProvider(p: PublicRow, stats: PublicProviderStats): PublicProviderProfile {
  const badges = [...new Set(p.verifications.map((v) => v.type))].sort() as VerificationType[];
  return {
    id: p.id,
    displayName: p.displayName,
    type: p.type,
    bio: p.bio,
    yearsOfExperience: p.yearsOfExperience,
    services: toServiceItems(p.services),
    serviceAreas: toServiceAreaGroups(p.serviceAreas),
    verificationBadges: badges,
    // Faz 6: the central policy decides; never documents or URLs here.
    isVerified: providerPolicy({
      applicationStatus: p.status,
      verificationStatus: p.verificationCase?.status ?? 'NOT_STARTED',
      accountStatus: p.accountStatus,
    }).showVerifiedBadge,
    rating: stats.rating,
    completedJobCount: stats.completedJobCount,
    ustaScore: publicUstaScore(
      p.score
        ? {
            score: Number(p.score.score),
            isNewProvider: p.score.isNewProvider,
            algorithmVersion: p.score.algorithmVersion,
          }
        : null,
    ),
    isNewProvider: p.score?.isNewProvider ?? true,
    memberSince: (p.approvedAt ?? p.createdAt).toISOString(),
  };
}
