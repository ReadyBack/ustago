import { questionFixture } from '../../test/customer-fixtures';
import {
  answerLabel,
  answersPayload,
  photoPolicyError,
  scheduleWindow,
  validateAnswers,
  validateBudget,
  windowAvailable,
} from './wizard';

describe('question step validation', () => {
  const required = questionFixture();
  const optionalNumber = questionFixture({
    id: 'qq-2',
    key: 'socket_count',
    label: 'Kaç priz?',
    type: 'NUMBER',
    options: [],
    required: false,
    minValue: 1,
    maxValue: 20,
  });

  it('blocks a missing required answer', () => {
    expect(validateAnswers([required, optionalNumber], {})).toEqual({
      power_state: 'Bu soru zorunlu.',
    });
  });

  it('accepts a required answer and skips an empty optional one', () => {
    expect(validateAnswers([required, optionalNumber], { power_state: 'all' })).toEqual({});
  });

  it('checks number bounds and type', () => {
    expect(validateAnswers([optionalNumber], { socket_count: 0 })).toEqual({
      socket_count: 'En az 1 olmalı.',
    });
    expect(validateAnswers([optionalNumber], { socket_count: 25 })).toEqual({
      socket_count: 'En fazla 20 olabilir.',
    });
    expect(validateAnswers([optionalNumber], { socket_count: 'iki' })).toEqual({
      socket_count: 'Lütfen bir sayı girin.',
    });
  });

  it('treats an empty multi select and blank text as unanswered', () => {
    const multi = questionFixture({ key: 'rooms', type: 'MULTI_SELECT' });
    const text = questionFixture({ key: 'brand', type: 'SHORT_TEXT', options: [] });
    expect(validateAnswers([multi, text], { rooms: [], brand: '   ' })).toEqual({
      rooms: 'Bu soru zorunlu.',
      brand: 'Bu soru zorunlu.',
    });
  });

  it('sends only answered questions and shows readable labels', () => {
    const bool = questionFixture({
      key: 'has_meter',
      type: 'BOOLEAN',
      options: [],
      required: false,
    });
    const answers = { power_state: 'partial', has_meter: false, other: undefined };
    expect(answersPayload([required, bool], answers)).toEqual({
      power_state: 'partial',
      has_meter: false,
    });
    expect(answerLabel(required, 'partial')).toBe('Bazı prizler');
    expect(answerLabel(bool, false)).toBe('Hayır');
    expect(answerLabel(required, undefined)).toBe('Cevaplanmadı');
  });
});

describe('budget step validation', () => {
  it('allows no budget at all', () => {
    expect(validateBudget('', '')).toEqual({ error: null, minMinor: null, maxMinor: null });
  });

  it('accepts a single amount and a range with min ≤ max', () => {
    expect(validateBudget('1.500', '')).toEqual({ error: null, minMinor: 150000, maxMinor: null });
    expect(validateBudget('1500', '2000')).toEqual({
      error: null,
      minMinor: 150000,
      maxMinor: 200000,
    });
    // An equal upper bound is just a single amount.
    expect(validateBudget('1500', '1500').maxMinor).toBeNull();
  });

  it('rejects max below min, a max without a min and bad input', () => {
    expect(validateBudget('2000', '1500').error).toBe(
      'Bütçe aralığının üst sınırı alt sınırdan küçük olamaz.',
    );
    expect(validateBudget('', '1500').error).toBe('Aralık için en az tutarı da girin.');
    expect(validateBudget('abc', '').error).toBe('Tutarı 1.500 veya 1500,50 biçiminde yazın.');
  });
});

describe('photo policy', () => {
  it('requires a photo only for REQUIRED', () => {
    expect(photoPolicyError('REQUIRED', 0)).toMatch(/en az bir fotoğraf/);
    expect(photoPolicyError('REQUIRED', 1)).toBeNull();
    expect(photoPolicyError('RECOMMENDED', 0)).toBeNull();
  });
});

describe('schedule', () => {
  const morning = new Date(2026, 8, 30, 8, 0, 0);
  const evening = new Date(2026, 8, 30, 20, 30, 0);

  it('has no window for NOW', () => {
    expect(scheduleWindow('NOW', 'ANY', 0, morning)).toEqual({ start: null, end: null });
  });

  it('builds tomorrow morning and a picked date', () => {
    const w = scheduleWindow('TOMORROW', 'MORNING', 0, morning);
    expect(new Date(w.start ?? '').getDate()).toBe(1);
    expect(new Date(w.start ?? '').getHours()).toBe(9);
    expect(new Date(w.end ?? '').getHours()).toBe(12);
    const d = scheduleWindow('DATE', 'EVENING', 3, morning);
    expect(new Date(d.start ?? '').getDate()).toBe(3);
  });

  it('never starts in the past and hides windows that ended today', () => {
    const w = scheduleWindow('TODAY', 'EVENING', 0, evening);
    expect(new Date(w.start ?? '').getTime()).toBe(evening.getTime());
    expect(windowAvailable('TODAY', 'MORNING', evening)).toBe(false);
    expect(windowAvailable('TODAY', 'EVENING', evening)).toBe(true);
    expect(windowAvailable('TOMORROW', 'MORNING', evening)).toBe(true);
  });
});
