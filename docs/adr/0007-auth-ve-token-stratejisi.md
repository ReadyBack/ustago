# ADR-0007: Kimlik doğrulama ve token stratejisi

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Mobil uygulama (Expo) ve admin paneli (Next.js) aynı API'yi kullanır. Oturum kapatma, hesap askıya
alma ve rol değişikliği hemen etkili olmalı; çalınan bir refresh token fark edilmelidir
(PROJECT.md §22).

## Karar

**Şifre**

- Argon2id (`@node-rs/argon2`, OWASP temel ayarı: 19 MiB, t=2, p=1). Düz metin şifre hiçbir yerde
  saklanmaz veya loglanmaz.
- Politika: 10–128 karakter, zorunlu karakter sınıfı yok (NIST SP 800-63B); e-postayla aynı olamaz.
- Giriş başarısızsa kullanıcı var/yok ayrımı yapılmaz (`INVALID_CREDENTIALS`); kullanıcı yoksa da
  sahte bir hash doğrulanır, yanıt süresi aynı kalır. Hesap askıda bilgisi yalnızca doğru şifreden
  sonra söylenir.

**Access token**

- HS256 JWT (`jose`), varsayılan 15 dakika (`JWT_ACCESS_TTL_SECONDS`).
- İçerik yalnızca `sub` (user id), `sid` (session id), `typ=access`, `iss`, `aud`, `iat`, `exp`,
  `jti`. Rol veya kişisel veri token'a konmaz.
- Global `JwtAuthGuard` imzayı doğruladıktan sonra oturumu ve kullanıcıyı veritabanından okur:
  oturum iptal/sona ermiş veya kullanıcı askıdaysa istek reddedilir. Böylece logout, askıya alma
  ve rol değişikliği **hemen** etkilidir. Bedeli istek başına tek bir indeksli sorgudur; gerekirse
  Redis önbelleği eklenir.
- Tüm uç noktalar varsayılan olarak korumalıdır; açık olanlar `@Public()` ile işaretlenir.

**Refresh token ve oturum**

- Her girişte bir `auth_sessions` kaydı (cihaz, IP, user-agent, mutlak bitiş) açılır.
- Refresh token 256 bit rastgele, opaktır; veritabanında yalnızca SHA-256 hash'i
  (`refresh_tokens.token_hash`) durur.
- **Rotation:** `POST /auth/refresh` token'ı tüketir (`consumed_at`) ve yenisini verir. Tüketim
  `UPDATE ... WHERE consumed_at IS NULL` ile atomiktir.
- **Reuse detection:** tüketilmiş bir token tekrar gelirse token çalınmış sayılır, oturumun tamamı
  iptal edilir (`TOKEN_REUSE`) ve audit log yazılır.
- Süreler: refresh token 30 gün (`AUTH_REFRESH_TTL_DAYS`), oturum mutlak 90 gün
  (`AUTH_SESSION_MAX_DAYS`). Rotation mutlak süreyi uzatmaz.
- `POST /auth/logout` bu oturumu, `POST /auth/logout-all` tüm oturumları kapatır.

**İstemciler**

- Mobil: refresh token `expo-secure-store` içinde saklanır.
- Admin (web): Faz 1'de token'lar JSON gövdede döner. Admin paneli tarayıcıda token
  saklamamalıdır; Next.js sunucu tarafı (route handler) refresh token'ı `httpOnly; Secure;
SameSite=Strict` cookie'de tutacak (Faz 10). API tarafında değişiklik gerekmez.

**Kötüye kullanım**

- `register`, `login` (IP ve e-posta başına) ve `refresh` Redis tabanlı sabit pencereli rate
  limit'e tabidir (varsayılan 60 sn'de 10). Redis erişilemezse istek geçer ve uyarı loglanır.
- Giriş, başarısız giriş, logout, token reuse, rol ve durum değişiklikleri `audit_logs`'a yazılır.

## Sonuçlar

- Access token çalınırsa en fazla 15 dakika ve yalnızca oturum açıkken işe yarar.
- İki sekme aynı refresh token'ı aynı anda kullanırsa biri kazanır, diğeri reuse sayılır ve oturum
  kapanır. İstemci refresh'i tek bir kuyrukta yapmalıdır; gerekirse kısa bir tolerans penceresi
  eklenebilir.
- Telefon + OTP girişi (PROJECT.md §5.3) aynı oturum altyapısını kullanacak; `users.password_hash`
  bu yüzden boş olabilir.
- Admin MFA ve hassas işlemlerde yeniden doğrulama Faz 10 kapsamındadır.
