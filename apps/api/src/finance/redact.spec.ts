import { redact, redactHeaders } from './redact.js';

describe('redact', () => {
  it('removes secrets, signatures, card data and IBANs from logged payloads', () => {
    const out = JSON.stringify(
      redact({
        type: 'payment.succeeded',
        data: {
          cardNumber: '4111111111111111',
          cvv: '123',
          token: 'tok_live_abc',
          iban: 'TR330006100519786457841326',
          note: 'kart 5555444433332222 ile ödendi',
          nested: [{ apiKey: 'k', amountMinor: '220000' }],
        },
      }),
    );
    expect(out).not.toContain('4111111111111111');
    expect(out).not.toContain('5555444433332222');
    expect(out).not.toContain('123"');
    expect(out).not.toContain('tok_live_abc');
    expect(out).not.toContain('TR330006100519786457841326');
    expect(out).toContain('220000');
    expect(out).toContain('payment.succeeded');
  });

  it('redacts signature and authorization headers', () => {
    const headers = redactHeaders({
      authorization: 'Bearer x',
      'ustago-mock-signature': 't=1,v1=abc',
      'content-type': 'application/json',
    });
    expect(headers).toEqual({
      authorization: '[redacted]',
      'ustago-mock-signature': '[redacted]',
      'content-type': 'application/json',
    });
  });
});
