import { Injectable } from '@nestjs/common';
import type { ProviderProfile } from '@ustago/types';
import type {
  CreateProviderProfileRequest,
  UpdateProviderProfileRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/http/errors.js';
import type { ProviderProfile as ProviderProfileRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lets an existing account start offering services: opens a DRAFT
   * provider profile and grants the PROVIDER role in one transaction. The
   * account keeps its CUSTOMER role (ADR-0005).
   */
  async becomeProvider(
    userId: string,
    input: CreateProviderProfileRequest,
    ipAddress: string | null,
  ): Promise<ProviderProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.providerProfile.findUnique({ where: { userId } });
      if (existing) {
        throw conflict('PROVIDER_PROFILE_EXISTS', 'Bu hesabın zaten bir usta profili var.');
      }
      const created = await tx.providerProfile.create({
        data: {
          userId,
          displayName: input.displayName,
          type: input.type,
          bio: input.bio ?? null,
          yearsOfExperience: input.yearsOfExperience ?? null,
        },
      });
      await tx.userRole.upsert({
        where: { userId_role: { userId, role: 'PROVIDER' } },
        create: { userId, role: 'PROVIDER' },
        update: {},
      });
      await this.audit.recordIn(tx, {
        action: 'provider.profile_created',
        actorId: userId,
        entityType: 'provider_profile',
        entityId: created.id,
        ipAddress,
      });
      return created;
    });
    return toProviderProfile(profile);
  }

  async getMine(userId: string): Promise<ProviderProfile> {
    const profile = await this.prisma.providerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
    if (!profile) throw notFound('PROVIDER_PROFILE_NOT_FOUND', 'Usta profili bulunamadı.');
    return toProviderProfile(profile);
  }

  async updateMine(userId: string, input: UpdateProviderProfileRequest): Promise<ProviderProfile> {
    await this.getMine(userId);
    const profile = await this.prisma.providerProfile.update({ where: { userId }, data: input });
    return toProviderProfile(profile);
  }
}

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
    approvedAt: p.approvedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
