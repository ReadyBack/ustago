'use client';

import { colors, spacing } from '@ustago/ui';
import { type FormEvent, useActionState, useState } from 'react';

import { CONVERSATION_ROLE_LABELS, formatDate } from '@/lib/labels';
import { ACCESS_REASON_MAX, ACCESS_REASON_MIN, accessReasonError } from '@/lib/message-reports';

import { type AccessState, accessReportedConversation } from '../marketplace-actions';

/**
 * "Konuşmayı incele": the admin writes why they need to read the
 * conversation; the API records it in the audit log and returns the
 * messages. They live only in this component's state (never cached or
 * stored) and disappear on reload.
 */
export function ReportReview({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState<AccessState, FormData>(
    accessReportedConversation,
    {},
  );
  const [reason, setReason] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const error = accessReasonError(reason);
    setClientError(error);
    if (error) event.preventDefault();
  }

  if (state.ok && state.conversation) {
    const { messages } = state.conversation;
    return (
      <div style={{ display: 'grid', gap: spacing.sm }}>
        <p role="status" className="notice">
          Bu erişim denetim kaydına yazıldı. Mesajlar salt okunurdur ve sayfa yenilenince
          gösterilmez.
        </p>
        {messages.length === 0 ? (
          <p className="muted">Konuşmada mesaj yok.</p>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: spacing.xs }}>
            {messages.map((m) => {
              const reported = m.id === state.conversation?.report.messageId;
              return (
                <li
                  key={m.id}
                  className={`message${m.type === 'SYSTEM' ? ' message-system' : ''}`}
                  style={reported ? { borderColor: colors.emergency } : undefined}
                >
                  <span className="muted">
                    {m.type === 'SYSTEM'
                      ? 'Sistem'
                      : `${m.senderName ?? '—'}${m.senderRole ? ` (${CONVERSATION_ROLE_LABELS[m.senderRole]})` : ''}`}{' '}
                    · {formatDate(m.createdAt)}
                    {reported ? ' · şikayet edilen mesaj' : ''}
                    {m.containsContactInfo ? ' · iletişim bilgisi içeriyor olabilir' : ''}
                  </span>
                  {m.deletedAt ? (
                    <em className="muted">Mesaj silinmiş.</em>
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>
                      {m.body ?? ''}
                      {m.hasImage ? <em className="muted"> [görsel]</em> : null}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  }

  return (
    <details>
      <summary>Konuşmayı incele</summary>
      <form
        action={action}
        onSubmit={onSubmit}
        aria-label="Konuşmayı incele"
        style={{ display: 'grid', gap: spacing.xs, marginTop: spacing.sm, maxWidth: 560 }}
      >
        <input type="hidden" name="reportId" value={reportId} />
        <label className="field">
          Erişim gerekçesi (en az {ACCESS_REASON_MIN} karakter; denetim kaydına yazılır)
          <textarea
            name="reason"
            rows={3}
            maxLength={ACCESS_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Açılıyor…' : 'Gerekçeyle aç'}
          </button>
        </div>
        {(clientError ?? state.error) ? (
          <p role="alert" style={{ color: colors.emergency, fontSize: 14 }}>
            {clientError ?? state.error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
