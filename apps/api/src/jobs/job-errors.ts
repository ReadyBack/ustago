import type { JobStatus } from '../generated/prisma/client.js';
import { conflict, forbidden, notFound } from '../common/http/errors.js';

/** Someone else's job looks exactly like a missing one (no existence leak). */
export const jobNotFound = () => notFound('JOB_NOT_FOUND', 'İş bulunamadı.');
export const wrongParty = () =>
  forbidden('JOB_WRONG_PARTY', 'Bu işlemi işin diğer tarafı yapabilir.');
export const invalidTransition = (status: JobStatus) =>
  conflict('JOB_INVALID_TRANSITION', 'İşin mevcut durumunda bu işlem yapılamaz.', { status });
export const pendingChangeOrder = () =>
  conflict(
    'JOB_HAS_PENDING_CHANGE_ORDER',
    'Önce bekleyen ek iş talebinin sonuçlanması gerekiyor.',
  );
export const changeOrderNotFound = () =>
  notFound('CHANGE_ORDER_NOT_FOUND', 'Ek iş talebi bulunamadı.');
