# ADR-0022: Ortam ayrımı (APP_ENV) ve fail-closed yapılandırma

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Faz 5'e kadar test parası, mock ödeme, simülasyon uçları, demo seed ve console SMS aynı
kod tabanında yaşar. Bunlardan biri üretimde açık kalırsa gerçek kullanıcı sahte bir "ödendi"
görebilir veya OTP kodları loglara düşebilir. `NODE_ENV` yalnız derleme türünü söyler; staging
de üretim derlemesiyle çalışır.

## Karar

- `APP_ENV` (`development | test | staging | production`) uygulamanın **nerede** çalıştığını
  söyler. Verilmezse `NODE_ENV`'den türetilir (`production` → `production`). Staging ve
  production'a "katı ortam" (`isStrictEnv`) denir; ikisi de `NODE_ENV=production` ister.
- `packages/config/src/production-safety.ts` katı ortamda şu durumlarda **açılışı reddeder**
  (mesaj değişkenin adını verir, değerini asla):
  - `PAYMENT_PROVIDER=mock`, `PAYOUT_PROVIDER=mock`
  - `ALLOW_DEV_PAYMENT_SIMULATION=true`, `ALLOW_TEST_KYC=true`, `DEMO_SEED=true`
  - `SMS_PROVIDER=console|fake`, `PUSH_PROVIDER=console`, `STORAGE_DRIVER=local`
  - `JWT_ACCESS_SECRET` içinde örnek yer tutucu; `OTP_HASH_SECRET`, `STORAGE_SIGNING_SECRET`,
    `IP_HASH_SECRET` eksik veya yer tutucu
  - `FINANCE_EARNING_HOLD_HOURS`, `FINANCE_MIN_PAYOUT_MINOR` açıkça verilmemiş (ticari karar)
  - `API_CORS_ORIGINS` boş veya `*`; `RECONCILIATION_INTERVAL_MINUTES=0`; `LOG_FORMAT=pretty`
  - Yalnız production: Swagger açık, `METRICS_TOKEN` olmadan metrik,
    `ACCOUNT_DELETION_GRACE_HOURS` verilmemiş (hukuki karar)
- Test kısayolları (`ALLOW_*`, `DEMO_SEED`) verilmezse geliştirme/testte açık, katı ortamda
  kapalıdır. Kod ayrıca çalışma anında da kontrol eder (savunma derinliği): dev ödeme uçları,
  test mark-paid, geliştirme ücret politikası (`is_development`), test banka hesabı ve demo
  seed katı ortamda reddedilir.
- Açılışta sırsız bir özet yazılır: ortam, sağlayıcılar, açık/kapalı özellikler, demo seed.
- Özellik anahtarları (kill switch): etkin = env **VE** admin. Ortam bir özelliği yoksa admin
  açamaz; admin yalnız var olanı kapatıp açabilir (`payments`, `payouts`, `cash`, `new_jobs`).
  5 sn önbellek, değişiklikte temizlenir; her değişiklik gerekçe + onay + denetim kaydı ister.

## Sonuçlar

- Yanlış yapılandırılmış bir üretim süreci hiç açılmaz; yarı açık çalışma yoktur.
- `pnpm --filter @ustago/api config:check` benzeri doğrulama CI'da ve sürüm kontrol listesinde
  ([production-release-checklist](../runbooks/production-release-checklist.md)) çalıştırılır.
