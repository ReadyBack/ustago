import type { AuditEvent } from '@ustago/types';
import Link from 'next/link';

import { formatDate } from '@/lib/labels';

/** Audit entries, newest first. Metadata is shown as-is (it never holds secrets). */
export function AuditTable({ events }: { events: AuditEvent[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Zaman</th>
          <th>İşlem</th>
          <th>Yapan</th>
          <th>Kayıt</th>
          <th>Ayrıntı</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td style={{ whiteSpace: 'nowrap' }}>{formatDate(e.createdAt)}</td>
            <td>
              <Link href={`/audit?action=${encodeURIComponent(e.action)}`}>
                <code>{e.action}</code>
              </Link>
            </td>
            <td>
              {e.actor ? (
                <Link href={`/audit?actorId=${e.actor.id}`}>{e.actor.displayName}</Link>
              ) : (
                'Sistem'
              )}
            </td>
            <td>
              {e.entityType ?? '—'}
              {e.entityId ? (
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  <Link href={`/audit?entityId=${encodeURIComponent(e.entityId)}`}>
                    {e.entityId}
                  </Link>
                </div>
              ) : null}
            </td>
            <td>
              {e.metadata && Object.keys(e.metadata).length > 0 ? (
                <code style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(e.metadata)}
                </code>
              ) : (
                '—'
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
