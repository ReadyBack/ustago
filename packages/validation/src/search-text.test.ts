import { describe, expect, it } from 'vitest';

import {
  editDistance,
  normalizeSearchText,
  sanitizeQueryForAnalytics,
  typoBudget,
} from './search-text.js';

describe('normalizeSearchText', () => {
  it('folds Turkish letters and case', () => {
    expect(normalizeSearchText('ELEKTRİKÇİ')).toBe('elektrikci');
    expect(normalizeSearchText('Elektrikçi')).toBe('elektrikci');
    expect(normalizeSearchText('IŞIK')).toBe('isik');
    expect(normalizeSearchText('  Klima   bakımı! ')).toBe('klima bakimi');
    expect(normalizeSearchText('Ağaç Kesimi')).toBe('agac kesimi');
  });
});

describe('editDistance', () => {
  it('counts edits and transpositions', () => {
    expect(editDistance('elektirik', 'elektrik')).toBe(1);
    expect(editDistance('klmia', 'klima')).toBe(1);
    expect(editDistance('boya', 'boya')).toBe(0);
    expect(editDistance('nakliye', 'temizlik')).toBeGreaterThan(3);
  });
});

describe('typoBudget', () => {
  it('is strict for short words', () => {
    expect(typoBudget(3)).toBe(0);
    expect(typoBudget(5)).toBe(1);
    expect(typoBudget(9)).toBe(2);
  });
});

describe('sanitizeQueryForAnalytics', () => {
  it('drops digits and e-mail addresses', () => {
    expect(sanitizeQueryForAnalytics('elektrik 0532 123 45 67')).toBe('elektrik');
    expect(sanitizeQueryForAnalytics('ali@example.com')).toBeNull();
    expect(sanitizeQueryForAnalytics('12345')).toBeNull();
  });
});
