import { Injectable } from '@nestjs/common';

import type { Prisma, Role, UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { userWithProfiles, type UserWithProfiles } from './user.mapper.js';

export interface NewUser {
  email: string;
  phone: string | null;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  providerDisplayName: string | null;
}

export interface UserFilter {
  role?: Role | undefined;
  status?: UserStatus | undefined;
  q?: string | undefined;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findFirst({ where: { id, deletedAt: null }, ...userWithProfiles });
  }

  /** Includes the password hash; only for credential checks. */
  findByEmailForLogin(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, passwordHash: true, status: true },
    });
  }

  async existsWithEmailOrPhone(
    email: string,
    phone: string | null,
  ): Promise<{ email: boolean; phone: boolean }> {
    const rows = await this.prisma.user.findMany({
      where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
      select: { email: true, phone: true },
    });
    return {
      email: rows.some((r) => r.email === email),
      phone: phone !== null && rows.some((r) => r.phone === phone),
    };
  }

  /** Creates the user, its roles and its profiles in one write. */
  create(input: NewUser, tx: Prisma.TransactionClient): Promise<UserWithProfiles> {
    return tx.user.create({
      data: {
        email: input.email,
        phone: input.phone,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: { create: input.roles.map((role) => ({ role })) },
        customerProfile: { create: {} },
        ...(input.providerDisplayName
          ? { providerProfile: { create: { displayName: input.providerDisplayName } } }
          : {}),
      },
      ...userWithProfiles,
    });
  }

  /**
   * Account created by phone sign-in (no e-mail or password yet). The
   * phone is verified by the OTP that created it.
   */
  createWithVerifiedPhone(
    input: { phone: string; firstName: string; lastName: string },
    tx: Prisma.TransactionClient,
  ): Promise<UserWithProfiles> {
    return tx.user.create({
      data: {
        phone: input.phone,
        phoneVerifiedAt: new Date(),
        firstName: input.firstName,
        lastName: input.lastName,
        roles: { create: [{ role: 'CUSTOMER' }] },
        customerProfile: { create: {} },
      },
      ...userWithProfiles,
    });
  }

  /** Includes soft-deleted users: the phone column is unique across all rows. */
  findPhoneOwner(phone: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findUnique({
      where: { phone },
      select: { id: true, status: true, deletedAt: true, phoneVerifiedAt: true },
    });
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  update(id: string, data: Prisma.UserUpdateInput, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.update({ where: { id }, data, ...userWithProfiles });
  }

  /** Newest first; `cursor` is the id of the last item of the previous page. */
  list(filter: UserFilter, limit: number, cursor?: string) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.role ? { roles: { some: { role: filter.role } } } : {}),
      ...(filter.q
        ? {
            OR: [
              { email: { contains: filter.q, mode: 'insensitive' } },
              { phone: { contains: filter.q } },
              { firstName: { contains: filter.q, mode: 'insensitive' } },
              { lastName: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.prisma.user.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      ...userWithProfiles,
    });
  }

  async grantRole(
    userId: string,
    role: Role,
    grantedById: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.userRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role, grantedById },
      update: {},
    });
  }

  async revokeRole(userId: string, role: Role, tx: Prisma.TransactionClient): Promise<void> {
    await tx.userRole.deleteMany({ where: { userId, role } });
  }
}
