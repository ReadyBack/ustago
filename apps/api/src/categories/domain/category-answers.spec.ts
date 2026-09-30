import {
  type CategoryQuestionRow,
  parseQuestionOptions,
  validateCategoryAnswers,
} from './category-answers.js';

const q = (over: Partial<CategoryQuestionRow> & Pick<CategoryQuestionRow, 'key' | 'type'>) =>
  ({
    id: `00000000-0000-7000-8000-${String(over.key.length).padStart(12, '0')}`,
    label: over.key,
    options: null,
    required: false,
    minValue: null,
    maxValue: null,
    isActive: true,
    sortOrder: 0,
    ...over,
  }) satisfies CategoryQuestionRow;

const problem = q({
  key: 'problem',
  label: 'Sorun ne?',
  type: 'SINGLE_SELECT',
  required: true,
  sortOrder: 0,
  // Stored JSON, as Prisma returns it.
  options: [
    { value: 'power_out', label: 'Tamamen elektrik yok' },
    { value: 'breaker_trips', label: 'Sigorta atıyor' },
  ],
});
const rooms = q({
  key: 'rooms',
  label: 'Hangi odalar?',
  type: 'MULTI_SELECT',
  sortOrder: 10,
  options: [
    { value: 'kitchen', label: 'Mutfak' },
    { value: 'bath', label: 'Banyo' },
    { value: 'living', label: 'Salon' },
  ],
});
const urgent = q({ key: 'urgent', label: 'Acil mi?', type: 'BOOLEAN', sortOrder: 20 });
const note = q({ key: 'note', label: 'Not', type: 'SHORT_TEXT', sortOrder: 30 });
const count = q({
  key: 'count',
  label: 'Kaç cihaz?',
  type: 'NUMBER',
  sortOrder: 40,
  minValue: 1,
  maxValue: 20,
});
const retired = q({ key: 'old', label: 'Eski', type: 'BOOLEAN', isActive: false, required: true });

const all = [count, note, urgent, rooms, problem, retired];

describe('validateCategoryAnswers', () => {
  it('builds snapshots in question order with human-readable values', () => {
    const result = validateCategoryAnswers(all, {
      problem: 'breaker_trips',
      rooms: ['living', 'kitchen'],
      urgent: true,
      note: '  Salon   ve mutfak ',
      count: 3,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: [
        {
          questionId: problem.id,
          key: 'problem',
          label: 'Sorun ne?',
          type: 'SINGLE_SELECT',
          value: 'breaker_trips',
          displayValue: 'Sigorta atıyor',
        },
        expect.objectContaining({
          key: 'rooms',
          value: ['kitchen', 'living'],
          displayValue: 'Mutfak, Salon',
        }),
        expect.objectContaining({ key: 'urgent', value: true, displayValue: 'Evet' }),
        expect.objectContaining({ key: 'note', value: 'Salon ve mutfak' }),
        expect.objectContaining({ key: 'count', value: 3, displayValue: '3' }),
      ],
    });
  });

  it('allows optional questions to be skipped; inactive required ones do not count', () => {
    const result = validateCategoryAnswers(all, { problem: 'power_out' });
    expect(result.ok && result.snapshot.map((s) => s.key)).toEqual(['problem']);
    expect(validateCategoryAnswers([], undefined)).toEqual({ ok: true, snapshot: [] });
  });

  it('reports missing required answers', () => {
    for (const missing of [{}, { problem: '' }, { problem: null }]) {
      const result = validateCategoryAnswers(all, missing);
      expect(result).toEqual({
        ok: false,
        errors: [expect.objectContaining({ key: 'problem', code: 'REQUIRED' })],
      });
    }
  });

  it('rejects unknown keys, including keys of inactive questions', () => {
    const result = validateCategoryAnswers(all, { problem: 'power_out', old: true, hack: 'x' });
    expect(!result.ok && result.errors.map((e) => [e.key, e.code])).toEqual([
      ['old', 'UNKNOWN_QUESTION'],
      ['hack', 'UNKNOWN_QUESTION'],
    ]);
  });

  it.each([
    [{ problem: 'fire' }, 'problem', 'INVALID_OPTION'],
    [{ problem: ['power_out'] }, 'problem', 'INVALID_TYPE'],
    [{ problem: 'power_out', rooms: 'kitchen' }, 'rooms', 'INVALID_TYPE'],
    [{ problem: 'power_out', rooms: ['kitchen', 'garage'] }, 'rooms', 'INVALID_OPTION'],
    [{ problem: 'power_out', rooms: ['bath', 'bath'] }, 'rooms', 'INVALID_OPTION'],
    [{ problem: 'power_out', urgent: 'evet' }, 'urgent', 'INVALID_TYPE'],
    [{ problem: 'power_out', note: 42 }, 'note', 'INVALID_TYPE'],
    [{ problem: 'power_out', note: '<b>x</b>' }, 'note', 'INVALID_TEXT'],
    [{ problem: 'power_out', note: 'x'.repeat(201) }, 'note', 'INVALID_TEXT'],
    [{ problem: 'power_out', count: '3' }, 'count', 'INVALID_TYPE'],
    [{ problem: 'power_out', count: Number.POSITIVE_INFINITY }, 'count', 'INVALID_TYPE'],
    [{ problem: 'power_out', count: 0 }, 'count', 'OUT_OF_RANGE'],
    [{ problem: 'power_out', count: 21 }, 'count', 'OUT_OF_RANGE'],
  ])('rejects %j (%s: %s)', (answers, key, code) => {
    const result = validateCategoryAnswers(all, answers);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toEqual([
      expect.objectContaining({ key, code, message: expect.any(String) }),
    ]);
  });

  it('accepts range edges and open ranges', () => {
    expect(validateCategoryAnswers([count], { count: 1 }).ok).toBe(true);
    expect(validateCategoryAnswers([count], { count: 20 }).ok).toBe(true);
    const open = q({ key: 'm2', type: 'NUMBER' });
    expect(validateCategoryAnswers([open], { m2: 125.5 })).toMatchObject({
      ok: true,
      snapshot: [{ value: 125.5, displayValue: '125,5' }],
    });
  });

  it('reads stored options defensively', () => {
    expect(parseQuestionOptions(null)).toEqual([]);
    expect(parseQuestionOptions('x')).toEqual([]);
    expect(
      parseQuestionOptions([{ value: 'a', label: 'A' }, { value: 1, label: 'B' }, null]),
    ).toEqual([{ value: 'a', label: 'A' }]);
  });
});
