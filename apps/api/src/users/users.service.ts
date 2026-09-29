import { Injectable } from '@nestjs/common';
import type { CurrentUser, Device, Paginated } from '@ustago/types';
import type {
  ListUsersQuery,
  RegisterDeviceRequest,
  StaffRole,
  UpdateMeRequest,
  UpdateUserStatusRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { SessionsRepository } from '../auth/sessions.repository.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { forbidden, notFound } from '../common/http/errors.js';
import type { Device as DeviceRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { effectiveRoles } from '../auth/roles.guard.js';
import { toCurrentUser } from './user.mapper.js';
import { UsersRepository } from './users.repository.js';

const USER_NOT_FOUND = () => notFound('USER_NOT_FOUND', 'Kullanıcı bulunamadı.');

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditService,
  ) {}

  async getById(id: string): Promise<CurrentUser> {
    const user = await this.users.findById(id);
    if (!user) throw USER_NOT_FOUND();
    return toCurrentUser(user);
  }

  async updateMe(userId: string, input: UpdateMeRequest): Promise<CurrentUser> {
    return toCurrentUser(await this.users.update(userId, input));
  }

  async list(query: ListUsersQuery): Promise<Paginated<CurrentUser>> {
    const rows = await this.users.list(
      { role: query.role, status: query.status, q: query.q },
      query.limit,
      query.cursor,
    );
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toCurrentUser),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Suspends, bans or reactivates an account. Staff accounts can only be
   * changed by a SUPER_ADMIN, and nobody can change their own status.
   * Disabling an account ends all of its sessions.
   */
  async updateStatus(
    actor: AuthUser,
    targetId: string,
    input: UpdateUserStatusRequest,
    ipAddress: string | null,
  ): Promise<CurrentUser> {
    if (actor.id === targetId) {
      throw forbidden('CANNOT_CHANGE_SELF', 'Kendi hesabınızın durumunu değiştiremezsiniz.');
    }
    const target = await this.users.findById(targetId);
    if (!target) throw USER_NOT_FOUND();
    const targetIsStaff = effectiveRoles(target.roles.map((r) => r.role)).has('ADMIN');
    if (targetIsStaff && !actor.roles.includes('SUPER_ADMIN')) {
      throw forbidden('FORBIDDEN', 'Yönetici hesaplarını yalnızca süper yönetici değiştirebilir.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await this.users.update(targetId, { status: input.status }, tx);
      if (input.status !== 'ACTIVE') {
        await this.sessions.revokeAllForUser(targetId, `ADMIN_${input.status}`, tx);
      }
      await this.audit.recordIn(tx, {
        action: 'user.status_changed',
        actorId: actor.id,
        entityType: 'user',
        entityId: targetId,
        ipAddress,
        metadata: { from: target.status, to: input.status, reason: input.reason },
      });
      return user;
    });
    return toCurrentUser(updated);
  }

  async grantStaffRole(
    actor: AuthUser,
    targetId: string,
    role: StaffRole,
    ipAddress: string | null,
  ): Promise<CurrentUser> {
    if (!(await this.users.findById(targetId))) throw USER_NOT_FOUND();
    await this.prisma.$transaction(async (tx) => {
      await this.users.grantRole(targetId, role, actor.id, tx);
      await this.audit.recordIn(tx, {
        action: 'user.role_granted',
        actorId: actor.id,
        entityType: 'user',
        entityId: targetId,
        ipAddress,
        metadata: { role },
      });
    });
    return this.getById(targetId);
  }

  async revokeStaffRole(
    actor: AuthUser,
    targetId: string,
    role: StaffRole,
    ipAddress: string | null,
  ): Promise<CurrentUser> {
    if (actor.id === targetId && role === 'SUPER_ADMIN') {
      throw forbidden('CANNOT_CHANGE_SELF', 'Kendi süper yönetici rolünüzü kaldıramazsınız.');
    }
    if (!(await this.users.findById(targetId))) throw USER_NOT_FOUND();
    await this.prisma.$transaction(async (tx) => {
      await this.users.revokeRole(targetId, role, tx);
      await this.audit.recordIn(tx, {
        action: 'user.role_revoked',
        actorId: actor.id,
        entityType: 'user',
        entityId: targetId,
        ipAddress,
        metadata: { role },
      });
    });
    return this.getById(targetId);
  }

  /**
   * Registers this app install for push notifications and links it to the
   * current session. A push token moves to the latest user who registers it
   * (e.g. a shared phone after sign-out and sign-in as someone else).
   */
  async registerDevice(user: AuthUser, input: RegisterDeviceRequest): Promise<Device> {
    const data = {
      userId: user.id,
      platform: input.platform,
      pushProvider: input.pushProvider ?? null,
      deviceName: input.deviceName ?? null,
      appVersion: input.appVersion ?? null,
      lastSeenAt: new Date(),
      revokedAt: null,
    };
    const device = input.pushToken
      ? await this.prisma.device.upsert({
          where: { pushToken: input.pushToken },
          create: { ...data, pushToken: input.pushToken },
          update: data,
        })
      : await this.prisma.device.create({ data });
    await this.sessions.attachDevice(user.sessionId, device.id);
    return toDevice(device);
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    const { count } = await this.prisma.device.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date(), pushToken: null },
    });
    if (count === 0) throw notFound('DEVICE_NOT_FOUND', 'Cihaz bulunamadı.');
  }
}

function toDevice(device: DeviceRow): Device {
  return {
    id: device.id,
    platform: device.platform,
    pushProvider: device.pushProvider,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
  };
}
