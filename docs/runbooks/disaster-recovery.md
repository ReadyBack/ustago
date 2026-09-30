# Felaket kurtarma

> **Durum:** Taslak. Bulut sağlayıcısı varsayılmadı. **RPO/RTO iş kararıdır** (Policy TBD).
> PostgreSQL tek doğruluk kaynağıdır: para, iş ve defter yalnız orada yaşar.

## Yedekleme stratejisi (öneri, onay bekliyor)

- PostgreSQL: sürekli WAL arşivi + günlük tam yedek (`pg_dump -Fc` veya sağlayıcının anlık görüntüsü),
  farklı bölgede şifreli saklama, zaman noktasına geri dönüş.
- Nesne depolama: sürümleme ve silme koruması.
- Aylık geri yükleme tatbikatı; sonuç bu dosyanın sonuna eklenir.

## Geri yükleme stratejisi

1. `payments` ve `payouts` kill switch'lerini kapat (admin → Operasyon; gerekçe ve onay ister).
2. Yeni bir veritabanına geri yükle: `pg_restore --no-owner -d <yeni_db> <yedek>`.
3. `prisma migrate status` ile şemayı, `pnpm finance:reconcile` ile defteri doğrula
   (borç = alacak, uyumsuzluk listesi).
4. Kritik tabloların satır sayısı ve özetini (ör. `md5(string_agg(...))`) kaynakla karşılaştır.
5. Uygulamayı yeni veritabanına yönlendir, smoke test yap, kill switch'leri aç.

## Senaryolar

| Senaryo                      | Etki                                                         | Yapılacak                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB loss                      | API hazır değil (`/health/ready` 503); yazma yok             | Yukarıdaki geri yükleme; geri yükleme noktasından sonraki sağlayıcı olaylarını webhook'la yeniden oynat (idempotent).                                                              |
| Redis loss                   | Hız sınırları ve kuyruk hata verir; **para kaybı olmaz**     | Redis'i yeniden başlat; hız sınırı sayaçları sıfırdan başlar; push outbox PostgreSQL'de olduğu için teslimat kaldığı yerden sürer.                                                 |
| Object storage unavailable   | Belge yükleme/görüntüleme hata verir; iş ve ödeme etkilenmez | Doğrulama incelemesini beklet; kullanıcıya "Belge şu anda yüklenemiyor" gösterilir.                                                                                                |
| Payment provider unavailable | Yeni ödeme başlatılamaz; iş silinmez                         | `payments` kill switch'i; kullanıcı "Bu özellik şu anda geçici olarak kapalı." / "Uygulamadan ödeme şu anda kullanılamıyor." (503) görür; ödemeler PENDING/FAILED kalır, iş sürer. |
| Payout provider unavailable  | Onaylanan talep `NEEDS_RECONCILIATION` olabilir              | `payouts` kill switch'i; [belirsiz para çekme runbook'u](payout-needs-reconciliation.md).                                                                                          |
| Push provider unavailable    | Bildirim gecikir; uygulama içi bildirim kaybolmaz            | Push outbox yeniden dener (üstel bekleme, en fazla `PUSH_MAX_ATTEMPTS`), sonra FAILED; uyarı açılır.                                                                               |

Özellik bazlı düşürme tercih edilir: tüm uygulamayı kapatmak yerine `payments`, `payouts`,
`cash`, `new_jobs` anahtarları ayrı ayrı kapatılır. Ortam düzeyindeki güvenlik ayarlarını admin
değiştiremez.

## Yerel tatbikat (2026-09-30)

Yerel PostgreSQL 17 üzerinde, seed + Faz 6 demo verisiyle:

- `pg_dump -Fc ustago` → 321 KB; yeni `ustago_restore` veritabanına `pg_restore --no-owner`; toplam ~1 sn.
- 62 tablonun tamamında satır sayısı ve içerik özeti **birebir aynı** (ledger_entries 24,
  ledger_transactions 10, payments 2, refunds 1, payouts 2, provider_earnings 2).
- Geri yüklenen veritabanında defter: borç ₺10.490,13 = alacak ₺10.490,13, **DENGELİ**.
- Mutabakat raporu geri yüklenen veritabanında kaynakla aynı sonucu verdi.

Bu bir yerel tatbikattır; üretim yedekleme altyapısı yoktur.
