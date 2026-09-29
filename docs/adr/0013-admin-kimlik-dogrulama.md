# ADR-0013: Admin paneli kimlik doğrulama stratejisi

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Admin paneli (Next.js 16) kişisel verilere ve belgelere erişir. JWT'yi `localStorage`'da tutmak,
tek bir XSS açığında token'ın çalınmasına yol açar. Panelin kendi kullanıcı veritabanı olmamalı;
kimlik ve roller API'dedir (ADR-0007).

## Karar

**Backend-for-frontend (BFF)**

- Tarayıcı API'ye doğrudan istek atmaz. Next.js sunucusu API'yi `ADMIN_API_URL` üzerinden çağırır.
- Access ve refresh token'ları iki çerezde tutulur: `httpOnly`, `SameSite=Strict`, `Path=/`,
  production'da her zaman `Secure`; ömürleri token'ların ömrüdür. Tarayıcı JavaScript'i token'ı
  okuyamaz (uçtan uca testte `document.cookie` boş, web storage boş doğrulandı).
- Giriş, çıkış ve tüm inceleme kararları **Server Action**'dır: yalnızca POST kabul eder ve Next.js
  `Origin` ile `Host` başlıklarını karşılaştırır. `SameSite=Strict` ile birlikte bu CSRF'e karşı
  iki katmanlı korumadır; ayrıca CSRF token'ı gerekmez.
- Girişte kullanıcı ADMIN/SUPER_ADMIN değilse API'de açılan oturum hemen kapatılır ve çerez
  yazılmaz.
- Her sayfa `requireAdmin()` ile `GET /me` çağırır: yetkiyi çerez değil API belirler (askıya alınan
  veya rolü alınan admin hemen düşer). `proxy.ts` yalnızca çerez hiç yoksa girişe yönlendiren
  iyimser bir kontroldür.
- Access token süresi dolduysa sayfa tarayıcıyı `/auth/refresh?next=...` adresine gönderir; bu Route
  Handler refresh rotation yapar ve güvenli bir göreli yola döner (`safeNextPath` açık
  yönlendirmeyi engeller). Server Action'lar 401'de bir kez yenileyip tekrar dener.
- Belgeler `/verifications/:id/document` Route Handler'ı üzerinden akıtılır: imzalı adres tarayıcıya
  hiç gitmez; yanıt `no-store`, `nosniff`, `sandbox` CSP ile döner. Tüm sayfalar
  `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer` taşır.

## Sonuçlar

- XSS bir admin oturumunda işlem yaptırabilir ama token'ı dışarı taşıyamaz; CSP ile XSS yüzeyi
  daraltılabilir (sıkı script CSP'si sonraki faza bırakıldı).
- Aynı anda iki sekmede token yenilenirse refresh reuse algılaması (ADR-0007) oturumu kapatabilir;
  admin yeniden giriş yapar. Kabul edilen ödün.
- Admin için MFA (TOTP) Faz 2'de yok; canlıya çıkıştan önce eklenmeli.
