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

| HTTP | code                                                                                                                        | Anlamı                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 400  | `VALIDATION_FAILED`                                                                                                         | Girdi şemaya uymuyor                           |
| 400  | `PARENT_NOT_FOUND`, `CATEGORY_TOO_DEEP`                                                                                     | Kategori kuralı                                |
| 401  | `AUTH_REQUIRED`                                                                                                             | Token yok                                      |
| 401  | `ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED`                                                                              | Token geçersiz / süresi dolmuş (→ refresh)     |
| 401  | `SESSION_REVOKED`                                                                                                           | Oturum kapatılmış (→ tekrar giriş)             |
| 401  | `INVALID_CREDENTIALS`                                                                                                       | E-posta veya şifre hatalı                      |
| 401  | `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED`                                                                             | Refresh başarısız (→ tekrar giriş)             |
| 403  | `FORBIDDEN`                                                                                                                 | Rol yetmiyor                                   |
| 403  | `ACCOUNT_SUSPENDED`, `ACCOUNT_BANNED`                                                                                       | Hesap kullanılamıyor                           |
| 403  | `CANNOT_CHANGE_SELF`                                                                                                        | Kendi durumunu/süper yöneticiliğini değiştirme |
| 404  | `NOT_FOUND`, `USER_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `PROVINCE_NOT_FOUND`, `DEVICE_NOT_FOUND`, `PROVIDER_PROFILE_NOT_FOUND` | Kayıt yok                                      |
| 409  | `EMAIL_TAKEN`, `PHONE_TAKEN`, `ACCOUNT_EXISTS`, `PROVIDER_PROFILE_EXISTS`, `CATEGORY_SLUG_TAKEN`, `CONFLICT`                | Çakışma                                        |
| 429  | `RATE_LIMITED`                                                                                                              | Çok fazla deneme                               |
| 500  | `INTERNAL_ERROR`                                                                                                            | Beklenmeyen hata                               |

## Kimlik doğrulama akışı

1. `POST /auth/register` veya `POST /auth/login` → `{ user, tokens }`.
2. İstemci `accessToken` (15 dk) ile istek atar; `refreshToken`'ı güvenli saklar.
3. `401 ACCESS_TOKEN_EXPIRED` gelince `POST /auth/refresh { refreshToken }` → yeni token çifti.
   Eski refresh token artık geçersizdir; tekrar kullanılırsa oturum kapatılır.
4. `POST /auth/logout` bu oturumu, `POST /auth/logout-all` tüm oturumları kapatır.

## Uç noktalar

Kilit: 🔓 herkese açık, 🔐 giriş gerekli, rol belirtilmişse o rol gerekli (`SUPER_ADMIN`, `ADMIN`'i kapsar).

| Uç nokta                                 | Erişim         | Açıklama                                          |
| ---------------------------------------- | -------------- | ------------------------------------------------- |
| `GET /health`                            | 🔓             | Hazırlık: PostgreSQL ve Redis                     |
| `GET /health/live`                       | 🔓             | Canlılık                                          |
| `POST /auth/register`                    | 🔓             | Müşteri veya usta hesabı (`accountType`)          |
| `POST /auth/login`                       | 🔓             | E-posta + şifre                                   |
| `POST /auth/refresh`                     | 🔓             | Refresh token rotation                            |
| `POST /auth/logout`                      | 🔐             | Bu oturumu kapatır                                |
| `POST /auth/logout-all`                  | 🔐             | Tüm oturumları kapatır                            |
| `GET /me`                                | 🔐             | Kullanıcı, roller, profiller                      |
| `PATCH /me`                              | 🔐             | Ad, soyad, dil                                    |
| `POST /me/devices`                       | 🔐             | Cihaz / push token kaydı, oturuma bağlar          |
| `DELETE /me/devices/:id`                 | 🔐             | Cihazı kaldırır                                   |
| `POST /providers/me`                     | 🔐             | Usta profili açar, `PROVIDER` rolü ekler          |
| `GET /providers/me`                      | 🔐 PROVIDER    | Usta profili                                      |
| `PATCH /providers/me`                    | 🔐 PROVIDER    | Usta profilini günceller                          |
| `GET /categories`                        | 🔓             | Aktif kategori ağacı                              |
| `GET /categories/:slug`                  | 🔓             | Tek kategori                                      |
| `POST /categories`                       | 🔐 ADMIN       | Kategori ekler                                    |
| `PATCH /categories/:id`                  | 🔐 ADMIN       | Günceller, `isActive` ile açar/kapatır            |
| `GET /locations/provinces`               | 🔓             | 81 il; `?active=true` yalnızca açık iller         |
| `GET /locations/provinces/:id/districts` | 🔓             | İlin aktif ilçeleri                               |
| `PATCH /locations/provinces/:id`         | 🔐 ADMIN       | İli açar/kapatır                                  |
| `GET /users`                             | 🔐 ADMIN       | Kullanıcı listesi (`role`, `status`, `q`, cursor) |
| `GET /users/:id`                         | 🔐 ADMIN       | Kullanıcı                                         |
| `PATCH /users/:id/status`                | 🔐 ADMIN       | Askıya al / yasakla / aç (oturumlar kapanır)      |
| `PUT /users/:id/roles/:role`             | 🔐 SUPER_ADMIN | `ADMIN` / `SUPER_ADMIN` verir                     |
| `DELETE /users/:id/roles/:role`          | 🔐 SUPER_ADMIN | `ADMIN` / `SUPER_ADMIN` kaldırır                  |

Auth uç noktaları IP (login'de ayrıca e-posta) başına rate limit'lidir: varsayılan 60 sn'de 10 istek.
