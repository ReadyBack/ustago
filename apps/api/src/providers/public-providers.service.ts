import { Injectable } from '@nestjs/common';
import type { PublicProviderProfile } from '@ustago/types';

import { notFound } from '../common/http/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { publicProviderInclude, toPublicProvider } from './provider.mappers.js';

/** Customer-facing provider data. Only ACTIVE providers are visible. */
@Injectable()
export class PublicProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<PublicProviderProfile> {
    const provider = await this.prisma.providerProfile.findFirst({
      where: { id, status: 'ACTIVE', deletedAt: null, user: { status: 'ACTIVE', deletedAt: null } },
      include: publicProviderInclude,
    });
    if (!provider) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');
    return toPublicProvider(provider);
  }
}
