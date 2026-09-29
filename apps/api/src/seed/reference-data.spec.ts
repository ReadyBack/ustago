import { CATEGORIES, DISTRICTS, PROVINCES, TURKEY_DISTRICT_COUNT } from './reference-data.js';
import { slugify } from './slugify.js';

describe('reference data', () => {
  it('lists all 81 provinces with unique plate codes 1-81', () => {
    const ids = PROVINCES.map(([id]) => id);
    expect(ids).toHaveLength(81);
    expect(new Set(ids).size).toBe(81);
    expect(Math.min(...ids)).toBe(1);
    expect(Math.max(...ids)).toBe(81);
  });

  it('has unique province slugs', () => {
    const slugs = PROVINCES.map(([, name]) => slugify(name));
    expect(new Set(slugs).size).toBe(81);
  });

  it('covers every province with all 973 districts', () => {
    const provinceIds = Object.keys(DISTRICTS).map(Number);
    expect(provinceIds.sort((a, b) => a - b)).toEqual(PROVINCES.map(([id]) => id));
    const total = Object.values(DISTRICTS).reduce((sum, names) => sum + names.length, 0);
    expect(total).toBe(973);
    expect(TURKEY_DISTRICT_COUNT).toBe(973);
    for (const names of Object.values(DISTRICTS)) expect(names.length).toBeGreaterThan(0);
  });

  it('has the official district counts of sample provinces', () => {
    expect(DISTRICTS[34]).toHaveLength(39); // İstanbul
    expect(DISTRICTS[6]).toHaveLength(25); // Ankara
    expect(DISTRICTS[35]).toHaveLength(30); // İzmir
    expect(DISTRICTS[1]).toHaveLength(15); // Adana
    expect(DISTRICTS[7]).toHaveLength(19); // Antalya
    expect(DISTRICTS[16]).toHaveLength(17); // Bursa
    expect(DISTRICTS[74]).toHaveLength(4); // Bartın
    expect(DISTRICTS[34]).toContain('Eyüpsultan');
    expect(DISTRICTS[55]).toContain('19 Mayıs');
  });

  it('keeps Turkish spelling and yields unique slugs within each province', () => {
    for (const names of Object.values(DISTRICTS)) {
      expect(new Set(names.map(slugify)).size).toBe(names.length);
      for (const name of names) {
        expect(name).toBe(name.trim());
        expect(slugify(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    }
    expect(DISTRICTS[6]).toContain('Şereflikoçhisar');
    expect(DISTRICTS[76]).toContain('Tuzluca'); // Iğdır
  });

  it('seeds the starting categories with unique slugs', () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual([
      'Klima',
      'Elektrik',
      'Su Tesisatı',
      'Çilingir',
      'Beyaz Eşya',
      'Boya / Badana',
      'Temizlik',
      'Montaj',
    ]);
    expect(new Set(CATEGORIES.map((c) => c.slug)).size).toBe(CATEGORIES.length);
  });
});

describe('slugify', () => {
  it.each([
    ['İstanbul', 'istanbul'],
    ['Şanlıurfa', 'sanliurfa'],
    ['Iğdır', 'igdir'],
    ['Çilingir', 'cilingir'],
    ['Boya / Badana', 'boya-badana'],
    ['Şereflikoçhisar', 'sereflikochisar'],
    ['Eyüpsultan', 'eyupsultan'],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
