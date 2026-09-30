# ADR-0024: Oturum ve kimlik doğrulama güvenliği (SESSION AND AUTH SECURITY)

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Faz 2'de JWT erişim token'ı + yenileme (refresh) token'ı ile giriş vardı
([ADR-0007](0007-auth-ve-token-stratejisi.md), [ADR-0013](0013-admin-kimlik-dogrulama.md)).
Üretim için eksikler: çalınan token'ın fark edilmesi, "çıkış yaptım ama token hâlâ çalışıyor"
durumunun olmaması, cihaz görünürlüğü, en az yetkili admin ve dağıtık hız sınırları.

## Karar

### Token yaşam döngüsü

- Erişim token'ı kısa ömürlüdür (`JWT_ACCESS_TTL_SECONDS`, varsayılan 15 dk) ve her istekte
  oturum satırı (`auth_sessions`) kontrol edilir: iptal edilmiş oturumun token'ı süresi dolmadan
  da reddedilir (`SESSION_REVOKED`).
- Yenileme token'ı DB'de **yalnız özet (hash)** olarak durur. Her yenilemede **döndürülür**
  (rotation): eski token bir kez kullanılmış sayılır.
- **Yeniden kullanım tespiti:** kullanılmış bir yenileme token'ı tekrar gelirse token kopyalanmış
  sayılır, oturumun tamamı `TOKEN_REUSE` ile iptal edilir ve `auth.refresh_token_reuse` denetim
  kaydı yazılır.
- Çıkış oturumu iptal eder ve cihazın push token'ını bırakır; "Tüm cihazlardan çıkış"
  (`logout-all`) kullanıcının bütün oturumlarını iptal eder.

### Cihaz ve oturum görünürlüğü

- Her oturum cihaz adı, platform, uygulama sürümü, oluşturulma ve son kullanım zamanı tutar.
  IP adresi oturum tablosunda ham değil, `IP_HASH_SECRET` ile **HMAC** olarak durur ("aynı ağ"
  sinyali için yeter, konum çıkarılmaz).
- Kullanıcı "Aktif Oturumlar" ekranında oturumlarını görür ve tek tek kapatabilir. Kesin konum
  gösterilmez.

### OTP

- Kod DB'de HMAC özeti olarak durur (`OTP_HASH_SECRET`), logda yazılmaz (console SMS sağlayıcısı
  yalnız geliştirmede, üretimde yasak). Süre (`OTP_TTL_SECONDS`), deneme sınırı
  (`OTP_MAX_ATTEMPTS`), yeniden gönderme bekleme süresi ve tek kullanım zorunludur.
- Yanıtlar telefonun kayıtlı olup olmadığını sızdırmaz.

### Hız sınırları (Redis, dağıtık)

- Anahtarlar: IP, telefon (özet), e-posta, kullanıcı/usta. OTP istek ve doğrulama, giriş,
  kayıt, yenileme, teklif (usta başına dakika/saat, yapılandırılabilir), ödeme ve para çekme.
- Tek süreç belleğinde sınırlayıcı üretimde yeterli sayılmaz; Redis gider ise sınırlayıcı kapalı
  kalmaz, istek hata alır (para kaybı olmaz: ledger PostgreSQL'dedir).

### Admin güvenliği

- İzinler (`admin_permission_grants`): `ADMIN_SUPPORT`, `ADMIN_VERIFICATION`, `ADMIN_FINANCE`,
  `ADMIN_SUPER`. İade, para çekme ve komisyon politikası `ADMIN_FINANCE`; doğrulama kararları
  `ADMIN_VERIFICATION` ister. İzin değişikliği yalnız `ADMIN_SUPER` yapar, kendi iznini
  değiştiremez, `confirm: true` ister ve denetlenir. Migration mevcut `ADMIN`'lere yalnız
  `ADMIN_SUPPORT` verir.
- Admin oturumu daha sıkıdır: en fazla `ADMIN_SESSION_MAX_HOURS`, boşta
  `ADMIN_IDLE_TIMEOUT_MINUTES` sonra biter.
- **MFA:** Faz 6'da yok ve sahte bir MFA eklenmedi. Oturum modeli ileride TOTP/WebAuthn adımı
  eklemeyi engellemez. Üretim öncesi insan kararıdır.
- Risk sinyalleri (`OTP_ABUSE`, `QUOTE_SPAM`, `CANCEL_ABUSE`, `PAYMENT_ABUSE`, `REVIEW_ABUSE`,
  `DEVICE_ANOMALY`, `ADMIN_FLAG`) yalnız kanıt olarak kaydedilir; **otomatik ceza veya skor yoktur.**

### Taşıma katmanı tehdit modeli (CORS/CSRF)

- Mobil uygulama API'ye `Authorization: Bearer` ile gider; tarayıcı çerezi kullanılmadığı için
  CSRF riski yoktur ve ayrıca CSRF token'ı eklenmedi.
- Admin paneli bir BFF'dir: token'lar httpOnly, `SameSite` çerezlerde Next.js sunucusunda durur;
  API'ye tarayıcı değil sunucu gider. Değişiklik yapan istekler server action (POST) ile gelir.
- CORS: yalnız `API_CORS_ORIGINS`; katı ortamda `*`, `http://` ve localhost reddedilir.
- Güvenlik başlıkları (helmet): CSP (`default-src 'none'`, `frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  katı ortamda HSTS (2 yıl).

## Sonuçlar

- Çalınan bir yenileme token'ı ilk yeniden kullanımda oturumu kapatır.
- Kalan işler: admin MFA, cihaz parmak izi, IP itibarı (Faz 6 dışında).
