import { Injectable } from '@nestjs/common';
import type { ActiveSession } from '@ustago/types';

import { AuditService } from '../audit/audit.service.js';
import { SessionsRepository } from '../auth/sessions.repository.js';
import { notFound } from '../common/http/errors.js';

const HOUR_MS = 60 * 60 * 1000;

/** "Aktif Oturumlar": list and revoke the caller's own sessions. */
@Injectable()
export class SessionsService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, currentSessionId: string): Promise<ActiveSession[]> {
    const rows = await this.sessions.listActive(userId);
    return rows.map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      deviceName: s.device?.deviceName ?? null,
      platform: s.device?.platform ?? (s.userAgent ? 'WEB' : null),
      userAgentSummary: summarizeUserAgent(s.userAgent),
      // Rounded down to the hour: enough to recognise a sign-in.
      createdApprox: new Date(Math.floor(s.createdAt.getTime() / HOUR_MS) * HOUR_MS).toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
  }

  async revoke(userId: string, sessionId: string, ipAddress: string | null): Promise<void> {
    const ok = await this.sessions.revokeOwn(userId, sessionId, 'USER_REVOKED');
    // Someone else's session id looks exactly like a missing one.
    if (!ok) throw notFound('SESSION_NOT_FOUND', 'Oturum bulunamadı.');
    await this.sessions.releaseDeviceOf(sessionId);
    await this.audit.record({
      action: 'auth.session_revoked',
      actorId: userId,
      entityType: 'session',
      entityId: sessionId,
      ipAddress,
    });
  }
}

/** "Chrome · macOS" style label; the full user agent is never returned. */
export function summarizeUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /Expo|okhttp|CFNetwork|Dalvik/i.test(ua)
            ? 'UstaBulHemen uygulaması'
            : null;
  const os = /iPhone|iPad|iOS/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Bilinmeyen cihaz';
}
