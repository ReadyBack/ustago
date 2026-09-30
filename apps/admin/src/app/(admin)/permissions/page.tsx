import { adminPermissionSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import { z } from 'zod';

import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { ADMIN_PERMISSION_LABELS } from '@/lib/labels';
import { adminUserPermissionsSchema } from '@/lib/schemas';

import { ModerationForm } from '../moderation-form';
import { setAdminPermissions } from '../trust-actions';

const PERMISSIONS = adminPermissionSchema.options;

export default async function PermissionsPage() {
  const me = await requireAdmin('/permissions');
  const result = await apiRequest('/admin/permissions', {
    schema: z.array(adminUserPermissionsSchema),
  });

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <h1>Yetkiler</h1>
      <p className="muted">
        Her yönetici her kaydı görebilir; karar vermek için ilgili yetki gerekir: Doğrulama (usta
        doğrulama, askı, belge kuralları), Finans (komisyon, para çekme, mutabakat), Destek
        (uyarılar, risk sinyalleri). Süper yönetici tüm yetkileri kapsar ve yetkileri yalnızca o
        değiştirebilir. Kimse kendi yetkisini değiştiremez.
      </p>
      {!result.ok ? (
        <p role="alert">{result.message}</p>
      ) : result.data.length === 0 ? (
        <p className="card">Yönetici yok.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Yönetici</th>
                <th>Etkin yetkiler</th>
                <th>Düzenle</th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((u) => (
                <tr key={u.userId}>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="muted">{u.email ?? '—'}</div>
                    <div className="muted">{u.roles.join(', ')}</div>
                  </td>
                  <td>
                    {u.effective.length === 0 ? (
                      <span className="muted">Yalnızca görüntüleme</span>
                    ) : (
                      <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
                        {u.effective.map((p) => (
                          <span
                            key={p}
                            className={`pill ${u.permissions.includes(p) ? 'pill-success' : 'pill-neutral'}`}
                            title={u.permissions.includes(p) ? 'Verilmiş' : 'Rolden geliyor'}
                          >
                            {ADMIN_PERMISSION_LABELS[p]}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 280 }}>
                    {u.userId === me.id ? (
                      <span className="muted">Kendi yetkilerinizi değiştiremezsiniz.</span>
                    ) : (
                      <ModerationForm
                        action={setAdminPermissions}
                        hidden={{ userId: u.userId }}
                        submitLabel="Yetkileri kaydet"
                        tone="primary"
                        label={`${u.name} yetkileri`}
                        doneMessage="Yetkiler güncellendi."
                      >
                        {PERMISSIONS.map((p) => (
                          <label key={p} className="check">
                            <input
                              type="checkbox"
                              name="permissions"
                              value={p}
                              defaultChecked={u.permissions.includes(p)}
                            />
                            {ADMIN_PERMISSION_LABELS[p]}
                          </label>
                        ))}
                        <label className="check" style={{ marginTop: spacing.xs }}>
                          <input type="checkbox" name="confirm" value="yes" required />
                          <strong>{u.name} için yetki değişikliğini onaylıyorum.</strong>
                        </label>
                      </ModerationForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
