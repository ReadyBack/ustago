import { hashIp } from './client-context.js';

describe('IP hashing (docs/adr/0026)', () => {
  const key = Buffer.from('k'.repeat(32));

  it('is a keyed, stable, non-reversible 64-hex digest', () => {
    const a = hashIp(key, '203.0.113.7');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp(key, ' 203.0.113.7 ')).toBe(a);
    expect(a).not.toContain('203');
    expect(hashIp(Buffer.from('x'.repeat(32)), '203.0.113.7')).not.toBe(a);
  });
});
