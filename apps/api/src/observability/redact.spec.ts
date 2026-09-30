import { REDACTED, redact, redactText } from './redact.js';

describe('log redaction (docs/adr/0026)', () => {
  it('replaces sensitive keys at any depth', () => {
    expect(
      redact({
        user: { phone: '+905321234567', email: 'a@b.co', name: 'Ali' },
        headers: { authorization: 'Bearer x', cookie: 'c' },
        refreshToken: 't',
        iban: 'TR33 0006 1005 1978 6457 8413 26',
        ipAddress: '1.2.3.4',
        amountMinor: 220000,
      }),
    ).toEqual({
      user: { phone: REDACTED, email: REDACTED, name: 'Ali' },
      headers: { authorization: REDACTED, cookie: REDACTED },
      refreshToken: REDACTED,
      iban: REDACTED,
      ipAddress: REDACTED,
      amountMinor: 220000,
    });
  });

  it('masks personal data and connection strings inside free text', () => {
    const text = redactText(
      'Kullanıcı +90 532 123 45 67, ali@example.com, TR330006100519786457841326, 12345678901, postgresql://u:p@h/db',
    );
    expect(text).not.toMatch(/532 123|example\.com|TR3300|12345678901|u:p@h/);
  });
});
