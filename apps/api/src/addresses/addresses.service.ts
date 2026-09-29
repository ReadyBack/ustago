import { Injectable } from '@nestjs/common';
import type { Address } from '@ustago/types';
import type { CreateAddressRequest, UpdateAddressRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { notFound, unprocessable } from '../common/http/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Abuse limit; a household rarely needs more than a handful. */
export const MAX_ADDRESSES_PER_USER = 20;

const addressInclude = {
  province: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
} satisfies Prisma.AddressInclude;

type AddressRow = Prisma.AddressGetPayload<{ include: typeof addressInclude }>;

const addressNotFound = () => notFound('ADDRESS_NOT_FOUND', 'Adres bulunamadı.');

type Tx = Prisma.TransactionClient;

/**
 * Customer addresses. Every query is scoped to the caller's user id, so
 * another user's address is indistinguishable from a missing one (no IDOR,
 * no existence leak). Mutations lock the user row first, which serialises
 * concurrent "set default" calls; a partial unique index keeps at most one
 * live default per user even if that lock were bypassed.
 */
@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { id: 'desc' }],
      include: addressInclude,
    });
    return rows.map(toAddress);
  }

  async get(userId: string, id: string): Promise<Address> {
    const row = await this.prisma.address.findFirst({
      where: { id, userId, deletedAt: null },
      include: addressInclude,
    });
    if (!row) throw addressNotFound();
    return toAddress(row);
  }

  async create(userId: string, input: CreateAddressRequest): Promise<Address> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await assertDistrictInProvince(tx, input.provinceId, input.districtId);
      const count = await tx.address.count({ where: { userId, deletedAt: null } });
      if (count >= MAX_ADDRESSES_PER_USER) {
        throw unprocessable(
          'ADDRESS_LIMIT_REACHED',
          `En fazla ${MAX_ADDRESSES_PER_USER} adres kaydedebilirsiniz.`,
        );
      }
      // The first address becomes the default automatically.
      const makeDefault = count === 0 || input.isDefault === true;
      if (makeDefault) await clearDefault(tx, userId);
      return tx.address.create({
        data: {
          userId,
          provinceId: input.provinceId,
          districtId: input.districtId,
          addressLine: input.addressLine,
          label: input.label ?? null,
          neighborhood: input.neighborhood ?? null,
          buildingNo: input.buildingNo ?? null,
          apartmentNo: input.apartmentNo ?? null,
          postalCode: input.postalCode ?? null,
          instructions: input.instructions ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          isDefault: makeDefault,
        },
        include: addressInclude,
      });
    });
    return toAddress(row);
  }

  async update(userId: string, id: string, input: UpdateAddressRequest): Promise<Address> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const current = await tx.address.findFirst({ where: { id, userId, deletedAt: null } });
      if (!current) throw addressNotFound();
      if (input.provinceId !== undefined && input.districtId !== undefined) {
        await assertDistrictInProvince(tx, input.provinceId, input.districtId);
      }
      return tx.address.update({ where: { id }, data: input, include: addressInclude });
    });
    return toAddress(row);
  }

  async setDefault(userId: string, id: string): Promise<Address> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const current = await tx.address.findFirst({ where: { id, userId, deletedAt: null } });
      if (!current) throw addressNotFound();
      if (!current.isDefault) {
        await clearDefault(tx, userId);
        await tx.address.update({ where: { id }, data: { isDefault: true } });
      }
      return tx.address.findUniqueOrThrow({ where: { id }, include: addressInclude });
    });
    return toAddress(row);
  }

  /**
   * Soft delete: past service requests keep pointing at the address. When
   * the default goes, the most recently added remaining address takes over.
   */
  async remove(userId: string, id: string, ipAddress: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const current = await tx.address.findFirst({ where: { id, userId, deletedAt: null } });
      if (!current) throw addressNotFound();
      await tx.address.update({
        where: { id },
        data: { deletedAt: new Date(), isDefault: false },
      });
      if (current.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId, deletedAt: null },
          orderBy: { id: 'desc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await this.audit.recordIn(tx, {
        action: 'address.deleted',
        actorId: userId,
        entityType: 'address',
        entityId: id,
        ipAddress,
      });
    });
  }
}

async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
}

async function clearDefault(tx: Tx, userId: string): Promise<void> {
  await tx.address.updateMany({
    where: { userId, isDefault: true, deletedAt: null },
    data: { isDefault: false },
  });
}

async function assertDistrictInProvince(
  tx: Tx,
  provinceId: number,
  districtId: string,
): Promise<void> {
  const district = await tx.district.findUnique({
    where: { id: districtId },
    select: { provinceId: true, isActive: true },
  });
  if (!district?.isActive) {
    throw unprocessable('DISTRICT_NOT_FOUND', 'İlçe bulunamadı veya aktif değil.');
  }
  if (district.provinceId !== provinceId) {
    throw unprocessable('DISTRICT_PROVINCE_MISMATCH', 'İlçe seçilen ile ait değil.');
  }
}

function toAddress(a: AddressRow): Address {
  return {
    id: a.id,
    label: a.label,
    province: { id: a.province.id, name: a.province.name },
    district: { id: a.district.id, name: a.district.name },
    neighborhood: a.neighborhood,
    addressLine: a.addressLine,
    buildingNo: a.buildingNo,
    apartmentNo: a.apartmentNo,
    postalCode: a.postalCode,
    instructions: a.instructions,
    latitude: a.latitude === null ? null : Number(a.latitude),
    longitude: a.longitude === null ? null : Number(a.longitude),
    isDefault: a.isDefault,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
