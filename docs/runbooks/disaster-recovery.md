# Felaket kurtarma (taslak)

> **Durum:** Taslak; altyapı sağlayıcısı seçilmediği için RPO/RTO hedefleri **Policy TBD**.

## Neyi korumalıyız

| Veri                                      | Kaybı                     | Öncelik |
| ----------------------------------------- | ------------------------- | ------- |
| PostgreSQL (defter, ödeme, iş, kullanıcı) | Para ve iş geçmişi kaybı  | Kritik  |
| Doğrulama belgeleri (nesne depolama)      | Usta yeniden belge yükler | Yüksek  |
| Redis (hız sınırları, kuyruk)             | Geçici; yeniden oluşur    | Düşük   |

## Yedekleme (öneri, onay bekliyor)

- PostgreSQL: sürekli WAL arşivi + günlük tam yedek, farklı bölgede şifreli saklama.
- Nesne depolama: sürümleme açık, silme koruması.
- Aylık geri yükleme tatbikatı; sonuç bu dosyaya not edilir.

## Olay sırasında

1. **Para akışını durdur:** admin paneli → Operasyon → `payments` ve `payouts` kapat (gerekçe yaz).
   Gerekirse `new_jobs` de kapatılır.
2. Uyarıları ve son mutabakat çalışmasını kontrol et; yeni mutabakat başlat. Mutabakat
   **otomatik düzeltme yapmaz**; uyumsuzluklar listelenir.
3. Veritabanını geri yükle (zaman noktasına), `prisma migrate status` ile şemayı doğrula.
4. Geri yükleme noktasından sonraki ödeme sağlayıcısı olaylarını sağlayıcı panelinden al;
   webhook'lar idempotenttir (`processed_webhook_events`), yeniden oynatılabilir.
5. `NEEDS_RECONCILIATION` payout'ları tek tek sağlayıcı kaydıyla karşılaştırıp çöz.
6. Mutabakat temizse kill switch'leri aç; olay raporunu yaz.

## Bilinen boşluklar

- Gerçek uyarı kanalı yok (engel).
- Nesne depolama sürücüsü yok (yalnız local, üretimde yasak).
