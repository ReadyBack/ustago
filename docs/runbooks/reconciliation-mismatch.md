# Mutabakat uyumsuzluğu

Planlı mutabakat bir uyumsuzluk bulursa `finance.reconciliation_mismatch` uyarısı açar.
Mutabakat **hiçbir kaydı düzeltmez**.

1. Admin → Operasyon → Mutabakat geçmişi: çalışmayı ve uyumsuzluk listesini aç
   (ör. `PAYMENT_WITHOUT_LEDGER`, `REFUND_AMOUNT_MISMATCH`, `PAYOUT_WITHOUT_RESERVATION`).
2. Yerelde veya salt-okuma kopyada `pnpm --filter @ustago/api finance:reconcile` ile raporu doğrula.
3. Etkilenen akışı gerekiyorsa kill switch ile durdur.
4. Düzeltme yalnız yeni, dengeli bir defter hareketiyle yapılır (defter yalnız eklemeye açıktır);
   bunun için kod değişikliği ve inceleme gerekir. Doğrudan SQL ile satır değiştirme yasaktır.
5. Yeni mutabakat çalıştır; temizse uyarıyı notla çöz.
