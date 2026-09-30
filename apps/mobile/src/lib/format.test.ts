import {
  formatBudget,
  formatDateRange,
  formatDuration,
  formatPhone,
  formatPhoneInput,
  phoneDigits,
  timeAgo,
} from './format';

describe('format', () => {
  it('formats a budget or says none was given', () => {
    expect(formatBudget({ amountMinor: 150000, currency: 'TRY' })).toBe('₺1.500');
    expect(formatBudget(null)).toBe('Bütçe belirtilmedi');
  });

  it('normalises typed phone numbers to the 10 national digits', () => {
    expect(phoneDigits('0500 000 00 01')).toBe('5000000001');
    expect(phoneDigits('+90 500 000 00 01')).toBe('5000000001');
    expect(phoneDigits('5000000001999')).toBe('5000000001');
    expect(formatPhoneInput('5000000001')).toBe('500 000 00 01');
    expect(formatPhoneInput('5000')).toBe('500 0');
    expect(formatPhone('+905000000001')).toBe('+90 500 000 00 01');
    expect(formatPhone(null)).toBe('—');
  });

  it('formats durations and relative times', () => {
    expect(formatDuration(45)).toBe('45 dk');
    expect(formatDuration(120)).toBe('2 saat');
    expect(formatDuration(150)).toBe('2 saat 30 dk');
    expect(formatDuration(null)).toBeNull();
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(timeAgo('2026-09-30T11:59:30Z', now)).toBe('az önce');
    expect(timeAgo('2026-09-30T11:55:00Z', now)).toBe('5 dk önce');
    expect(timeAgo('2026-09-30T09:00:00Z', now)).toBe('3 saat önce');
    expect(timeAgo('2026-09-29T12:00:00Z', now)).toBe('dün');
  });

  it('shows a time range without repeating the day', () => {
    expect(formatDateRange(null, null)).toBe('—');
    const start = new Date(2026, 9, 12, 14, 0).toISOString();
    const end = new Date(2026, 9, 12, 18, 0).toISOString();
    const range = formatDateRange(start, end);
    expect(range).toContain('12 Ekim');
    expect(range).toMatch(/14:00 – 18:00$/);
  });
});
