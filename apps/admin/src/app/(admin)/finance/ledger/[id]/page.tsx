import { ledgerTransactionViewSchema, uuidSchema } from '@ustago/validation';
import { spacing } from '@ustago/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LedgerTransaction } from '@/components/ledger-transaction';
import { apiRequest } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { LEDGER_TRANSACTION_LABELS } from '@/lib/labels';

export default async function LedgerTransactionPage(props: PageProps<'/finance/ledger/[id]'>) {
  const { id: rawId } = await props.params;
  const id = uuidSchema.safeParse(rawId);
  if (!id.success) notFound();
  await requireAdmin(`/finance/ledger/${id.data}`);

  const result = await apiRequest(`/admin/finance/ledger/${id.data}`, {
    schema: ledgerTransactionViewSchema,
  });
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <p role="alert">{result.message}</p>;
  }
  const tx = result.data;
  const links: { label: string; href: string | null; id: string | null }[] = [
    { label: 'İş', id: tx.jobId, href: tx.jobId ? `/jobs/${tx.jobId}` : null },
    {
      label: 'Ödeme',
      id: tx.paymentId,
      href: tx.paymentId ? `/finance/payments/${tx.paymentId}` : null,
    },
    { label: 'İade', id: tx.refundId, href: null },
    { label: 'Para çekme', id: tx.payoutId, href: null },
    { label: 'Nakit ödeme', id: tx.cashSettlementId, href: null },
    { label: 'Kazanç', id: tx.earningId, href: null },
    {
      label: 'Ters kaydı yapılan',
      id: tx.reversesId,
      href: tx.reversesId ? `/finance/ledger/${tx.reversesId}` : null,
    },
  ];

  return (
    <div style={{ display: 'grid', gap: spacing.lg }}>
      <Link href="/finance/ledger">← Defter</Link>
      <h1>{LEDGER_TRANSACTION_LABELS[tx.type]}</h1>
      <dl className="card">
        <dt>Kayıt no</dt>
        <dd>
          <code>{tx.id}</code>
        </dd>
        <dt>Kaynak anahtarı</dt>
        <dd>
          <code>{tx.sourceKey}</code>
        </dd>
        {links
          .filter((l) => l.id)
          .map((l) => (
            <div key={l.label} style={{ display: 'contents' }}>
              <dt>{l.label}</dt>
              <dd>{l.href ? <Link href={l.href}>{l.id}</Link> : <code>{l.id}</code>}</dd>
            </div>
          ))}
      </dl>
      <LedgerTransaction tx={tx} linkTitle={false} />
    </div>
  );
}
