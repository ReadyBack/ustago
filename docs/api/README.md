# API

- Taban yol: `/api/v1`
- Swagger UI (lokal): http://localhost:3000/api/docs — ham şema: `/api/docs-json`
- Kimlik doğrulama: `Authorization: Bearer <accessToken>` ([ADR-0007](../adr/0007-auth-ve-token-stratejisi.md))
- İstek/yanıt şemaları: `@ustago/validation` (Zod) ve `@ustago/types`; Swagger bunlardan üretilir.

## Yanıt biçimi

- Tek kaynak: nesnenin kendisi (`GET /me` → `CurrentUser`).
- Liste (sayfalı): `{ "items": [...], "nextCursor": "uuid" | null }`. Sonraki sayfa için
  `?cursor=<nextCursor>&limit=20` (limit 1–100).
- Gövdesiz başarı: `204 No Content`.
- Tarihler ISO 8601 UTC (`2026-09-29T22:00:00.000Z`). Para `{ amountMinor, currency }` ([ADR-0006](../adr/0006-para-saklama-stratejisi.md)).
- Her yanıt `X-Request-Id` başlığı taşır; istemci kendi değerini gönderebilir.

## Hata biçimi

Tüm hatalar aynı gövdeyi döner (`ApiErrorResponse`):

```json
{
  "statusCode": 401,
  "code": "INVALID_CREDENTIALS",
  "message": "E-posta veya şifre hatalı.",
  "path": "/api/v1/auth/login",
  "timestamp": "2026-09-29T22:00:00.000Z",
  "requestId": "0b6c..."
}
```

- `code` sabittir, istemci mantığı buna göre kurulur; `message` kullanıcıya gösterilebilir (Türkçe).
- `details` isteğe bağlıdır. Doğrulama hatasında `[{ "path": "email", "message": "..." }]`,
  rate limit'te `{ "retryAfterSeconds": 42 }`.
- 5xx hatalarında iç ayrıntı (stack, SQL, tablo adı) dönmez; sunucu loguna `requestId` ile yazılır.

