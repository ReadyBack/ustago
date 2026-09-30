import type { ActiveSession } from '@ustago/types';

import { ApiError } from '../api/client';
import {
  blockerLabel,
  blockersFromError,
  deletionCancellable,
  deletionOpen,
  hasOpenExport,
  isDeletionConfirmation,
  sessionTitle,
  sortSessions,
} from './account';

const session = (overrides: Partial<ActiveSession> = {}): ActiveSession => ({
  id: 's1',
  current: false,
  deviceName: null,
  platform: null,
  userAgentSummary: null,
  createdApprox: '2026-09-01T10:00:00.000Z',
  lastUsedAt: '2026-09-02T10:00:00.000Z',
  expiresAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const deletion = (status: 'REQUESTED' | 'BLOCKED_BY_ACTIVE_JOB' | 'PROCESSING' | 'CANCELLED') => ({
  id: 'd1',
  status,
  blockers: [],
  requestedAt: '2026-09-01T10:00:00.000Z',
  scheduledFor: null,
  completedAt: null,
});

describe('isDeletionConfirmation', () => {
  it('accepts the phrase, forgiving case, spaces and Turkish i', () => {
    expect(isDeletionConfirmation('HESABIMI SIL')).toBe(true);
    expect(isDeletionConfirmation('  hesabımı   sil ')).toBe(true);
    expect(isDeletionConfirmation('HESABIMI SİL')).toBe(true);
    expect(isDeletionConfirmation('hesabimi sil')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDeletionConfirmation('')).toBe(false);
    expect(isDeletionConfirmation('HESABIMI')).toBe(false);
    expect(isDeletionConfirmation('HESABIMI SILME')).toBe(false);
  });
});

describe('deletion state', () => {
  it('can cancel only while waiting', () => {
    expect(deletionCancellable(deletion('REQUESTED'))).toBe(true);
    expect(deletionCancellable(deletion('BLOCKED_BY_ACTIVE_JOB'))).toBe(true);
    expect(deletionCancellable(deletion('PROCESSING'))).toBe(false);
    expect(deletionCancellable(null)).toBe(false);
    expect(deletionOpen(deletion('PROCESSING'))).toBe(true);
    expect(deletionOpen(deletion('CANCELLED'))).toBe(false);
  });

  it('labels blockers, with a fallback for new codes', () => {
    expect(blockerLabel('ACTIVE_JOB')).toMatch(/Devam eden bir işiniz/);
    expect(blockerLabel('SOMETHING_NEW')).toMatch(/kapanmamış bir işlem/);
  });

  it('reads blockers from an error', () => {
    const e = new ApiError(409, 'BLOCKED_BY_ACTIVE_JOB', 'x', { blockers: ['ACTIVE_JOB', 3] });
    expect(blockersFromError(e)).toEqual(['ACTIVE_JOB']);
    expect(blockersFromError(new Error('x'))).toEqual([]);
    expect(blockersFromError(new ApiError(409, 'X', 'x'))).toEqual([]);
  });

  it('knows when an export is already requested', () => {
    const base = { id: 'e1', requestedAt: '2026-09-01T10:00:00.000Z', readyAt: null };
    expect(hasOpenExport([{ ...base, status: 'REQUESTED' }])).toBe(true);
    expect(hasOpenExport([{ ...base, status: 'EXPIRED' }])).toBe(false);
    expect(hasOpenExport([])).toBe(false);
  });
});

describe('sessions', () => {
  it('names a device', () => {
    expect(sessionTitle(session({ deviceName: 'iPhone 15', platform: 'IOS' }))).toBe(
      'iPhone 15 · iPhone / iPad',
    );
    expect(sessionTitle(session({ platform: 'ANDROID' }))).toBe('Android');
    expect(sessionTitle(session({ userAgentSummary: 'Chrome / macOS' }))).toBe('Chrome / macOS');
    expect(sessionTitle(session())).toBe('Bilinmeyen cihaz');
  });

  it('lists the current device first, then the latest', () => {
    const list = sortSessions([
      session({ id: 'old', lastUsedAt: '2026-09-01T00:00:00.000Z' }),
      session({ id: 'new', lastUsedAt: '2026-09-03T00:00:00.000Z' }),
      session({ id: 'me', current: true, lastUsedAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(list.map((s) => s.id)).toEqual(['me', 'new', 'old']);
  });
});
