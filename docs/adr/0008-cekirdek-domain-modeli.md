# ADR-0008: Çekirdek domain modeli

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Faz 1, ileriki fazların (talep, eşleştirme, teklif, iş, ödeme, güven) üzerine kurulacağı veri
modelini belirler. Ürün kararları: Türkiye geneli il/ilçe, UstaGO NOW ve Teklif Al, bağlayıcı
olmayan bütçe, pazarlık geçmişi, kilitli anlaşma fiyatı, ek iş, sağlayıcıdan bağımsız ödeme,
ledger, UstaScore, disiplin/itiraz, organik ve sponsorlu sıralamanın ayrılması. Tam model:
[docs/architecture/domain-model.md](../architecture/domain-model.md).

## Karar

- **Kimlik:** tüm tablolarda UUIDv7 `id` (zaman sıralı, indeks dostu). İstisnalar: iller plaka
  kodu (1–81), saf ara tablolar birleşik anahtar, 1:1 uzantı tablosu (`provider_scores`) sahibinin id'si.
- **Konum:** `provinces` (81 il) → `districts` → `addresses`. `provinces.is_active` ve
  `province_categories` ile il ve il×kategori bazında açma/kapama (NOW dahil). Koordinatlar
  `Decimal(9,6)`; PostGIS, mesafe sorguları gerektiğinde (Faz 4) eklenecek.
- **Talep:** tek `service_requests` tablosu, `type = NOW | QUOTE`. `budget_minor` boş olabilir
  ("bütçem belli değil") ve teklifleri bağlamaz.
- **NOW dağıtımı:** `emergency_dispatch_offers` bildirilen her usta için bir satır. İlk kabul
  kazanır; `jobs.service_request_id` benzersiz olduğundan çift kabul veritabanında reddedilir.
- **Teklif ve pazarlık:** `quotes` bir usta ile bir talep arasındaki müzakere dizisidir
  (talep×usta benzersiz). Her fiyat hamlesi değişmez bir `quote_revisions` satırıdır
  (`OFFER`, `CUSTOMER_COUNTER`, `PROVIDER_COUNTER`); geçmiş silinmez. Kabul, kabul edilen revizyonu
  `quotes.accepted_revision_id` ile işaretler.
- **Booking + Job tek aggregate:** ayrı bir `bookings` tablosu yerine planlama alanları
  (`scheduled_start_at`) `jobs` üzerindedir. Ayrı tablo bu aşamada yalnızca 1:1 bir join eklerdi.
- **AGREED_PRICE:** `jobs.agreed_price_minor` iş oluşurken kabul edilen revizyondan yazılır ve bir
  daha güncellenmez. `current_total_minor` yalnızca kabul edilen `change_orders` ile değişir.
  Reddedilen ek iş eski toplamı korur. İş başladıktan sonra tek taraflı fiyat değişimi yoktur.
- **Durumlar:** `jobs.status` değişimleri merkezi bir state machine ile yapılacak ve her geçiş
  aynı transaction'da `job_status_history`'ye yazılacaktır (Faz 7). `version` sütunu iyimser kilit
  içindir.
- **Ödeme:** `payments` (iş başına ödeme niyeti; `method = IN_APP | CASH | BANK_TRANSFER`,
  `gateway` adaptör adı, benzersiz `idempotency_key`) ve `payment_transactions` (sağlayıcıya her
  çağrı/webhook, benzersiz idempotency). Domain belirli bir sağlayıcıya bağlı değildir.
- **Ledger, cüzdan değil:** `ledger_accounts` + çift taraflı `ledger_entries` (aynı `journal_id`
  toplamı sıfır). Usta bakiyesi (bekleyen/kullanılabilir/ödenen) kayıtlardan türetilir. Para
  lisanslı ödeme kuruluşunda durur; UstaGO para tutan bir cüzdan işletmez.
- **Değerlendirme:** `reviews` yalnızca bir işe bağlı var olabilir (doğrulanmış müşteri); iş ve
  yön başına tek yorum. İki yönlüdür (müşteri→usta, usta→müşteri).
- **UstaScore:** girdiler `trust_events` (zamanında varış, no-show, kabul sonrası iptal, yanıt
  süresi, tekrar müşteri, doğrulanmış şikâyet, belge doğrulama...) ve yorumlardır. Sonuç
  `provider_scores` (skor, örneklem, `is_new_provider`, bileşenler, algoritma sürümü). Yeni ustalar
  sınırlı bir keşif payıyla gösterilir, görünmez kalmaz.
- **Organik ≠ sponsorlu:** abonelik/PRO ve reklam verisi `provider_scores` girdisi değildir.
  Sponsorlu yerleşimler ileride ayrı tablolarda tutulacak ve yanıtta `sponsored: true`
  ("SPONSORLU") olarak ayrı işaretlenecektir.
- **Disiplin:** `disciplinary_actions` her zaman bir kişi (`decided_by_id`) ve gerekçeyle oluşur;
  tek kötü yorum otomatik ceza üretmez. Türler: `WARNING`, `VISIBILITY_REDUCTION`,
  `NOW_SUSPENSION`, `JOB_RESTRICTION`, `TEMPORARY_SUSPENSION`, `PERMANENT_BAN`. `appeals` ile itiraz,
  `evidence` ile kanıt (mesaj, check-in, konum olayı, fotoğraf, ödeme kaydı). Müşteriler için de
  geçerlidir (`subject_role`).
- **Yapılmayanlar:** sohbet/mesaj, abonelik, reklam, payout, kategori soruları, medya ve
  UstaGO PRO modülleri (CRM, takvim, fatura, çalışanlar) kendi fazlarında eklenecek. Mevcut model
  bunları engellemez: işletme modülleri `provider_profiles.id` etrafında yeni tablolarla büyür.

## Sonuçlar

- Faz 2–9 yeni tablo eklemekten çok bu tablolara servis yazacak; ilk migration büyüktür ama
  ilişkiler baştan tutarlıdır.
- Faz 1'de yalnızca kimlik, profil, kategori ve konum uç noktaları vardır; diğer tablolar henüz
  API'den yazılmaz.