| HTTP | code                                                                                                         | Anlamı                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 400  | `VALIDATION_FAILED`                                                                                          | Girdi şemaya uymuyor (`details`: alan listesi)                               |
| 400  | `PARENT_NOT_FOUND`, `CATEGORY_TOO_DEEP`                                                                      | Kategori kuralı                                                              |
| 400  | `OTP_INVALID`                                                                                                | Kod hatalı / kullanılmış / yok (`details.attemptsRemaining`)                 |
| 400  | `OTP_EXPIRED`                                                                                                | Kodun süresi doldu (→ yeni kod iste)                                         |
| 400  | `STORAGE_CONTENT_TYPE_MISMATCH`                                                                              | Yükleme Content-Type'ı imzalı değerden farklı                                |
| 401  | `AUTH_REQUIRED`                                                                                              | Token yok                                                                    |
| 401  | `ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED`                                                               | Token geçersiz / süresi dolmuş (→ refresh)                                   |
| 401  | `SESSION_REVOKED`                                                                                            | Oturum kapatılmış (→ tekrar giriş)                                           |
| 401  | `INVALID_CREDENTIALS`                                                                                        | E-posta veya şifre hatalı                                                    |
| 401  | `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED`                                                              | Refresh başarısız (→ tekrar giriş)                                           |
| 403  | `FORBIDDEN`                                                                                                  | Rol yetmiyor                                                                 |
| 403  | `ACCOUNT_SUSPENDED`, `ACCOUNT_BANNED`                                                                        | Hesap kullanılamıyor                                                         |
| 403  | `CANNOT_CHANGE_SELF`                                                                                         | Kendi durumunu/süper yöneticiliğini değiştirme                               |
| 403  | `CANNOT_REVIEW_SELF`                                                                                         | Admin kendi usta başvurusunu/belgesini inceleyemez                           |
| 403  | `STORAGE_LINK_INVALID`                                                                                       | İmzalı bağlantı geçersiz, süresi dolmuş veya başka işlem için                |
| 404  | `NOT_FOUND`, `USER_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `PROVINCE_NOT_FOUND`, `DEVICE_NOT_FOUND`                | Kayıt yok                                                                    |
| 404  | `PROVIDER_PROFILE_NOT_FOUND`, `PROVIDER_NOT_FOUND`                                                           | Usta profili yok / public profil yok (aktif değil)                           |
| 404  | `ADDRESS_NOT_FOUND`                                                                                          | Adres yok **veya başkasına ait** (IDOR: ayrım yapılmaz)                      |
| 404  | `VERIFICATION_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `UPLOAD_NOT_FOUND`, `STORAGE_OBJECT_NOT_FOUND`               | Belge / yükleme yok                                                          |
| 409  | `EMAIL_TAKEN`, `PHONE_TAKEN`, `ACCOUNT_EXISTS`, `PROVIDER_PROFILE_EXISTS`, `CATEGORY_SLUG_TAKEN`, `CONFLICT` | Çakışma                                                                      |
| 409  | `PHONE_ALREADY_IN_USE`                                                                                       | Numara başka bir hesapta doğrulanmış                                         |
| 409  | `INVALID_PROVIDER_STATE`                                                                                     | Usta durumu bu işleme izin vermiyor (`details.status`)                       |
| 409  | `PROVIDER_NOT_ACTIVE`                                                                                        | Müsaitlik yalnızca ACTIVE usta için                                          |
| 409  | `VERIFICATION_ALREADY_REVIEWED`                                                                              | Belge başka bir admin tarafından zaten incelendi                             |
| 409  | `VERIFICATION_ALREADY_PENDING`                                                                               | Aktif ustanın aynı türde incelenen belgesi var                               |
| 409  | `STORAGE_OBJECT_EXISTS`                                                                                      | Bağlantı zaten kullanıldı (yükleme tek seferlik)                             |
| 403  | `JOB_WRONG_PARTY`                                                                                            | İşin adımı diğer tarafa ait (ör. müşteri "yola çıktım" diyemez)              |
| 403  | `REVIEW_NOT_ALLOWED`                                                                                         | Değerlendirmeyi yalnız işin müşterisi yapar                                  |
| 404  | `JOB_NOT_FOUND`, `CHANGE_ORDER_NOT_FOUND`, `REVIEW_NOT_FOUND`, `DISPUTE_NOT_FOUND`, `PENALTY_NOT_FOUND`      | Kayıt yok **veya çağıranın değil** (ayrım yapılmaz)                          |
| 409  | `JOB_INVALID_TRANSITION`                                                                                     | İşin mevcut durumunda bu adım yapılamaz (`details.status`)                   |
| 409  | `JOB_HAS_PENDING_CHANGE_ORDER`                                                                               | Bekleyen ek iş varken tamamlama istenemez                                    |
| 409  | `CHANGE_ORDER_NOT_ALLOWED`, `CHANGE_ORDER_ALREADY_PENDING`                                                   | Ek iş yalnız iş sürerken ve tek tek istenir                                  |
| 409  | `CHANGE_ORDER_NOT_PENDING`, `CHANGE_ORDER_STALE`                                                             | Ek iş zaten yanıtlandı / iş toplamı değişti (→ güncel hali çek)              |
| 409  | `DISPUTE_ALREADY_OPEN`, `DISPUTE_ALREADY_RESOLVED`                                                           | Açık bildirim var / başka admin zaten karar verdi                            |
| 409  | `REVIEW_NOT_ALLOWED`, `REVIEW_ALREADY_EXISTS`, `REVIEW_NOT_EDITABLE`                                         | İş tamamlanmadı / iş başına tek yorum / 30 günlük düzenleme süresi doldu     |
| 409  | `REVIEW_MODERATION_CONFLICT`, `PENALTY_NOT_ACTIVE`                                                           | Moderasyon durumu değişmiş / yaptırım artık yürürlükte değil                 |
| 413  | `FILE_TOO_LARGE`                                                                                             | Yüklenen dosya imzalı sınırı aşıyor                                          |
| 422  | `PROVIDER_ONBOARDING_INCOMPLETE`                                                                             | Başvuru eksik (`details.missingSteps`)                                       |
| 422  | `PROVIDER_PROFILE_INCOMPLETE`                                                                                | Onay/aktif usta için profil, hizmet veya bölge eksik                         |
| 422  | `VERIFICATION_REQUIRED`                                                                                      | Onay için zorunlu belgeler onaylanmamış (`details.missingVerificationTypes`) |
| 422  | `INVALID_VERIFICATION_FILE`                                                                                  | Boyut aşımı veya içerik JPEG/PNG/PDF değil                                   |
| 422  | `UPLOAD_NOT_COMPLETED`, `UPLOAD_EXPIRED`                                                                     | Dosya yüklenmemiş / yükleme süresi dolmuş                                    |
| 422  | `CATEGORY_NOT_AVAILABLE`                                                                                     | Kategori pasif veya yok (`details.categoryIds`)                              |
| 422  | `DISTRICT_NOT_FOUND`, `DISTRICT_PROVINCE_MISMATCH`                                                           | İlçe yok / seçilen ile ait değil                                             |
| 422  | `NOW_CATEGORY_NOT_SUPPORTED`                                                                                 | Kategori NOW (acil) desteklemiyor                                            |
| 422  | `NOW_NOT_AVAILABLE`                                                                                          | Bu il × kategori çiftlerinde NOW kapalı veya tercih kapalı                   |
| 422  | `ADDRESS_LIMIT_REACHED`                                                                                      | Kullanıcı başına en fazla 20 adres                                           |
| 422  | `CHANGE_ORDER_INVALID_AMOUNT`                                                                                | Ek iş tutarı üst sınırı aşıyor                                               |
| 422  | `DISPUTE_REASON_NOT_ALLOWED`                                                                                 | Usta gelmeden yalnız `NO_SHOW` bildirilebilir                                |
| 422  | `PENALTY_INVALID_WINDOW`                                                                                     | Yaptırım bitişi geçmişte veya başlangıçtan önce                              |
| 429  | `RATE_LIMITED`, `OTP_RATE_LIMITED`                                                                           | Çok fazla istek (`details.retryAfterSeconds`, `Retry-After` başlığı)         |
| 429  | `OTP_TOO_MANY_ATTEMPTS`                                                                                      | Kod kilitlendi (→ yeni kod iste)                                             |
| 500  | `INTERNAL_ERROR`                                                                                             | Beklenmeyen hata                                                             |
| 503  | `SMS_UNAVAILABLE`, `STORAGE_UNAVAILABLE`                                                                     | SMS veya belge depolama şu an kullanılamıyor                                 |

