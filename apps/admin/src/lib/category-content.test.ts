import { describe, expect, it } from 'vitest';

import {
  aliasError,
  buildCreateQuestionPayload,
  buildUpdateQuestionPayload,
  draftFromQuestion,
  emptyDraft,
  parseDraft,
  type QuestionDraft,
} from './category-content';

const draft = (overrides: Partial<QuestionDraft> = {}): QuestionDraft => ({
  ...emptyDraft(10),
  key: 'ariza_turu',
  label: 'Arıza türü nedir?',
  options: [
    { value: 'su_kacagi', label: 'Su kaçağı' },
    { value: 'isitmiyor', label: 'Isıtmıyor' },
  ],
  ...overrides,
});

describe('buildCreateQuestionPayload', () => {
  it('builds a select question with trimmed options', () => {
    const result = buildCreateQuestionPayload(
      draft({
        helpText: '  ',
        options: [
          { value: ' a ', label: ' A ' },
          { value: 'b', label: 'B' },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      body: {
        key: 'ariza_turu',
        label: 'Arıza türü nedir?',
        helpText: null,
        type: 'SINGLE_SELECT',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        required: false,
        sortOrder: 10,
      },
    });
  });

  it('sends no options for non-select types and min/max only for NUMBER', () => {
    const text = buildCreateQuestionPayload(draft({ type: 'SHORT_TEXT', minValue: '1' }));
    expect(text.ok && text.body).toMatchObject({ type: 'SHORT_TEXT' });
    expect(text.ok && 'options' in text.body).toBe(false);
    expect(text.ok && 'minValue' in text.body).toBe(false);

    const num = buildCreateQuestionPayload(
      draft({ type: 'NUMBER', key: 'metrekare', minValue: '10', maxValue: '' }),
    );
    expect(num.ok && num.body).toMatchObject({ type: 'NUMBER', minValue: 10, maxValue: null });
  });

  it('rejects bad keys, short labels, too few or duplicate options', () => {
    expect(buildCreateQuestionPayload(draft({ key: 'Arıza' }))).toEqual({
      ok: false,
      error: 'Anahtar küçük harfle başlamalı; harf, rakam ve _ içerir.',
    });
    expect(buildCreateQuestionPayload(draft({ label: 'Ne' }))).toEqual({
      ok: false,
      error: 'Soru metni 3–200 karakter olmalı.',
    });
    expect(
      buildCreateQuestionPayload(draft({ options: [{ value: 'a', label: 'A' }] })),
    ).toMatchObject({ ok: false, error: 'Seçmeli sorular en az iki farklı seçenek ister.' });
    expect(
      buildCreateQuestionPayload(
        draft({
          options: [
            { value: 'a', label: 'A' },
            { value: 'a', label: 'B' },
          ],
        }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      buildCreateQuestionPayload(
        draft({
          options: [
            { value: 'a', label: 'A' },
            { value: 'B-1', label: 'B' },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: '2. seçenek: değer küçük harf, rakam ve _ olmalı (en fazla 40).',
    });
  });

  it('checks NUMBER bounds and the sort order', () => {
    expect(
      buildCreateQuestionPayload(draft({ type: 'NUMBER', minValue: '10', maxValue: '5' })),
    ).toEqual({ ok: false, error: 'En büyük değer en küçükten küçük olamaz.' });
    expect(buildCreateQuestionPayload(draft({ type: 'NUMBER', minValue: '1,5' }))).toEqual({
      ok: false,
      error: 'En küçük değer bir tam sayı olmalı.',
    });
    expect(buildCreateQuestionPayload(draft({ sortOrder: '-1' }))).toEqual({
      ok: false,
      error: 'Sıra 0–10000 arasında bir tam sayı olmalı.',
    });
    expect(buildCreateQuestionPayload(draft({ sortOrder: '20000' }))).toMatchObject({
      ok: false,
    });
  });
});

describe('buildUpdateQuestionPayload', () => {
  const question = {
    id: '0190a000-0000-7000-8000-00000000000a',
    key: 'metrekare',
    label: 'Kaç metrekare?',
    helpText: null,
    type: 'NUMBER' as const,
    options: [],
    required: true,
    minValue: 1,
    maxValue: 1000,
    sortOrder: 20,
    isActive: true,
  };

  it('never sends key or type; deactivating is an isActive flag', () => {
    const result = buildUpdateQuestionPayload({ ...draftFromQuestion(question), isActive: false });
    expect(result).toEqual({
      ok: true,
      body: {
        label: 'Kaç metrekare?',
        helpText: null,
        required: true,
        minValue: 1,
        maxValue: 1000,
        sortOrder: 20,
        isActive: false,
      },
    });
  });

  it('round-trips through the posted JSON draft', () => {
    const d = draftFromQuestion(question);
    expect(parseDraft(JSON.stringify(d))).toEqual(d);
    expect(parseDraft('not json')).toBeNull();
    expect(parseDraft('null')).toBeNull();
  });
});

describe('aliasError', () => {
  it('mirrors createCategoryAliasSchema (2–80 characters)', () => {
    expect(aliasError('kombi tamiri')).toBeNull();
    expect(aliasError(' a ')).toBe('Eş anlamlı ifade 2–80 karakter olmalı.');
    expect(aliasError('x'.repeat(81))).not.toBeNull();
  });
});
