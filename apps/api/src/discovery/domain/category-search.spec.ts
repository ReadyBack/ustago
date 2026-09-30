import { describe, expect, it } from 'vitest';

import { searchCategories } from './category-search.js';

const cats = [
  { id: 'elk', name: 'Elektrik', sortOrder: 10, aliases: ['elektrikçi', 'sigorta attı', 'priz'] },
  { id: 'tes', name: 'Su Tesisatı', sortOrder: 20, aliases: ['tesisatçı', 'su kaçağı', 'musluk'] },
  { id: 'boy', name: 'Boya Badana', sortOrder: 30, aliases: ['boyacı'] },
  { id: 'kli', name: 'Klima', sortOrder: 40, aliases: [] },
  { id: 'kom', name: 'Kombi', sortOrder: 50, aliases: [] },
];

const ids = (q: string) => searchCategories(q, cats, 5).map((h) => h.categoryId);

describe('searchCategories', () => {
  it('matches names regardless of Turkish case and letters', () => {
    expect(searchCategories('ELEKTRİK', cats, 5)[0]).toMatchObject({
      categoryId: 'elk',
      matchKind: 'NAME',
    });
    expect(ids('su tesisati')[0]).toBe('tes');
  });

  it('matches aliases, including inside a longer phrase', () => {
    expect(searchCategories('elektrikçi', cats, 5)[0]).toMatchObject({ categoryId: 'elk', matchKind: 'ALIAS' });
    expect(ids('evde su kaçağı var')).toContain('tes');
    expect(searchCategories('sigorta attı', cats, 5)[0]?.matchedText).toBe('sigorta attı');
  });

  it('matches prefixes', () => {
    expect(searchCategories('kli', cats, 5)[0]).toMatchObject({ categoryId: 'kli', matchKind: 'PREFIX' });
  });

  it('tolerates typos within the budget', () => {
    expect(searchCategories('elektirik', cats, 5)[0]).toMatchObject({ categoryId: 'elk', matchKind: 'FUZZY' });
    expect(ids('kilma')).toContain('kli');
  });

  it('does not guess on short or unrelated words', () => {
    expect(ids('xyzq')).toEqual([]);
    expect(ids('bu')).toEqual([]);
    expect(ids('araba')).toEqual([]);
  });

  it('ranks exact names above fuzzy matches deterministically', () => {
    const both = [
      { id: 'a', name: 'Kombi', sortOrder: 1, aliases: [] },
      { id: 'b', name: 'Komb', sortOrder: 0, aliases: [] },
    ];
    expect(searchCategories('kombi', both, 5).map((h) => h.categoryId)).toEqual(['a', 'b']);
    expect(searchCategories('kombi', both, 5)).toEqual(searchCategories('kombi', both, 5));
  });
});
