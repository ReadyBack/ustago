import { CATEGORIES, DISTRICTS, PROVINCES } from './reference-data.js';
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

  it('has the official district counts for the seeded provinces', () => {
    expect(DISTRICTS[34]).toHaveLength(39);
    expect(DISTRICTS[6]).toHaveLength(25);
    expect(DISTRICTS[35]).toHaveLength(30);
    for (const names of Object.values(DISTRICTS)) {
      expect(new Set(names.map(slugify)).size).toBe(names.length);
    }
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
