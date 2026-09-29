import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and never keeps the plain text', async () => {
    const encoded = await service.hash('dogru-at-pil-zimba');
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(encoded).not.toContain('dogru-at-pil-zimba');
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([
      service.hash('ayni-sifre-123'),
      service.hash('ayni-sifre-123'),
    ]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const encoded = await service.hash('dogru-sifre-123');
    await expect(service.verify(encoded, 'dogru-sifre-123')).resolves.toBe(true);
    await expect(service.verify(encoded, 'yanlis-sifre-123')).resolves.toBe(false);
  });

  it('treats a malformed hash as a failed match', async () => {
    await expect(service.verify('not-a-hash', 'x')).resolves.toBe(false);
  });

  it('dummy verification always fails', async () => {
    await expect(service.verifyAgainstDummy('anything')).resolves.toBe(false);
  });
});