Tekrar gönderilen başvuru (`POST /providers/me/submit` zaten PENDING_REVIEW iken) hata değil, aynı
profili döner: istemci güvenle yeniden deneyebilir. Bu yüzden ayrı bir `PROVIDER_ALREADY_SUBMITTED`
kodu yoktur.

## Kimlik doğrulama akışı

1. `POST /auth/register`, `POST /auth/login` veya telefonla `POST /auth/otp/request` +
   `POST /auth/otp/verify` → `{ user, tokens }` (OTP yanıtında ayrıca `isNewUser`).
2. İstemci `accessToken` (15 dk) ile istek atar; `refreshToken`'ı güvenli saklar.
3. `401 ACCESS_TOKEN_EXPIRED` gelince `POST /auth/refresh { refreshToken }` → yeni token çifti.
   Eski refresh token artık geçersizdir; tekrar kullanılırsa oturum kapatılır.
4. `POST /auth/logout` bu oturumu, `POST /auth/logout-all` tüm oturumları kapatır.

## Uç noktalar

Kilit: 🔓 herkese açık, 🔐 giriş gerekli, rol belirtilmişse o rol gerekli (`SUPER_ADMIN`, `ADMIN`'i kapsar).

| Uç nokta                                                                       | Erişim         | Açıklama                                                                            |
| ------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------- |
| `GET /health`, `GET /health/live`                                              | 🔓             | Hazırlık / canlılık                                                                 |
| `POST /auth/register`                                                          | 🔓             | Müşteri veya usta hesabı (`accountType`)                                            |
| `POST /auth/login`                                                             | 🔓             | E-posta + şifre                                                                     |
| `POST /auth/otp/request`                                                       | 🔓 / 🔐        | Kod gönderir. `REGISTER_OR_LOGIN` (varsayılan) veya `VERIFY_PHONE` (giriş gerekli)  |
| `POST /auth/otp/verify`                                                        | 🔓 / 🔐        | Kodla giriş/kayıt veya telefon doğrulama                                            |
| `POST /auth/refresh`                                                           | 🔓             | Refresh token rotation                                                              |
| `POST /auth/logout`                                                            | 🔐             | Bu oturumu kapatır, cihazın push token'ını siler                                    |
| `POST /auth/logout-all`                                                        | 🔐             | Tüm oturumları ve cihaz token'larını kapatır                                        |
| `GET /me`, `PATCH /me`                                                         | 🔐             | Kullanıcı, roller, profiller / ad, soyad, dil                                       |
| `POST /me/devices`, `DELETE /me/devices/:id`                                   | 🔐             | Cihaz / push token kaydı                                                            |
| `GET /me/addresses`, `POST /me/addresses`                                      | 🔐             | Adres listesi (varsayılan önce) / ekleme (ilk adres varsayılan)                     |
| `GET /me/addresses/:id`, `PATCH /me/addresses/:id`, `DELETE /me/addresses/:id` | 🔐             | Tek adres; silme yumuşaktır, varsayılan en yeni adrese geçer                        |
| `PUT /me/addresses/:id/default`                                                | 🔐             | Varsayılan adresi değiştirir                                                        |
| `POST /providers/me`                                                           | 🔐             | Usta profili açar (DRAFT), `PROVIDER` rolü ekler                                    |
| `GET /providers/me`, `PATCH /providers/me`                                     | 🔐 PROVIDER    | Usta profili                                                                        |
| `GET /providers/me/onboarding`                                                 | 🔐 PROVIDER    | Adımlar, eksikler, `canSubmit`, son karar sebebi                                    |
| `GET/PUT /providers/me/services`                                               | 🔐 PROVIDER    | Hizmet kategorileri (liste tümüyle değişir)                                         |
| `GET/PUT /providers/me/service-areas`                                          | 🔐 PROVIDER    | Hizmet ilçeleri, il bazında gruplu                                                  |
| `PATCH /providers/me/availability`                                             | 🔐 PROVIDER    | `nowEnabled` tercihi, `isAvailableNow` müsaitlik                                    |
| `GET /providers/me/verifications`                                              | 🔐 PROVIDER    | Belgeler (depolama anahtarı dönmez)                                                 |
| `POST /providers/me/verifications/upload-intent`                               | 🔐 PROVIDER    | İmzalı yükleme adresi                                                               |
| `POST /providers/me/verifications`                                             | 🔐 PROVIDER    | Yüklenen dosyayı incelemeye gönderir                                                |
| `POST /providers/me/submit`                                                    | 🔐 PROVIDER    | DRAFT → PENDING_REVIEW (idempotent)                                                 |
| `POST /providers/me/reapply`                                                   | 🔐 PROVIDER    | REJECTED → DRAFT                                                                    |
| `GET /providers/:id`                                                           | 🔓             | Aktif ustanın public profili (yalnızca izinli alanlar)                              |
| `GET /categories`, `GET /categories/:slug`                                     | 🔓             | Aktif kategori ağacı / tek kategori                                                 |
| `POST /categories`, `PATCH /categories/:id`                                    | 🔐 ADMIN       | Kategori yönetimi                                                                   |
| `GET /locations/provinces`                                                     | 🔓             | 81 il; `?active=true` yalnızca açık iller                                           |
| `GET /locations/provinces/:id/districts`                                       | 🔓             | İlin ilçeleri; `includeInactive=true` yalnızca admin                                |
| `GET /locations/provinces/:id/categories`                                      | 🔓             | İlde açık kategoriler ve NOW durumu; `includeInactive=true` yalnızca admin          |
| `PATCH /locations/provinces/:id`                                               | 🔐 ADMIN       | İli açar/kapatır                                                                    |
| `PUT /locations/provinces/:id/categories/:categoryId`                          | 🔐 ADMIN       | Kategori bu ilde açık mı, NOW açık mı                                               |
| `GET /admin/providers`                                                         | 🔐 ADMIN       | Başvurular (`status`, varsayılan PENDING_REVIEW; en eski önce)                      |
| `GET /admin/providers/:id`, `GET /admin/providers/:id/verifications`           | 🔐 ADMIN       | Başvuru detayı / belgeleri                                                          |
| `POST /admin/providers/:id/{approve,reject,suspend,reinstate}`                 | 🔐 ADMIN       | Karar; `reject` ve `suspend` için `{ reason }` zorunlu                              |
| `GET /admin/provider-verifications`                                            | 🔐 ADMIN       | Belge kuyruğu (`status`, `type`)                                                    |
| `POST /admin/provider-verifications/:id/document-url`                          | 🔐 ADMIN       | 2 dakikalık imzalı okuma adresi (audit'e yazılır)                                   |
| `POST /admin/provider-verifications/:id/{approve,reject}`                      | 🔐 ADMIN       | Belge kararı; `reject` için `{ reason }`                                            |
| `GET /admin/audit-events`                                                      | 🔐 ADMIN       | Denetim kaydı (`entityType`, `entityId`, `actorId`, `action`)                       |
| `POST /service-requests`                                                       | 🔐             | Talep (QUOTE / NOW); `budgetMinor` null olabilir, tavan değildir; `idempotencyKey`  |
| `POST /service-requests/photos/upload-intent`                                  | 🔐             | Talep fotoğrafı için imzalı yükleme (JPEG/PNG, 10 MB, en fazla 5)                   |
| `GET /service-requests/:id`, `PATCH /service-requests/:id`                     | 🔐             | Müşterinin kendi talebi / düzenleme (teklif sonrası kategori ve adres kilitli)      |
| `POST /service-requests/:id/publish`, `POST /service-requests/:id/cancel`      | 🔐             | Yayınlama (tekrar etkisiz) / iptal (anlaşma sonrası 409)                            |
| `GET /service-requests/:id/photos/:photoId/url`                                | 🔐             | Fotoğraf için 5 dakikalık imzalı adres                                              |
| `GET /me/service-requests`                                                     | 🔐             | Taleplerim: `group=OPEN`, `AGREED`, `CLOSED`                                        |
| `POST /service-requests/:id/quotes`                                            | 🔐 PROVIDER    | İlk teklif (bütçenin üstünde olabilir); usta başına tek teklif                      |
| `GET /service-requests/:id/quotes`                                             | 🔐             | Gelen teklifler, revizyonlarıyla (yalnız talep sahibi)                              |
| `GET /quotes/:id`                                                              | 🔐             | Pazarlık dizisi (yalnız müşteri ve teklifin ustası)                                 |
| `POST /quotes/:id/counter`                                                     | 🔐             | Karşı teklif, sıra kimdeyse; `expectedRevisionNo` zorunlu. NOW'da yok               |
| `POST /quotes/:id/accept`                                                      | 🔐             | Kabul: fiyat kilitlenir, iş oluşur, rakip teklifler kapanır                         |
| `POST /quotes/:id/reject`, `POST /quotes/:id/withdraw`                         | 🔐             | Müşteri reddeder / usta geri çeker                                                  |
| `GET /providers/me/opportunities`, `GET /providers/me/opportunities/:id`       | 🔐 PROVIDER    | Size uygun açık işler (yalnız il/ilçe; müşteri kimliği ve açık adres yok)           |
| `GET /providers/me/quotes`                                                     | 🔐 PROVIDER    | Tekliflerim (`filter=WAITING`, `NEGOTIATING`, …)                                    |
| `GET /jobs`, `GET /jobs/:id`                                                   | 🔐             | İşler (`role=CUSTOMER`/`PROVIDER`); detayda anlaşılan fiyat, tam adres, iletişim    |
| `POST /jobs/:id/{en-route,arrive,start,request-completion}`                    | 🔐 (usta)      | İş adımları; tekrar çağrı etkisiz (200, aynı iş)                                    |
| `POST /jobs/:id/complete`, `POST /jobs/:id/dispute`                            | 🔐 (müşteri)   | Tamamlandı onayı / sorun bildirimi `{ reason, description }`                        |
| `POST /jobs/:id/cancel`                                                        | 🔐             | Usta yola çıkmadan iptal `{ reason }`                                               |
| `GET /jobs/:id/change-orders`, `POST /jobs/:id/change-orders`                  | 🔐             | Ek işler / usta ek iş ister `{ amountMinor, description }`                          |
| `POST /change-orders/:id/{accept,reject,cancel}`                               | 🔐             | Müşteri onaylar/reddeder, usta geri çeker                                           |
| `POST /jobs/:id/review`, `PATCH /reviews/:id`                                  | 🔐 (müşteri)   | Değerlendirme (iş başına bir) / 30 gün içinde düzenleme                             |
| `GET /providers/:id/reviews`                                                   | 🔓             | Yayındaki yorumlar, maskeli adla                                                    |
| `GET /me/notifications`, `POST /me/notifications/read`                         | 🔐             | Uygulama içi bildirimler (imleçli), okundu işareti (seçili veya tümü)               |
| `GET /me/notifications/unread-count`                                           | 🔐             | Zil rozeti                                                                          |
| `GET/PATCH /me/notification-preferences`                                       | 🔐             | Push tercihleri (iş güncellemeleri kapatılamaz)                                     |
| `GET /admin/jobs`, `GET /admin/jobs/:id`                                       | 🔐 ADMIN       | İşler (`status`, `providerId`, `customerId`, `provinceId`, `categoryId`, `from/to`) |
| `GET /admin/disputes`, `GET /admin/disputes/:id`                               | 🔐 ADMIN       | Sorun bildirimleri (`group=OPEN/RESOLVED`)                                          |
| `POST /admin/disputes/:id/resolve`                                             | 🔐 ADMIN       | `{ outcome, note }`; iki tarafa bildirim                                            |
| `GET /admin/reviews`, `POST /admin/reviews/:id/{hide,restore}`                 | 🔐 ADMIN       | Moderasyon `{ reason }`                                                             |
| `GET /admin/providers/:id/quality`                                             | 🔐 ADMIN       | UstaScore etkenleri, sayılar, yaptırımlar                                           |
| `POST /admin/providers/:id/penalties`, `POST /admin/penalties/:id/revoke`      | 🔐 ADMIN       | Yaptırım ver / kaldır (gerekçe zorunlu)                                             |
| `GET /admin/stats`                                                             | 🔐 ADMIN       | Dashboard sayıları (`tz`, varsayılan Europe/Istanbul)                               |
| `GET /admin/service-requests`, `GET /admin/service-requests/:id`               | 🔐 ADMIN       | Talepler (`status`, `type`, `provinceId`, `categoryId`) / detay (maskeli)           |
| `GET /admin/system-status`                                                     | 🔐 ADMIN       | Ortam, sürücüler, DB/Redis durumu; secret içermez                                   |
| `GET /users`, `GET /users/:id`, `PATCH /users/:id/status`                      | 🔐 ADMIN       | Kullanıcı yönetimi                                                                  |
| `PUT/DELETE /users/:id/roles/:role`                                            | 🔐 SUPER_ADMIN | `ADMIN` / `SUPER_ADMIN` verir / kaldırır                                            |

Auth uç noktaları IP (login'de ayrıca e-posta) başına rate limit'lidir: varsayılan 60 sn'de 10 istek.

OTP uçları ayrıca numara başına pencere, yeniden gönderme bekleme süresi ve doğrulama denemesi
sayaçlarıyla korunur ([ADR-0009](../adr/0009-telefon-otp-ve-sms.md)).

## Usta onboarding akışı

1. Telefonla giriş (`/auth/otp/*`) veya e-posta hesabında `VERIFY_PHONE`.
2. `POST /providers/me` → DRAFT. `GET /providers/me/onboarding` eksik adımları söyler.
3. `PATCH /providers/me` (tanıtım ≥ 20 karakter, deneyim yılı), `PUT /providers/me/services`,
   `PUT /providers/me/service-areas { areas: [{ provinceId, districtIds }] }`.
4. Belge: `upload-intent` → dönen `uploadUrl`'e `PUT` (dönen `headers` ile) → `POST
/providers/me/verifications { type, uploadId }`. En az `IDENTITY` gerekir.
5. `POST /providers/me/submit` → PENDING_REVIEW. Bu durumda profil, hizmet, bölge ve belge
   değiştirilemez.
6. Admin belgeyi onaylar, sonra başvuruyu onaylar → ACTIVE. Red durumunda sebep
   `statusReason`/onboarding yanıtında görünür; `POST /providers/me/reapply` ile DRAFT'a dönülür.
7. ACTIVE usta `PATCH /providers/me/availability { nowEnabled: true, isAvailableNow: true }`.

Kurallar: [ADR-0010](../adr/0010-usta-yasam-dongusu-ve-now.md), belgeler:
[ADR-0011](../adr/0011-dogrulama-belgeleri-ve-nesne-depolama.md).

## Talep → teklif → pazarlık → iş

1. Müşteri `POST /service-requests { type: "QUOTE", categoryId, addressId, title, description,
budgetMinor: 150000 | null }` (kuruş). `null` = "Bütçem belli değil".
2. Uygun usta `GET /providers/me/opportunities` ile görür, `POST /service-requests/:id/quotes
{ totalMinor: 250000, ... }` ile teklif verir. Bütçenin üstündeki tutar reddedilmez.
3. Taraflar sırayla `POST /quotes/:id/counter { totalMinor, expectedRevisionNo }` gönderir. Arada
   başka hamle olduysa 409 `QUOTE_REVISION_STALE`: güncel hali çekip tekrar deneyin.
4. Sırası gelen taraf `POST /quotes/:id/accept { expectedRevisionNo }`. Yanıt `jobId` içerir;
   `GET /jobs/:id` anlaşılan fiyatı (`agreedPrice`, değişmez), tam adresi ve telefonları döner.
5. NOW: `type: "NOW"`; uygun ve müsait ustalar `opportunities`'te görür, tek fiyat verir, karşı
   teklif yoktur.

Kurallar ve eşzamanlılık: [ADR-0014](../adr/0014-talep-teklif-pazarlik-ve-now.md).

## İş yaşam döngüsü, ek iş, değerlendirme (Faz 4)

1. Usta sırayla `en-route` → `arrive` → `start` → `request-completion`; müşteri `complete`.
   Her yanıt güncel `Job` döner; `actions` alanı o an izin verilen adımları söyler.
2. İş sürerken usta `POST /jobs/:id/change-orders { amountMinor: 50000, description }`; müşteri
   `accept` → `currentTotal` 270000 olur, `agreedPrice` 220000 kalır.
3. Tamamlanan işte müşteri `POST /jobs/:id/review { rating: 5, qualityRating?, …, comment? }`.
4. Bildirimler aynı transaction'da yazılır; push outbox'tan işçi tarafından gönderilir.

Kurallar: [ADR-0015](../adr/0015-is-yasam-dongusu-ve-ek-is.md),
[ADR-0016](../adr/0016-ustascore-v1-ve-usta-kalite-modeli.md),
[ADR-0017](../adr/0017-bildirim-outbox-ve-expo-push.md).

## Ödeme, nakit, kazanç, iade ve para çekme (Faz 5)

Bu fazda **gerçek para hareketi yoktur**: `PAYMENT_PROVIDER=mock` test sağlayıcısıdır ve üretimde
açılamaz. Tüm tutarlar kuruş (`amountMinor`, tamsayı); tutarı hep sunucu hesaplar.

| Uç nokta                                                                    | Kim            | Not                                                                   |
| --------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `GET /jobs/:id/payment-summary`                                             | İşin tarafları | Toplam, ödenen, kalan, yöntem, nakit durumu, `actions`, usta kırılımı |
| `PUT /jobs/:id/payment-method` `{ method: IN_APP \| CASH }`                 | Müşteri        | Ödeme yapılınca kilitlenir (`PAYMENT_METHOD_LOCKED`)                  |
| `POST /jobs/:id/payments` + `Idempotency-Key`                               | Müşteri        | Kalan tutar için ödeme; aynı anahtar aynı sonucu döner                |
| `POST /jobs/:id/cash/confirm`, `POST /jobs/:id/cash/dispute`                | İşin tarafları | İki taraflı nakit onayı / anlaşmazlık                                 |
| `GET /me/payments`, `GET /me/payments/:id`                                  | Müşteri        | Ödemelerim, Ödeme Özeti (fatura değildir)                             |
| `GET /me/wallet`, `/me/wallet/transactions`, `/me/earnings[/:id]`           | Usta           | Kazançlarım (bakiyeler defterden hesaplanır)                          |
| `GET/PUT /me/payout-destination`                                            | Usta           | TEST banka hesabı; yalnız maskeli IBAN döner                          |
| `GET/POST /me/payouts` (+ `Idempotency-Key`), `POST /me/payouts/:id/cancel` | Usta           | Para Çek                                                              |
| `POST /webhooks/payments/:provider`                                         | Sağlayıcı      | İmzalı ham gövde; token yok                                           |
| `POST /dev/payments/:id/simulate` `{ outcome }`                             | Ödeyen (dev)   | Yalnız geliştirme + mock; aksi halde 404                              |
| `GET /admin/finance/summary?range=today\|7d\|30d`                           | Admin          | Gerçek DB toplamları                                                  |
| `GET /admin/finance/payments[/:id]`, `POST …/:id/refunds` + key             | Admin          | Liste, detay (denemeler, iadeler, defter, denetim), iade              |
| `GET /admin/finance/ledger[/:id]`                                           | Admin          | Defter (salt okunur)                                                  |
| `GET /admin/finance/payouts`, `POST …/:id/approve \| cancel`                | Admin          | Para çekme talepleri                                                  |
| `POST /admin/dev/payouts/:id/mark-paid \| mark-failed`                      | Admin (dev)    | TEST; üretimde yok                                                    |
| `GET /admin/finance/cash-settlements`, `POST …/:id/resolve`                 | Admin          | Nakit anlaşmazlığı sonucu (kayıt)                                     |
| `GET /admin/finance/reconciliation`                                         | Admin          | Mutabakat raporu; hiçbir şeyi düzeltmez                               |

Faz 5 hata kodları:

| HTTP | code                                                                                                         | Anlamı                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 400  | `IDEMPOTENCY_KEY_REQUIRED`                                                                                   | Para hareketi başlatan istekte geçerli `Idempotency-Key` yok        |
| 400  | `WEBHOOK_MALFORMED`                                                                                          | Webhook gövdesi okunamadı                                           |
| 401  | `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_TIMESTAMP_OUT_OF_RANGE`                                                | İmza hatalı / zaman penceresi dışında (tekrar oynatma)              |
| 403  | `PAYMENT_WRONG_PARTY`, `PROVIDER_ONLY`                                                                       | İşlem diğer tarafın / yalnız usta hesabının                         |
| 404  | `PAYMENT_NOT_FOUND`, `EARNING_NOT_FOUND`, `PAYOUT_NOT_FOUND`, `CASH_SETTLEMENT_NOT_FOUND`, `ROUTE_NOT_FOUND` | Yok veya başkasına ait; dev uçları kapalı                           |
| 409  | `PAYMENT_NOT_ALLOWED`, `PAYMENT_NOTHING_DUE`, `PAYMENT_METHOD_IS_CASH`, `PAYMENT_METHOD_LOCKED`              | Ödeme bu durumda yapılamaz                                          |
| 409  | `IDEMPOTENCY_KEY_REUSED`                                                                                     | Anahtar başka bir işlem için kullanılmış                            |
| 409  | `CASH_NOT_SELECTED`, `CASH_NOT_ALLOWED`, `CASH_INVALID_STATE`                                                | Nakit akışı kuralı                                                  |
| 409  | `REFUND_NOT_ALLOWED`, `REFUND_STALE`                                                                         | İade edilemez / ekrandaki tutar değişti (`details.refundableMinor`) |
| 409  | `PAYOUT_DESTINATION_REQUIRED`, `PAYOUT_INVALID_STATE`                                                        | Hesap yok / talep bu durumda değiştirilemez                         |
| 422  | `REFUND_EXCEEDS_REFUNDABLE`, `INSUFFICIENT_AVAILABLE_BALANCE`, `PAYOUT_BELOW_MINIMUM`                        | Tutar sınırı                                                        |
| 422  | `DISPUTE_FINANCIAL_ACTION_REQUIRED`                                                                          | Para tutulan anlaşmazlıkta finansal karar seçilmedi                 |
| 429  | `FINANCE_RATE_LIMITED`, `WEBHOOK_RATE_LIMITED`                                                               | Hız sınırı                                                          |
| 503  | `PAYMENTS_DISABLED`, `CASH_DISABLED`, `PAYOUTS_DISABLED`, `FEE_POLICY_MISSING`                               | Özellik kapalı / ücret politikası tanımlı değil                     |

Kurallar: [ADR-0018](../adr/0018-finansal-defter-mimarisi.md),
[ADR-0019](../adr/0019-odeme-saglayici-soyutlamasi.md),
[ADR-0020](../adr/0020-platform-ucreti-ve-usta-kazanci.md).
