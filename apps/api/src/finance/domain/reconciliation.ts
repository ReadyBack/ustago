import type {
  CashSettlementStatus,
  PaymentStatus,
  PayoutStatus,
  ProviderEarningStatus,
  RefundStatus,
} from '../../generated/prisma/enums.js';
import { isCaptured, statusAfterRefunds } from './payment-state.js';

/**
 * Pure reconciliation rules (docs/adr/0018): given the business records
 * and the ledger transactions (by source key), list every mismatch.
 * Nothing is corrected automatically; a person decides.
 */

export interface LedgerFact {
  /** Σ debit of the transaction (= Σ credit when balanced). */
  amount: bigint;
  /** Σ credit to PLATFORM_FEE_REVENUE (capture) — used for fee checks. */
  feeCredit: bigint;
}

export interface Mismatch {
  kind: string;
  entityType: string;
  entityId: string;
  message: string;
}

export interface ReconciliationInput {
  ledger: Map<string, LedgerFact>;
  payments: {
    id: string;
    status: PaymentStatus;
    amount: bigint;
    fee: bigint;
    refundedSucceeded: bigint;
  }[];
  earnings: {
    id: string;
    paymentId: string;
    status: ProviderEarningStatus;
    gross: bigint;
    fee: bigint;
  }[];
  refunds: { id: string; status: RefundStatus; amount: bigint }[];
  payouts: { id: string; status: PayoutStatus; amount: bigint }[];
  cash: { id: string; status: CashSettlementStatus; fee: bigint }[];
  unbalancedTransactions: string[];
  negativeProviderAccounts: { accountId: string; type: string; balance: bigint }[];
}

