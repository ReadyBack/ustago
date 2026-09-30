import { Injectable } from '@nestjs/common';
import type { AdminUserPermissions } from '@ustago/types';
import type { SetAdminPermissionsRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { effectivePermissions } from '../common/auth/permissions.js';
import { forbidden, notFound, unprocessable } from '../common/http/errors.js';
import type { AdminPermission, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Admin permission grants; only ADMIN_SUPER may change them (docs/adr/0024). */
@Injectable()
export class AdminPermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminUserPermissions[]> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, roles: { some: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        roles: { select: { role: true } },
        adminPermissions: { select: { permission: true } },
      },
    });
    return users.map((u) => view(u));
  }

  async set(
    actor: AuthUser,
    userId: string,
    input: SetAdminPermissionsRequest,
    ipAddress: string | null,
  ): Promise<AdminUserPermissions> {
    // No self-elevation (or self-demotion): another super admin must do it.
    if (actor.id === userId) {
      throw forbidden('ADMIN_SELF_PERMISSION_CHANGE', 'Kendi yetkilerinizi değiştiremezsiniz.');
    }
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, roles: { select: { role: true } } },
      });
      if (!target) throw notFound('USER_NOT_FOUND', 'Kullanıcı bulunamadı.');
      const roles = target.roles.map((r) => r.role);
      if (!roles.includes('ADMIN') && !roles.includes('SUPER_ADMIN')) {
        throw unprocessable('USER_NOT_ADMIN', 'Yetki yalnızca yönetici hesaplarına verilebilir.');
      }
      const before = (
        await tx.adminPermissionGrant.findMany({ where: { userId }, select: { permission: true } })
      ).map((g) => g.permission);
      await tx.adminPermissionGrant.deleteMany({
        where: { userId, permission: { notIn: input.permissions } },
      });
      for (const permission of input.permissions) {
        await tx.adminPermissionGrant.upsert({
          where: { userId_permission: { userId, permission } },
          create: { userId, permission, grantedById: actor.id },
          update: {},
        });
      }
      await this.audit.recordIn(tx, {
        action: 'admin.permission.changed',
        actorId: actor.id,
        entityType: 'user',
        entityId: userId,
        ipAddress,
        metadata: { before, after: input.permissions },
      });
      // Existing sessions pick the new grants up on their next request
      // (JwtAuthGuard reads them from the database every time).
      const updated = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          roles: { select: { role: true } },
          adminPermissions: { select: { permission: true } },
        },
      });
      return view(updated);
    });
  }
}

function view(u: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roles: { role: Role }[];
  adminPermissions: { permission: AdminPermission }[];
}): AdminUserPermissions {
  const roles = u.roles.map((r) => r.role);
  const permissions = u.adminPermissions.map((p) => p.permission);
  return {
    userId: u.id,
    name: `${u.firstName} ${u.lastName}`,
    email: u.email,
    roles,
    permissions,
    effective: [...effectivePermissions(roles, permissions)],
  };
}
