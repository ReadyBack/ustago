'use client';

import { MAX_QUESTION_OPTIONS } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import { type FormEvent, useActionState, useState } from 'react';

import {
  buildCreateQuestionPayload,
  buildUpdateQuestionPayload,
  isSelectType,
  type QuestionDraft,
  type QuestionType,
} from '@/lib/category-content';
import type { ActionState } from '@/lib/form-action';
import { QUESTION_TYPE_LABELS } from '@/lib/labels';

import { createCategoryQuestion, updateCategoryQuestion } from '../../marketplace-actions';

const TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[];

/**
 * Create or edit one category question. The draft is checked with the
 * shared Zod schema before it is sent; the Server Action checks it again.
 * Key and type are fixed once created.
 */
export function QuestionForm(props: {
  mode: 'create' | 'edit';
  categoryId: string;
  questionId?: string;
  initial: QuestionDraft;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(props.initial);
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const result =
      props.mode === 'create'
        ? await createCategoryQuestion(prev, form)
        : await updateCategoryQuestion(prev, form);
    if (result.ok && props.mode === 'create') setDraft(props.initial);
    return result;
  }, {});

  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setOption = (index: number, field: 'value' | 'label', value: string) =>
    setDraft((d) => ({
      ...d,
      options: d.options.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const payload =
      props.mode === 'create'
        ? buildCreateQuestionPayload(draft)
        : buildUpdateQuestionPayload(draft);
    if (!payload.ok) {
      event.preventDefault();
      setClientError(payload.error);
      return;
    }
    setClientError(null);
  }

  const error = clientError ?? state.error;

  return (
    <form
      action={action}
      onSubmit={onSubmit}
      noValidate
      aria-label={props.mode === 'create' ? 'Yeni soru' : `Soruyu düzenle: ${props.initial.label}`}
      style={{ display: 'grid', gap: spacing.sm }}
    >
      <input type="hidden" name="categoryId" value={props.categoryId} />
      {props.questionId ? <input type="hidden" name="questionId" value={props.questionId} /> : null}
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />

      <div className="grid-2">
        <label className="field">
          Anahtar
          <input
            value={draft.key}
            onChange={(e) => set('key', e.target.value)}
            disabled={props.mode === 'edit'}
            placeholder="ornek_anahtar"
            maxLength={40}
          />
        </label>
        <label className="field">
          Tür
          <select
            value={draft.type}
            onChange={(e) => set('type', e.target.value as QuestionType)}
            disabled={props.mode === 'edit'}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {QUESTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {props.mode === 'edit' ? (
        <p className="muted">Anahtar ve tür değiştirilemez; yayınlanmış cevaplar anlamını korur.</p>
      ) : null}

      <label className="field">
        Soru metni
        <input value={draft.label} onChange={(e) => set('label', e.target.value)} maxLength={200} />
      </label>
      <label className="field">
        Yardım metni (isteğe bağlı)
        <input
          value={draft.helpText}
          onChange={(e) => set('helpText', e.target.value)}
          maxLength={300}
        />
      </label>

      {isSelectType(draft.type) ? (
        <fieldset style={{ border: 0, display: 'grid', gap: spacing.xs }}>
          <legend className="muted">
            Seçenekler (en az 2, en fazla {MAX_QUESTION_OPTIONS}; değer küçük harf, rakam ve _)
          </legend>
          {draft.options.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
              <label className="field">
                <span className="sr-only">{i + 1}. seçenek değeri</span>
                <input
                  value={o.value}
                  onChange={(e) => setOption(i, 'value', e.target.value)}
                  placeholder="deger"
                  maxLength={40}
                />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                <span className="sr-only">{i + 1}. seçenek etiketi</span>
                <input
                  value={o.label}
                  onChange={(e) => setOption(i, 'label', e.target.value)}
                  placeholder="Görünen etiket"
                  maxLength={80}
                />
              </label>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== i) }))
                }
                aria-label={`${i + 1}. seçeneği kaldır`}
              >
                Kaldır
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn"
              disabled={draft.options.length >= MAX_QUESTION_OPTIONS}
              onClick={() =>
                setDraft((d) => ({ ...d, options: [...d.options, { value: '', label: '' }] }))
              }
            >
              Seçenek ekle
            </button>
          </div>
        </fieldset>
      ) : null}

      {draft.type === 'NUMBER' ? (
        <div className="grid-2">
          <label className="field">
            En küçük değer (isteğe bağlı)
            <input
              inputMode="numeric"
              value={draft.minValue}
              onChange={(e) => set('minValue', e.target.value)}
            />
          </label>
          <label className="field">
            En büyük değer (isteğe bağlı)
            <input
              inputMode="numeric"
              value={draft.maxValue}
              onChange={(e) => set('maxValue', e.target.value)}
            />
          </label>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: spacing.lg, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ width: 120 }}>
          Sıra
          <input
            inputMode="numeric"
            value={draft.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => set('required', e.target.checked)}
          />
          Zorunlu
        </label>
        {props.mode === 'edit' ? (
          <label className="check">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Aktif (formda gösterilir)
          </label>
        ) : null}
      </div>

      <div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Kaydediliyor…' : props.mode === 'create' ? 'Soruyu ekle' : 'Kaydet'}
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
          {error}
        </p>
      ) : state.ok ? (
        <p role="status" style={{ color: colors.success, fontSize: 14 }}>
          {props.mode === 'create' ? 'Soru eklendi.' : 'Kaydedildi.'}
        </p>
      ) : null}
    </form>
  );
}
