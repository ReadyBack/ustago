import { ApiError } from '../api/client';
import { isStaleJobError, toJobError } from './job-errors';

describe('job errors', () => {
  it('maps codes to Turkish and marks 409s as stale', () => {
    const e = new ApiError(409, 'JOB_INVALID_TRANSITION', 'Invalid transition');
    expect(isStaleJobError(e)).toBe(true);
    const mapped = toJobError(e);
    expect(mapped).toBeInstanceOf(ApiError);
    expect((mapped as ApiError).message).toBe('İşin mevcut durumunda bu işlem yapılamaz.');
    expect(
      (toJobError(new ApiError(409, 'JOB_HAS_PENDING_CHANGE_ORDER', 'x')) as Error).message,
    ).toBe('Önce bekleyen ek iş talebinin sonuçlanması gerekiyor.');
  });

  it('keeps unknown codes and non-API errors as they are', () => {
    const validation = new ApiError(400, 'VALIDATION_FAILED', 'Açıklama en az 10 karakter olmalı.');
    expect(isStaleJobError(validation)).toBe(false);
    expect(toJobError(validation)).toBe(validation);
    const other = new Error('network');
    expect(isStaleJobError(other)).toBe(false);
    expect(toJobError(other)).toBe(other);
  });
});
