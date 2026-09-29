import { detectMimeType, extensionFor, isValidStorageKey } from './file-signature.js';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('detectMimeType', () => {
  it('recognises JPEG, PNG and PDF', () => {
    expect(detectMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(detectMimeType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')],
    ['HTML', Buffer.from('<!doctype html><script>')],
    ['Windows executable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00')],
    ['ELF executable', bytes(0x7f, 0x45, 0x4c, 0x46)],
    ['ZIP', bytes(0x50, 0x4b, 0x03, 0x04)],
    ['GIF', Buffer.from('GIF89a')],
    ['empty file', bytes()],
    ['truncated PNG header', bytes(0x89, 0x50, 0x4e)],
  ])('rejects %s', (_label, prefix) => {
    expect(detectMimeType(prefix)).toBeNull();
  });
});

describe('extensionFor', () => {
  it('maps only allowed types', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(() => extensionFor('image/svg+xml')).toThrow();
  });
});

describe('isValidStorageKey', () => {
  const uuid = '0199f4a0-0000-7000-8000-000000000001';

  it('accepts server-generated keys', () => {
    expect(isValidStorageKey(`verifications/${uuid}/${uuid}.pdf`)).toBe(true);
  });

  it.each([
    `../verifications/${uuid}/${uuid}.pdf`,
    `verifications/${uuid}/../../etc/passwd`,
    `/verifications/${uuid}/${uuid}.pdf`,
    `verifications/${uuid}/${uuid}.svg`,
    `verifications/${uuid}/kimlik.pdf`,
    `verifications\\${uuid}\\${uuid}.pdf`,
  ])('rejects %s', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });
});
