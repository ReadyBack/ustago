import { adminPaymentDetailSchema, formatMoney, uuidSchema } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PaymentStatusPill } from '@/components/finance-pills';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { newIdempotencyKey } from '@/lib/finance';

import { RefundForm } from './refund-form';

export default async function RefundPage(props: PageProps<'/finance/payments/[id]/refund'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/finance/payments/${id.data}/refund`);

  const result = await apiRequest(`/admin/finance/payments/${id.data}`, {
    schema: adminPaymentDetailSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const p = result.data;

  return (
    <div style={{ display: 'grid', gap: spacing.lg, maxWidth: 640 }}>
      <Link href={`/finance/payments/${p.id}`}>← Ödeme detayı</Link>
      <header style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1>İade</h1>
        <PaymentStatusPill status={p.status} />
      </header>
      <dl className="card">
        <dt>İş</dt>
        <dd>
          <Link href={`/jobs/${p.jobId}`}>{p.jobTitle}</Link>
        </dd>
        <dt>Müşteri</dt>
        <dd>{p.customerName}</dd>
        <dt>Ödenen</dt>
        <dd>{formatMoney(p.amount)}</dd>
        <dt>Daha önce iade</dt>
        <dd>{formatMoney(p.refunded)}</dd>
      </dl>
      <div className="card">
        {p.refundable.amountMinor > 0 ? (
          <RefundForm
            paymentId={p.id}
            refundableMinor={p.refundable.amountMinor}
            idempotencyKey={newIdempotencyKey()}
          />
        ) : (
          <p style={{ color: colors.textSecondary }}>Bu ödemede iade edilebilir tutar kalmadı.</p>
        )}
      </div>
    </div>
  );
}
