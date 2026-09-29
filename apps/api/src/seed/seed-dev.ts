import { randomBytes } from 'node:crypto';

import { hash } from '@node-rs/argon2';

import type { PrismaClient, Role } from '../generated/prisma/client.js';

interface DevUser {
  email: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  provider?: { displayName: string; categories: string[]; districts: string[] };
}

/** `.test` is a reserved TLD, so these addresses can never reach a real inbox. */
export const DEV_USERS: readonly DevUser[] = [
  {
    email: 'admin@ustago.test',
    firstName: 'Dev',
    lastName: 'Admin',
    roles: ['CUSTOMER', 'SUPER_ADMIN'],
  },
  { email: 'musteri@ustago.test', firstName: 'Ayşe', lastName: 'Müşteri', roles: ['CUSTOMER'] },
  {
    email: 'usta@ustago.test',
    firstName: 'Mehmet',
    lastName: 'Usta',
    roles: ['CUSTOMER', 'PROVIDER'],
    provider: {
      displayName: 'Mehmet Usta Elektrik & Tesisat',
      categories: ['elektrik', 'su-tesisati'],
      districts: ['kadikoy', 'uskudar', 'atasehir'],
    },
  },
];

export interface DevSeedResult {
  created: string[];
  existing: string[];
  /** Only set when the seed generated the password itself. */
  generatedPassword: string | null;
}

/**
 * Development-only demo accounts. The password comes from SEED_DEV_PASSWORD
 * or is generated once and printed by the caller; it is never stored in the
 * repository. Existing accounts keep their password unless
 * SEED_DEV_PASSWORD is set.
 */
export async function seedDevData(
  prisma: PrismaClient,
  passwordFromEnv: string | undefined,
): Promise<DevSeedResult> {
  const generatedPassword = passwordFromEnv ? null : randomBytes(12).toString('base64url');
  const password = passwordFromEnv ?? generatedPassword ?? '';
  if (password.length < 10) throw new Error('SEED_DEV_PASSWORD must be at least 10 characters.');
  const passwordHash = await hash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2 });

  // Dev convenience: open İstanbul so the demo provider's districts are live.
  await prisma.province.update({ where: { id: 34 }, data: { isActive: true } });

  const result: DevSeedResult = { created: [], existing: [], generatedPassword: null };
  for (const devUser of DEV_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: devUser.email } });
    if (existing) {
      result.existing.push(devUser.email);
      if (passwordFromEnv) {
        await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
      }
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: devUser.email,
          passwordHash,
          firstName: devUser.firstName,
          lastName: devUser.lastName,
          emailVerifiedAt: new Date(),
          roles: { create: devUser.roles.map((role) => ({ role })) },
          customerProfile: { create: {} },
        },
      });
      if (devUser.provider) {
        const categories = await tx.serviceCategory.findMany({
          where: { slug: { in: devUser.provider.categories } },
        });
        const districts = await tx.district.findMany({
          where: { provinceId: 34, slug: { in: devUser.provider.districts } },
        });
        const profile = await tx.providerProfile.create({
          data: {
            userId: user.id,
            displayName: devUser.provider.displayName,
            status: 'ACTIVE',
            approvedAt: new Date(),
            nowEnabled: true,
            yearsOfExperience: 12,
            services: { create: categories.map((c) => ({ categoryId: c.id })) },
            serviceAreas: { create: districts.map((d) => ({ districtId: d.id })) },
          },
        });
        await tx.providerScore.create({
          data: {
            providerId: profile.id,
            score: '50.00',
            isNewProvider: true,
            algorithmVersion: 'seed',
            computedAt: new Date(),
          },
        });
      }
    });
    result.created.push(devUser.email);
  }

  if (result.created.length > 0) result.generatedPassword = generatedPassword;
  return result;
}
