import { describe, expect, it } from 'vitest';

import {
  createUploadIntentRequestSchema,
  sanitizeFileName,
  setProviderServiceAreasRequestSchema,
  setProviderServicesRequestSchema,
} from './providers.js';

const id = (n: number) => `0199f4a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('setProviderServicesRequestSchema', () => {
  it('accepts an empty list', () => {
    expect(setProviderServicesRequestSchema.safeParse({ categoryIds: [] }).success).toBe(true);
  });

  it('rejects duplicates', () => {
    expect(
      setProviderServicesRequestSchema.safeParse({ categoryIds: [id(1), id(1)] }).success,
    ).toBe(false);
  });
});

describe('setProviderServiceAreasRequestSchema', () => {
  it('accepts districts grouped by province', () => {
    const result = setProviderServiceAreasRequestSchema.safeParse({
      areas: [
        { provinceId: 34, districtIds: [id(1), id(2)] },
        { provinceId: 1, districtIds: [id(3)] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    [
      'a province twice',
      [
        { provinceId: 34, districtIds: [id(1)] },
        { provinceId: 34, districtIds: [id(2)] },
      ],
    ],
    [
      'a district twice across provinces',
      [
        { provinceId: 34, districtIds: [id(1)] },
        { provinceId: 1, districtIds: [id(1)] },
      ],
    ],
    ['an empty province group', [{ provinceId: 34, districtIds: [] }]],
  ])('rejects %s', (_label, areas) => {
    expect(setProviderServiceAreasRequestSchema.safeParse({ areas }).success).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\a\\kimlik.pdf', 'kimlik.pdf'],
    ['..\\..\\secret.png', 'secret.png'],
    ['.hidden.pdf', 'hidden.pdf'],
    ['kimlik\u202Efdp.exe', 'kimlikfdp.exe'],
    ['a\u0000b.pdf', 'ab.pdf'],
    ['   ', 'belge'],
    ['Nüfus Cüzdanı <ön yüz>.jpg', 'Nüfus Cüzdanı _ön yüz_.jpg'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('caps the length at 255 characters, keeping the extension', () => {
    const result = sanitizeFileName(`${'a'.repeat(400)}.pdf`);
    expect(result).toHaveLength(255);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('createUploadIntentRequestSchema', () => {
  const valid = {
    type: 'IDENTITY',
    fileName: 'kimlik.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
  };

  it('accepts JPEG, PNG and PDF', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'application/pdf']) {
      expect(createUploadIntentRequestSchema.safeParse({ ...valid, mimeType }).success).toBe(true);
    }
  });

  it.each([
    'image/svg+xml',
    'text/html',
    'application/x-msdownload',
    'application/zip',
    'image/gif',
  ])('rejects %s', (mimeType) => {
    expect(createUploadIntentRequestSchema.safeParse({ ...valid, mimeType }).success).toBe(false);
  });

  it('rejects a zero or negative size', () => {
    expect(createUploadIntentRequestSchema.safeParse({ ...valid, sizeBytes: 0 }).success).toBe(
      false,
    );
  });

  it('sanitises the file name', () => {
    expect(
      createUploadIntentRequestSchema.parse({ ...valid, fileName: '../../x/kimlik.jpg' }).fileName,
    ).toBe('kimlik.jpg');
  });
});
