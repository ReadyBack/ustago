import { describe, expect, it } from 'vitest';

import { accessReasonError } from './message-reports';

describe('accessReasonError', () => {
  it('needs at least 10 characters after trimming', () => {
    expect(accessReasonError('')).toBe('Gerekçe en az 10 karakter olmalı.');
    expect(accessReasonError('   kısa    ')).toBe('Gerekçe en az 10 karakter olmalı.');
    expect(accessReasonError('123456789')).toBe('Gerekçe en az 10 karakter olmalı.');
    expect(accessReasonError('1234567890')).toBeNull();
    expect(accessReasonError('Taciz şikayeti incelemesi')).toBeNull();
  });

  it('allows at most 500 characters', () => {
    expect(accessReasonError('x'.repeat(500))).toBeNull();
    expect(accessReasonError('x'.repeat(501))).toBe('Gerekçe en fazla 500 karakter olabilir.');
  });
});
