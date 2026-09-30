import { spacing } from '@ustago/ui';
import Link from 'next/link';

import { ApiErrorNotice } from '@/components/api-error';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { categoryTreeSchema } from '@/lib/schemas';

export default async function CategoriesPage() {
  await requireAdmin('/categories');
  const result = await apiRequest('/categories', { schema: categoryTreeSchema });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Kategori içerikleri</h1>
      <p className="muted">
        Talep formundaki sorular, aramada kullanılan eş anlamlı ifadeler ve fotoğraf politikası
        kategori bazında düzenlenir. Belge kuralları için{' '}
        <Link href="/category-requirements">Belge kuralları</Link> sayfasına bakın.
      </p>
      {!result.ok ? (
        <ApiErrorNotice error={result} what="Kategoriler" />
      ) : result.data.length === 0 ? (
        <p className="card">Kategori yok.</p>
      ) : (
        <div className="grid-2">
          {result.data.map((parent) => (
            <section key={parent.id} className="card">
              <h2>
                <Link href={`/categories/${parent.id}`}>{parent.name}</Link>
              </h2>
              {parent.children.length === 0 ? (
                <p className="muted">Alt kategori yok.</p>
              ) : (
                <ul>
                  {parent.children.map((child) => (
                    <li key={child.id}>
                      <Link href={`/categories/${child.id}`}>{child.name}</Link>
                      {child.isActive ? null : <span className="muted"> (kapalı)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
