# ADR-0024: Admin yetkileri, oturum güvenliği ve risk sinyalleri

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Faz 5'e kadar her `ADMIN` her şeyi yapabiliyordu: para iadesi, usta onayı, yorum gizleme.
Üretimde en az yetki ilkesi ve her kritik işlemin denetim izi gerekir.

## Karar

- **İzinler** (`admin_permission_grants`): `ADMIN_SUPPORT` (anlaşmazlık, yorum, ceza, risk),
  `ADMIN_VERIFICATION` (usta onayı, belge, askıya alma, kategori gereksinimleri),
  `ADMIN_FINANCE` (iade, payout, nakit, komisyon politikası, hesap doğrulama), `ADMIN_SUPER`.
  `SUPER_ADMIN` rolü tüm izinleri kapsar. Kritik uçlar `@RequirePermission(...)` taşır; yetkisiz
  istek 403 alır.
- Migration mevcut `ADMIN` kullanıcılara yalnız `ADMIN_SUPPORT` verir; finans ve doğrulama
  yetkisi açıkça (denetlenerek) verilir. İzin değişikliği `confirm: true` ister, kendi iznini
  değiştirmek yasaktır.
- **Denetim:** `audit_logs` yalnız eklemeye açıktır (tetikleyici). Meta veriler yazılmadan önce
  `redact()` ile temizlenir (parola, token, telefon, e-posta, IBAN, belge anahtarları). Admin
  "Denetim Kayıtları" varlık, aktör, işlem ve tarih aralığına göre filtreler.
- **Oturumlar:** her girişte bir `auth_sessions` satırı (cihaz, platform, uygulama sürümü,
  IP'nin HMAC'i, `IP_HASH_SECRET`). Kullanıcı "Aktif Oturumlar"dan diğer oturumları kapatabilir.
  Ham IP oturum tablosunda saklanmaz. Admin oturumu `ADMIN_SESSION_MAX_HOURS` ve boşta kalma
  süresi ile sınırlıdır.
- **Hız sınırları:** OTP (istek/pencere, bekleme), giriş, teklif (dakika/saat, usta başına),
  ödeme (10/dk), para çekme (5/dk), fotoğraf ve belge yükleme. Aşım 429 ve kodlu hata döner.
- **Risk sinyalleri** (`OTP_ABUSE`, `QUOTE_SPAM`, `CANCEL_ABUSE`, `PAYMENT_ABUSE`,
  `REVIEW_ABUSE`, `DEVICE_ANOMALY`, `ADMIN_FLAG`): yalnız kaydedilir ve insan incelemesine
  sunulur. **Otomatik ceza yoktur.** Tekrarlar tekilleştirilir.

## Sonuçlar

- Bir finans hatası destek hesabıyla yapılamaz; her kritik işlem kimin yaptığıyla izlenir.
- Cihaz parmak izi, gelişmiş dolandırıcılık skoru ve IP itibarı Faz 6 dışındadır.
