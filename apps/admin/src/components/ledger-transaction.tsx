import type { LedgerTransactionView } from '@ustago/types';
import { formatMoney } from '@ustago/validation';
import { colors, spacing } from '@ustago/ui';
import Link from 'next/link';

import { formatDate, LEDGER_ACCOUNT_LABELS, LEDGER_TRANSACTION_LABELS } from '@/lib/labels';

/** Marks a transaction whose debits and credits do not match (should never happen). */
export function ImbalanceBadge({ imbalanceMinor }: { imbalanceMinor: number }) {
  if (imbalanceMinor === 0) return <span className="pill pill-success">Dengeli</span>;
  return (
    <span className="pill pill-danger" role="alert">
      Dengesiz: {formatMoney(imbalanceMinor)}
    </span>
  );
}

/** One double-entry transaction with its lines (debit / credit columns). */
export function LedgerTransaction({
  tx,
  linkTitle = true,
}: {
  tx: LedgerTransactionView;
  linkTitle?: boolean;
}) {
  const unbalanced = tx.imbalance.amountMinor !== 0;
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflowX: 'auto',
        ...(unbalanced ? { borderColor: colors.emergency, borderWidth: 2 } : {}),
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: spacing.md,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: `${spacing.sm}px ${spacing.md}px`,
        }}
      >
        <strong>
          {linkTitle ? (
            <Link href={`/finance/ledger/${tx.id}`}>{LEDGER_TRANSACTION_LABELS[tx.type]}</Link>
          ) : (
            LEDGER_TRANSACTION_LABELS[tx.type]
          )}
        </strong>
        <span style={{ color: colors.textSecondary, fontSize: 13 }}>
          {formatDate(tx.createdAt)}
        </span>
        <ImbalanceBadge imbalanceMinor={tx.imbalance.amountMinor} />
        {tx.description ? (
          <span style={{ color: colors.textSecondary, fontSize: 13 }}>{tx.description}</span>
        ) : null}
      </div>
      <table>
        <thead>
          <tr>
            <th>Hesap</th>
            <th>Sahibi</th>
            <th style={{ textAlign: 'right' }}>Borç</th>
            <th style={{ textAlign: 'right' }}>Alacak</th>
          </tr>
        </thead>
        <tbody>
          {tx.entries.map((e, i) => (
            <tr key={i}>
              <td>{LEDGER_ACCOUNT_LABELS[e.accountType]}</td>
              <td>{e.owner}</td>
              <td style={{ textAlign: 'right' }}>
                {e.direction === 'DEBIT' ? formatMoney(e.amount) : ''}
              </td>
              <td style={{ textAlign: 'right' }}>
                {e.direction === 'CREDIT' ? formatMoney(e.amount) : ''}
              </td>
            </tr>
          ))}
          <tr>
            <th colSpan={2}>Toplam</th>
            <th style={{ textAlign: 'right' }}>{formatMoney(tx.totalDebit)}</th>
            <th style={{ textAlign: 'right' }}>{formatMoney(tx.totalCredit)}</th>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
