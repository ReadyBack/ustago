import { verificationTypeSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import { z } from 'zod';

import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { formatDate, VERIFICATION_TYPE_LABELS } from '@/lib/labels';
import { categoryRequirementSchema, categoryTreeSchema } from '@/lib/schemas';

import { ModerationForm } from '../moderation-form';
import { addCategoryRequirement, removeCategoryRequirement } from '../trust-actions';

export default async function CategoryRequirementsPage() {
  await requireAdmin('/category-requirements');
  const [requirements, categories] = await Promise.all([
    apiRequest('/admin/category-requirements', { schema: z.array(categoryRequirementSchema) }),
    apiRequest('/categories', { schema: categoryTreeSchema }),
  ]);

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Kategori belge kuralları</h1>
      <p className="muted">
        Bir kategoride teklif verebilmek için ustanın yüklemesi gereken ek belgeler (ör. elektrik
        işleri için mesleki yeterlilik belgesi). Platform genelinde zorunlu belgeler her usta için
        zaten geçerlidir. Üst kategoriye eklenen kural tüm alt kategorileri kapsar. Kaldırılan kural
        denetim için saklanır.
      </p>

      {!requirements.ok ? (
        <p role="alert">{requirements.message}</p>
      ) : requirements.data.length === 0 ? (
        <p className="card">Kategoriye özel kural yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Kategori</th>
                <th>Zorunlu belge</th>
                <th>Not</th>
                <th>Eklendi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requirements.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.categoryName}</td>
                  <td>{VERIFICATION_TYPE_LABELS[r.documentType]}</td>
                  <td>{r.note ?? '—'}</td>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>
                    <ModerationForm
                      action={removeCategoryRequirement}
                      hidden={{ id: r.id }}
                      submitLabel="Kaldır"
                      tone="danger"
                      label={`${r.categoryName}: ${VERIFICATION_TYPE_LABELS[r.documentType]} kuralını kaldır`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card" style={{ maxWidth: 520 }}>
        <h2>Kural ekle</h2>
        {!categories.ok ? (
          <p role="alert">Kategoriler alınamadı: {categories.message}</p>
        ) : (
          <ModerationForm
            action={addCategoryRequirement}
            hidden={{}}
            submitLabel="Kuralı ekle"
            tone="primary"
            label="Kategori belge kuralı ekle"
            doneMessage="Kural eklendi. Bu kategorideki ustalar belgeyi yükleyene kadar teklif veremez."
          >
            <label className="field">
              Kategori
              <select name="categoryId" required defaultValue="">
                <option value="" disabled>
                  Seçin
                </option>
                {categories.data.map((parent) => (
                  <optgroup key={parent.id} label={parent.name}>
                    <option value={parent.id}>{parent.name} (tümü)</option>
                    {parent.children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              Belge
              <select name="documentType" required defaultValue="">
                <option value="" disabled>
                  Seçin
                </option>
                {verificationTypeSchema.options.map((t) => (
                  <option key={t} value={t}>
                    {VERIFICATION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Not (isteğe bağlı)
              <input name="note" maxLength={500} />
            </label>
          </ModerationForm>
        )}
      </section>
    </div>
  );
}