export function reconcile(input: ReconciliationInput): Mismatch[] {
  const out: Mismatch[] = [];
  const has = (key: string) => input.ledger.has(key);
  const add = (kind: string, entityType: string, entityId: string, message: string) =>
    out.push({ kind, entityType, entityId, message });

  for (const id of input.unbalancedTransactions) {
    add('LEDGER_UNBALANCED', 'ledger_transaction', id, 'Borç ve alacak toplamı eşit değil.');
  }
  for (const a of input.negativeProviderAccounts) {
    add(
      'NEGATIVE_PROVIDER_BALANCE',
      'ledger_account',
      a.accountId,
      `${a.type} bakiyesi negatif (${a.balance}).`,
    );
  }

  const earningByPayment = new Map(input.earnings.map((e) => [e.paymentId, e]));
  for (const p of input.payments) {
    const capture = input.ledger.get(`payment:${p.id}:captured`);
    if (isCaptured(p.status)) {
      if (!capture) {
        add('PAYMENT_WITHOUT_LEDGER', 'payment', p.id, 'Başarılı ödemenin tahsilat kaydı yok.');
      } else {
        if (capture.amount !== p.amount) {
          add(
            'PAYMENT_AMOUNT_MISMATCH',
            'payment',
            p.id,
            'Tahsilat kaydı tutarı ödemeyle aynı değil.',
          );
        }
        if (capture.feeCredit !== p.fee) {
          add(
            'PAYMENT_FEE_MISMATCH',
            'payment',
            p.id,
            'Platform ücreti kaydı ödemeyle aynı değil.',
          );
        }
      }
      const e = earningByPayment.get(p.id);
      if (!e) {
        add('PAYMENT_WITHOUT_EARNING', 'payment', p.id, 'Başarılı ödemenin usta kazancı yok.');
      } else if (e.gross !== p.amount || e.fee !== p.fee) {
        add(
          'EARNING_SPLIT_MISMATCH',
          'provider_earning',
          e.id,
          'Kazanç tutarları ödemeyle aynı değil.',
        );
      }
      const expected = statusAfterRefunds(p.amount, p.refundedSucceeded);
      if (expected !== p.status) {
        add(
          'PAYMENT_STATUS_MISMATCH',
          'payment',
          p.id,
          `Durum ${p.status}, iadelere göre ${expected} olmalı.`,
        );
      }
    } else if (capture) {
      add('LEDGER_WITHOUT_PAYMENT', 'payment', p.id, `Ödeme ${p.status} ama tahsilat kaydı var.`);
    }
  }

  for (const e of input.earnings) {
    const released = has(`earning:${e.id}:released`);
    if (e.status === 'AVAILABLE' && !released) {
      add(
        'EARNING_RELEASE_MISSING',
        'provider_earning',
        e.id,
        'Kullanılabilir kazancın aktarım kaydı yok.',
      );
    }
    if ((e.status === 'PENDING' || e.status === 'HELD') && released) {
      add(
        'EARNING_RELEASED_BUT_PENDING',
        'provider_earning',
        e.id,
        'Bekleyen kazancın aktarım kaydı var.',
      );
    }
  }

  for (const r of input.refunds) {
    const requested = input.ledger.get(`refund:${r.id}:requested`);
    const completed = input.ledger.get(`refund:${r.id}:completed`);
    const reversed = has(`refund:${r.id}:reversed`);
    if (!requested) {
      add('REFUND_WITHOUT_LEDGER', 'refund', r.id, 'İade talebinin muhasebe kaydı yok.');
      continue;
    }
    if (requested.amount !== r.amount) {
      add('REFUND_AMOUNT_MISMATCH', 'refund', r.id, 'İade kaydı tutarı iadeyle aynı değil.');
    }
    if (r.status === 'SUCCEEDED' && !completed) {
      add('REFUND_COMPLETION_MISSING', 'refund', r.id, 'Tamamlanan iadenin kapanış kaydı yok.');
    }
    if (r.status !== 'SUCCEEDED' && completed) {
      add('REFUND_COMPLETED_UNEXPECTED', 'refund', r.id, `İade ${r.status} ama kapanış kaydı var.`);
    }
    if (r.status === 'FAILED' && !reversed) {
      add('REFUND_REVERSAL_MISSING', 'refund', r.id, 'Başarısız iadenin ters kaydı yok.');
    }
  }

  for (const p of input.payouts) {
    const reserved = input.ledger.get(`payout:${p.id}:reserved`);
    const paid = has(`payout:${p.id}:paid`);
    const released = has(`payout:${p.id}:released`);
    if (!reserved) {
      add('PAYOUT_WITHOUT_RESERVATION', 'payout', p.id, 'Para çekme talebinin ayırma kaydı yok.');
      continue;
    }
    if (reserved.amount !== p.amount) {
      add('PAYOUT_AMOUNT_MISMATCH', 'payout', p.id, 'Ayırma kaydı tutarı taleple aynı değil.');
    }
    const open = p.status === 'REQUESTED' || p.status === 'APPROVED' || p.status === 'PROCESSING';
    if (open && (paid || released)) {
      add('PAYOUT_CLOSED_IN_LEDGER', 'payout', p.id, `Talep ${p.status} ama kapanış kaydı var.`);
    }
    if (p.status === 'PAID' && (!paid || released)) {
      add('PAYOUT_PAID_MISMATCH', 'payout', p.id, 'Ödenen talebin kayıtları tutarsız.');
    }
    if ((p.status === 'FAILED' || p.status === 'CANCELLED') && (!released || paid)) {
      add(
        'PAYOUT_RELEASE_MISMATCH',
        'payout',
        p.id,
        'İptal/başarısız talebin serbest bırakma kaydı tutarsız.',
      );
    }
  }

  for (const c of input.cash) {
    const fee = input.ledger.get(`cash:${c.id}:fee`);
    const shouldHave = c.status === 'CONFIRMED' && c.fee > 0n;
    if (shouldHave && !fee) {
      add(
        'CASH_FEE_MISSING',
        'cash_settlement',
        c.id,
        'Onaylı nakit işin platform ücreti kaydı yok.',
      );
    }
    if (!shouldHave && fee) {
      add(
        'CASH_FEE_UNEXPECTED',
        'cash_settlement',
        c.id,
        `Nakit kayıt ${c.status} ama ücret kaydı var.`,
      );
    }
    if (fee && fee.amount !== c.fee) {
      add(
        'CASH_FEE_MISMATCH',
        'cash_settlement',
        c.id,
        'Ücret kaydı tutarı nakit kayıtla aynı değil.',
      );
    }
  }
  return out;
}
