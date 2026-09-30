import {
  categoryQuestionSchema,
  MAX_CATEGORY_ALIASES,
  MAX_CATEGORY_QUESTIONS,
  requestFormSchema,
  requestPhotoPolicySchema,
  uuidSchema,
} from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ApiErrorNotice } from '@/components/api-error';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { draftFromQuestion, emptyDraft } from '@/lib/category-content';
import { PHOTO_POLICY_LABELS, QUESTION_TYPE_LABELS } from '@/lib/labels';
import { categoryAliasSchema } from '@/lib/marketplace-schemas';
import { categoryTreeSchema } from '@/lib/schemas';

import {
  addCategoryAlias,
  removeCategoryAlias,
  setCategoryPhotoPolicy,
  setCategoryQuestionActive,
} from '../../marketplace-actions';
import { ModerationForm } from '../../moderation-form';
import { QuestionForm } from './question-form';

export default async function CategoryContentPage(props: PageProps<'/categories/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/categories/${id.data}`);

  const [tree, questions, aliases, form] = await Promise.all([
    apiRequest('/categories', { schema: categoryTreeSchema }),
    apiRequest(`/admin/categories/${id.data}/questions`, {
      schema: z.array(categoryQuestionSchema),
    }),
    apiRequest(`/admin/categories/${id.data}/aliases`, { schema: z.array(categoryAliasSchema) }),
    apiRequest(`/categories/${id.data}/request-form`, { schema: requestFormSchema }),
  ]);

  const flat = tree.ok ? tree.data.flatMap((p) => [p, ...p.children]) : [];
  const category = flat.find((c) => c.id === id.data);
  const name = category?.name ?? (form.ok ? form.data.category.name : 'Kategori');
  const sorted = questions.ok
    ? [...questions.data].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
      )
    : [];
  const nextSort = sorted.length > 0 ? Math.max(...sorted.map((q) => q.sortOrder)) + 10 : 0;

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href="/categories">← Kategori içerikleri</Link>
      <h1>{name}</h1>

      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Talep formu soruları</h2>
        <p className="muted">
          Sorular silinmez; artık sorulmaması gereken bir soruyu pasifleştirin. Yayınlanmış talepler
          cevaplarını, soru değişse de, gönderildiği haliyle saklar. Bir kategoride en fazla{' '}
          {MAX_CATEGORY_QUESTIONS} soru olabilir.
        </p>
        {!questions.ok ? (
          <ApiErrorNotice error={questions} what="Sorular" />
        ) : sorted.length === 0 ? (
          <p>Bu kategoride soru yok.</p>
        ) : (
          <ol style={{ display: 'grid', gap: spacing.md, paddingLeft: 20 }}>
            {sorted.map((q) => (
              <li key={q.id} style={{ display: 'grid', gap: spacing.xs }}>
                <div
                  style={{
                    display: 'flex',
                    gap: spacing.sm,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <strong>{q.label}</strong>
                  <span className="pill pill-neutral">{QUESTION_TYPE_LABELS[q.type]}</span>
                  {q.required ? <span className="pill pill-warning">Zorunlu</span> : null}
                  <span className={`pill ${q.isActive ? 'pill-success' : 'pill-neutral'}`}>
                    {q.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                  <code className="muted">{q.key}</code>
                  <span className="muted">sıra {q.sortOrder}</span>
                </div>
                {q.helpText ? <span className="muted">{q.helpText}</span> : null}
                {q.options.length > 0 ? (
                  <span className="muted">
                    Seçenekler: {q.options.map((o) => `${o.label} (${o.value})`).join(', ')}
                  </span>
                ) : null}
                {q.type === 'NUMBER' ? (
                  <span className="muted">
                    Aralık: {q.minValue ?? '—'} – {q.maxValue ?? '—'}
                  </span>
                ) : null}
                <div className="actions">
                  <details>
                    <summary>Düzenle</summary>
                    <div style={{ marginTop: spacing.sm, maxWidth: 640 }}>
                      <QuestionForm
                        mode="edit"
                        categoryId={id.data}
                        questionId={q.id}
                        initial={draftFromQuestion(q)}
                      />
                    </div>
                  </details>
                  <ModerationForm
                    action={setCategoryQuestionActive}
                    hidden={{
                      categoryId: id.data,
                      questionId: q.id,
                      isActive: q.isActive ? 'false' : 'true',
                    }}
                    submitLabel={q.isActive ? 'Pasifleştir' : 'Yeniden etkinleştir'}
                    tone={q.isActive ? 'danger' : undefined}
                    label={`${q.label}: ${q.isActive ? 'pasifleştir' : 'etkinleştir'}`}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
        {questions.ok ? (
          <details>
            <summary>Yeni soru ekle</summary>
            <div style={{ marginTop: spacing.sm, maxWidth: 640 }}>
              <QuestionForm mode="create" categoryId={id.data} initial={emptyDraft(nextSort)} />
            </div>
          </details>
        ) : null}
      </section>

      <section className="card" style={{ display: 'grid', gap: spacing.md }}>
        <h2>Arama eş anlamlıları</h2>
        <p className="muted">
          Müşterinin aramada yazabileceği diğer ifadeler (ör. “kombi tamiri” → Kombi Servisi). En
          fazla {MAX_CATEGORY_ALIASES} ifade.
        </p>
        {!aliases.ok ? (
          <ApiErrorNotice error={aliases} what="Eş anlamlılar" />
        ) : (
          <>
            {aliases.data.length === 0 ? (
              <p>Eş anlamlı ifade yok.</p>
            ) : (
              <ul className="checklist">
                {aliases.data.map((a) => (
                  <li key={a.id} style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                    <span>{a.alias}</span>
                    <ModerationForm
                      action={removeCategoryAlias}
                      hidden={{ categoryId: id.data, aliasId: a.id }}
                      submitLabel="Kaldır"
                      tone="danger"
                      label={`${a.alias} ifadesini kaldır`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div style={{ maxWidth: 420 }}>
              <ModerationForm
                action={addCategoryAlias}
                hidden={{ categoryId: id.data }}
                submitLabel="Ekle"
                tone="primary"
                label="Eş anlamlı ifade ekle"
                doneMessage="Eklendi."
              >
                <label className="field">
                  Yeni ifade
                  <input name="alias" required minLength={2} maxLength={80} />
                </label>
              </ModerationForm>
            </div>
          </>
        )}
      </section>

      <section className="card" style={{ display: 'grid', gap: spacing.md, maxWidth: 520 }}>
        <h2>Fotoğraf politikası</h2>
        <p className="muted">
          Talep sihirbazının bu kategoride fotoğrafı nasıl istediği. Mevcut:{' '}
          <strong>{form.ok ? PHOTO_POLICY_LABELS[form.data.photoPolicy] : 'bilinmiyor'}</strong>
          {form.ok ? null : ' (talep formu okunamadı)'}.
        </p>
        <ModerationForm
          action={setCategoryPhotoPolicy}
          hidden={{ categoryId: id.data }}
          submitLabel="Kaydet"
          tone="primary"
          label="Fotoğraf politikası"
          doneMessage="Kaydedildi."
        >
          <label className="field">
            Politika
            <select
              name="requestPhotoPolicy"
              required
              defaultValue={form.ok ? form.data.photoPolicy : ''}
            >
              <option value="" disabled>
                Seçin
              </option>
              {requestPhotoPolicySchema.options.map((p) => (
                <option key={p} value={p}>
                  {PHOTO_POLICY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        </ModerationForm>
      </section>
    </div>
  );
}
