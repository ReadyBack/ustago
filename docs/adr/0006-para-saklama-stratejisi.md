# ADR-0006: Para saklama stratejisi

- **Durum:** Kabul edildi (ADR-0003'teki para kuralını ayrıntılandırır)
- **Tarih:** 2026-09-29

## Bağlam

Teklif, pazarlık, ek iş, ödeme, platform ücreti ve usta kazancı gibi birçok alan para taşır.
Float yuvarlama hatası üretir; `Decimal` ise uygulama katmanında ayrı bir kütüphane ve dikkatli
serileştirme ister. Sistem TRY ile başlar ama çoklu para birimine açık olmalıdır.

## Karar

- **Veritabanı:** tüm para alanları `BigInt` **minor unit** (TRY için kuruş) olarak tutulur ve
  `_minor` son ekiyle adlandırılır: `total_minor`, `agreed_price_minor`, `amount_minor`...
  3.000,00 TL = `300000`. `Float` veya `Decimal` para alanı yoktur.
- **Para birimi:** her para taşıyan satırda `currency` (`CurrencyCode` enum, varsayılan `TRY`)
  bulunur. Yeni para birimi eklemek tek satırlık bir enum migration'ıdır. Farklı para birimleri
  arasında toplama yapılmaz; kur dönüşümü gerektiğinde ayrı bir ADR ile tasarlanır.
- **Neden BigInt, Int değil:** PostgreSQL `integer` üst sınırı ~21,4 milyon TL'dir; ledger
  toplamları ve kurumsal işler bunu aşabilir. `bigint` 92 katrilyon kuruşa kadar gider.
- **API:** para `{ amountMinor: number, currency: 'TRY' }` (`@ustago/types` → `Money`) olarak
  taşınır. `Number.MAX_SAFE_INTEGER` (≈90 trilyon TL) pratikte yeterlidir. BigInt → JSON dönüşümü
  ilk para döndüren uç noktayla (Faz 5) tek bir yardımcıda yapılacak ve bu sınırı kontrol edecek.
  Formatlama (`3.000,00 ₺`) yalnızca istemcidedir.
- **İşaret:** tutarlar negatif olmaz; tek istisna `change_orders.amount_delta_minor`
  (iş eksiltme). Ledger'da yön `direction` (DEBIT/CREDIT) alanındadır, tutar hep pozitiftir.
- **Kilitlenmiş fiyat:** `jobs.agreed_price_minor` iş oluştuğunda yazılır ve değişmez; güncel
  toplam `current_total_minor` yalnızca kabul edilen bir `change_order` ile, aynı transaction
  içinde değişir (ADR-0008).

## Sonuçlar

- Yuvarlama hatası yoktur; yüzde hesaplarında (platform ücreti) yuvarlama kuralı ödeme fazında
  (Faz 8) tek bir yardımcı fonksiyonda tanımlanacaktır.
- Negatif olmama ve para birimi tutarlılığı şu an uygulama doğrulamasıyla sağlanır;
  veritabanı `CHECK` kısıtları ilgili modüller yazılırken Prisma migration'ı ile eklenecektir.
