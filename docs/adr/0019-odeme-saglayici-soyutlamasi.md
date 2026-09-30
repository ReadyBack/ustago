# ADR-0019: Ödeme sağlayıcı soyutlaması, webhook ve test ödemesi

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-02

## Bağlam

Müşteri işi "Uygulamadan öde" ile ödeyebilmeli; UstaGO kart verisi görmemeli, ödeme sonucu
istemcinin "başarılı" demesine değil ödeme kuruluşunun bildirimine dayanmalıdır. Hangi ödeme
kuruluşuyla (ör. lisanslı bir ödeme/elektronik para kuruluşu) çalışılacağı henüz belli değildir;
gerçek API varsayılarak kod yazılmamalıdır. Faz 5'te gerçek para hareketi yoktur.

## Karar

### Soyutlama

`PaymentProvider` arayüzü (`apps/api/src/finance/providers/payment-provider.ts`):
`createPayment`, `getPayment`, `cancelPayment`, `refundPayment`, `verifyWebhook`, `name`,
`isTestMode`. `PayoutProvider`: `createPayout`. Seçim ortam değişkeniyle yapılır:

| Değişken           | Değerler             | Üretim                                                  |
| ------------------ | -------------------- | ------------------------------------------------------- |
| `PAYMENT_PROVIDER` | `mock` \| `disabled` | `mock` **yasak** (şema ve `financeConfigFrom` reddeder) |
| `PAYOUT_PROVIDER`  | `mock` \| `disabled` | `mock` **yasak**                                        |

Gerçek bir sağlayıcı eklemek = bu arayüzü uygulayan yeni bir sınıf + sözleşme, test hesabı ve
hukuki onay. Bu fazda iyzico, PayTR vb. hiçbir gerçek API varsayılmadı ve çağrılmadı.

### Ödeme akışı

1. `POST /jobs/:id/payments` (`Idempotency-Key` zorunlu). **Tutar sunucuda hesaplanır**:
   `Job.currentTotalMinor − yakalanan ödemeler`. İstemci tutar göndermez (gönderirse yok sayılır).
2. Ödeme `PENDING` açılır, bir deneme (`payment_transactions`, `attemptNumber`) oluşur,
   sağlayıcıya DB transaction'ı **dışında** gidilir; sağlayıcı kimliği denemeye yazılır.
3. Sonuç yalnızca doğrulanmış webhook (veya sunucudan sunucuya yanıt) ile gelir:
   `payment.succeeded | failed | cancelled`. Başarıda aynı transaction'da ödeme `SUCCEEDED`,
   ücret anlık görüntüsü, usta kazancı ve defter kaydı yazılır.
4. Kart reddi ödemeyi bitirmez: aynı ödemeye yeni deneme açılır (en fazla
   `FINANCE_MAX_PAYMENT_ATTEMPTS`, varsayılan 5). Kullanıcı mesajı: "Ödeme alınamadı. Lütfen
   tekrar deneyin." (kart reddinde "Kart reddedildi…").
5. İş başına aynı anda tek aktif ödeme vardır (kısmi tekil indeks). Farklı anahtarla ikinci
   dokunuş aynı ödemeyi döner; aynı anahtar her zaman aynı sonucu döner, başka iş için
   kullanılırsa `IDEMPOTENCY_KEY_REUSED`.

### Ek iş farkı (strateji A)

Kabul edilen ek iş anlaşılan fiyatı değiştirmez, güncel toplamı artırır (ADR-0015). Ödenmiş işte
fark **ayrı bir ödemedir**: özet kartı "Kalan ₺500 ÖDE" gösterir. Sessiz ek çekim yoktur. Ücret
kümülatif hesaplanır (bkz. ADR-0020): ₺2.200 → ₺330, +₺500 → ₺75, toplam ₺405 = ₺2.700'ün %15'i.
Bekleyen eski tutarlı ödeme, yeni tutar gerektiğinde iptal edilir.

### Webhook güvenliği

- `POST /webhooks/payments/:provider`, ham gövde (`rawBody`) üzerinden imza. Mock: HMAC-SHA256
  `t=<unix>,v1=<hex>` başlığı `ustago-mock-signature`, imzalanan metin `"<t>.<ham gövde>"`,
  sabit zamanlı karşılaştırma, ±`PAYMENT_WEBHOOK_TOLERANCE_SECONDS` (300 sn) pencere.
- 404 bilinmeyen sağlayıcı, 400 bozuk gövde, 401 imza/zaman hatası (`WEBHOOK_SIGNATURE_INVALID`,
  `WEBHOOK_TIMESTAMP_OUT_OF_RANGE`), 200 işlendi/tekrar.
- Tekrar önleme: `processed_webhook_events (provider, event_id)` tekil; olay kaydı ve durum
  değişikliği aynı transaction'dadır. Aynı olay 5 kez aynı anda gelse de bir kez işlenir.
- Sıra dışı olaylar yalnızca ileri gider: başarıdan sonra gelen "failed/pending" `IGNORED_STALE`.
  Tek istisna: bizim geri çektiğimiz (iş iptali) veya başarısız saydığımız denemeye sağlayıcı
  "başarılı" derse para gerçekten çekilmiştir; kaydedilir ve **otomatik tam iade** edilir.
- Tutarı denemeyle uyuşmayan olay `IGNORED_UNKNOWN` olarak saklanır, para durumunu değiştirmez.
- Yük saklanmadan önce `redact()` ile kart numarası benzeri diziler, token, imza, IBAN, secret
  alanları temizlenir; imza başlığı saklanmaz, loglanmaz.

### Test ödemesi (yalnız geliştirme)

`MockPaymentProvider` parayı yalnızca bellekte "görür". Geliştirme ekranındaki "Başarılı ödeme
(TEST)" / "Başarısız ödeme (TEST)" düğmeleri `POST /dev/payments/:id/simulate` çağırır; bu uç
mock sağlayıcının **imzalı webhook'unu üretir ve gerçek webhook yolundan geçirir**. Dev uçları
(`/dev/payments/*`, `/admin/dev/payouts/*`) `DevFinanceGuard` ile kapalı-güvenlidir: üretimde
veya mock sağlayıcı yokken 404 döner. Mobil ve admin arayüzü "TEST ÖDEME ORTAMI — gerçek ücret
alınmaz" / "TEST ÖDEME SAĞLAYICISI AKTİF — Gerçek para hareketi yoktur." gösterir.

### Asla saklanmayanlar

PAN, CVV, tam kart numarası, ham kart yükü, tam IBAN (yalnız maskeli hâl + son 4 hane),
sağlayıcı secret'ları. Kart bilgisi hiçbir zaman UstaGO API'sine gelmez (barındırılan ödeme
sayfası / token modeli varsayılır).

## Sonuçlar

- Gerçek sağlayıcı geldiğinde iş kuralları değişmez; yalnızca adaptör, imza doğrulaması ve
  sağlayıcıya özgü durum eşlemesi yazılır.
- `PAYMENTS_ENABLED`, `CASH_ENABLED`, `PAYOUTS_ENABLED` bayrakları ilgili akışı 503 ile kapatır.
