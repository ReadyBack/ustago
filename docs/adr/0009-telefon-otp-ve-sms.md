# ADR-0009: Telefon + OTP girişi ve SMS sağlayıcı soyutlaması

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Türkiye'de müşteri ve ustaların büyük kısmı e-posta yerine telefonla giriş yapmayı bekler. Telefon
numarası aynı zamanda usta başvurusunun ilk doğrulama adımıdır. Faz 1'de e-posta + şifre ile
oturum, refresh rotation ve çıkış altyapısı kuruldu (ADR-0007); ikinci bir oturum sistemi
yazılmamalıdır. Geliştirme ve testte gerçek (ücretli) SMS gönderilemez.

## Karar

**Akış**

- `POST /auth/otp/request { phone, purpose }` → 202, kod asla yanıtta dönmez.
- `POST /auth/otp/verify { phone, code, purpose, firstName?, lastName? }`
  - `REGISTER_OR_LOGIN`: numara doğrulanmış bir hesaba aitse giriş, değilse `CUSTOMER` rolüyle yeni
    hesap (`phoneVerifiedAt` dolu). Yanıt Faz 1'in `AuthService.startSession` ile ürettiği aynı
    access/refresh çiftidir; refresh, logout ve logout-all aynen çalışır.
  - `VERIFY_PHONE`: oturum açmış kullanıcının numarasını doğrular, token üretmez.
- Numara `@ustago/validation` içinde `libphonenumber-js` ile E.164'e normalize edilir
  (`0532 123 45 67` → `+905321234567`). Desteklenen ülke listesi (`SUPPORTED_PHONE_COUNTRIES`)
  şimdilik `['TR']` ve yalnızca mobil numaralar; yeni ülke eklemek bu listeyi genişletmektir.

**Kodun güvenliği**

- Kod `crypto.randomInt` ile üretilir (varsayılan 6 hane).
- Veritabanında yalnızca `HMAC-SHA256(OTP_HASH_SECRET, challengeId:code)` saklanır. Anahtarı
  bilmeyen biri 10⁶ olasılığı veritabanı sızıntısından deneyemez; challenge id'si sayesinde aynı
  kod farklı kayıtlarda farklı hash'e sahiptir. Karşılaştırma `timingSafeEqual` ile yapılır.
- Süre (`OTP_TTL_SECONDS`, 180 sn), deneme hakkı (`OTP_MAX_ATTEMPTS`, 5), tek kullanım.
- Deneme sayacı karşılaştırmadan **önce** tek bir `UPDATE … WHERE attempts < max_attempts
RETURNING attempts` ile artırılır; paralel tahminler hakkı aşamaz ve tam olarak son hak
  kilitler. Tüketme de koşullu güncellemedir: aynı kod iki kez kullanılamaz.
- Numara × amaç başına en fazla bir açık challenge (kısmi unique indeks). Yeni kod istemek eskisini
  geçersiz kılar.
- Rate limit (Redis): IP başına, numara başına pencere (`OTP_REQUEST_WINDOW_SECONDS` /
  `OTP_MAX_REQUESTS_PER_WINDOW`), yeniden gönderme bekleme süresi (`OTP_RESEND_COOLDOWN_SECONDS`)
  ve doğrulama denemeleri için ayrı sayaçlar. 429 yanıtı `Retry-After` başlığı taşır.

**Hesap karışıklığı saldırısı**

E-postayla kayıt olan biri, doğrulamadığı bir numarayı hesabına yazabilir. Numaranın gerçek sahibi
OTP ile kanıt sunduğunda doğrulanmamış bu iddia düşürülür (`user.phone_claim_released` audit) ve
gerçek sahip kendi hesabına girer. Doğrulanmamış bir iddia **hiçbir zaman** o hesaba giriş
sağlamaz.

**SMS sağlayıcı**

- `SmsProvider` arayüzü: `console` (kodu API loguna yazar, yalnızca geliştirme), `fake` (bellekte
  tutar, testler Nest container'ı üzerinden okur; kodu dışarı veren bir HTTP ucu yoktur),
  `disabled`.
- Ortam şeması `NODE_ENV=production` iken `console`/`fake` seçimini ve `OTP_HASH_SECRET`
  eksikliğini reddeder; adaptörler de production'da kurulmayı reddeder (iki katmanlı koruma).
- Gerçek sağlayıcı (Netgsm, İleti Merkezi vb.) canlıya çıkıştan önce aynı arayüzle eklenir;
  SMS gönderimi başarısızsa challenge geçersiz kılınır ve `503 SMS_UNAVAILABLE` döner.
- Loglarda numara maskelenir (`+90532*****67`); kod, token veya tam numara loglanmaz ve audit
  metadata'sına yazılmaz.

## Sonuçlar

- Tek hesap modeli (ADR-0005) korunur; telefon ve e-posta aynı `User`'ın iki giriş yöntemidir.
- Kod doğrulaması veritabanında satır kilidi olmadan, koşullu güncellemelerle yarış güvenlidir.
- Gerçek SMS sağlayıcısı henüz yok: canlıya çıkış için bir adaptör ve sözleşme gerekir.
- Numara değiştirme (eski numaradan yeni numaraya geçiş) bu fazda yok; `VERIFY_PHONE` yeni numarayı
  doğrular ve eskisinin yerine yazar.
