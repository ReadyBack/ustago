# Üretim sürüm kontrol listesi

> **Durum:** Taslak. UstaGO üretime alınmadı. Bu liste **gerekli ama yeterli olmayan** adımları
> toplar. Kod hukuki karar vermez; hukuki maddeler "Legal review required" olarak işaretlidir.
> Hazırlık seviyeleri: [ADR-0021](../adr/0021-uretim-hazirligi-seviyeleri.md).

## Infrastructure

- [ ] Barındırma sağlayıcısı ve bölge seçildi (DECISION REQUIRED).
- [ ] API, admin ve worker'lar ayrı süreçler olarak ölçeklenebiliyor; `APP_ENV=production`, `NODE_ENV=production`.
- [ ] `pnpm config:check` üretim ortamıyla **"Config OK"** veriyor; açılış özetinde "Demo data: disabled", "Dev routes: disabled".

## Secrets

- [ ] `JWT_ACCESS_SECRET`, `OTP_HASH_SECRET`, `STORAGE_SIGNING_SECRET`, `IP_HASH_SECRET`, `METRICS_TOKEN` sır yöneticisinde; repoda/CI logunda değil.
- [ ] `pnpm security:secrets` temiz. Sır döndürme (rotation) prosedürü yazıldı.

## Database

- [ ] Migration rolü ile uygulama rolü ayrı. `prisma migrate deploy` staging'de denendi; `pnpm db:migration-guard` temiz.
- [ ] Uygulama rolünün `ledger_*`, `audit_logs`, `provider_verification_events` tablolarında `DELETE` yetkisi kaldırıldı (`ustago.*_test_purge` bayrakları yalnız test içindir).
- [ ] Seed üretimde çalışmaz (demo seed katı ortamda zaten kapalı). `is_development` politika aktif değil.

## Redis

- [ ] Kalıcılık/HA kararı verildi. Redis giderse para kaybı olmaz (ledger PostgreSQL'de), hız sınırları ve kuyruk hata verir.

## Object storage

- [ ] Özel kova, şifreleme, imzalı erişim ([karar](../decisions/private-object-storage.md)). `STORAGE_DRIVER=local` üretimde yasak.
- [ ] Zararlı yazılım tarayıcısı bağlandı (bugün yok: belgeler `NOT_SCANNED`).

## SMS

- [ ] SMS sağlayıcısı sözleşmesi ve gönderici başlığı; OTP metni onaylı. `console`/`fake` yasak.

## Push

- [ ] Expo erişim token'ı; fiziksel cihazda iOS/Android push testi (Faz 6'da yapılmadı).

## Payment provider

- [ ] Sağlayıcı seçildi ve adaptör yazıldı ([karar](../decisions/payment-provider-selection.md)); `PAYMENT_PROVIDER=mock` yasak.
- [ ] Webhook imzası, idempotency ve sandbox testleri geçti.

## Payout provider

- [ ] Payout adaptörü; banka hesabı doğrulama akışı gerçek referansla (`externalDestinationRef`).
- [ ] Sonucu belirsiz payout runbook'u denendi ([runbook](payout-needs-reconciliation.md)).

## KYC

- [ ] Doğrulama yöntemi seçildi ([karar](../decisions/kyc-provider-selection.md)). Bugün elle inceleme.

## Legal/privacy (Legal review required)

- [ ] KVKK/privacy review, aydınlatma metni, açık rıza — **Legal review required**
- [ ] Terms of Service — **Legal review required**
- [ ] Provider agreement (usta sözleşmesi) — **Legal review required**
- [ ] Payment provider agreement — **Legal review required**
- [ ] Commission policy (ticari oran) — **Legal review required**
- [ ] Refund/cancellation policy — **Legal review required**
- [ ] Invoice/e-document (e-fatura/e-arşiv) — **Legal review required**
- [ ] Tax/accounting — **Legal review required**
- [ ] Document retention ([data-retention](../security/data-retention.md)) — **Legal review required**
- [ ] Identity verification requirements (meslek bazlı belgeler) — **Legal review required**

## Finance

- [ ] Komisyon politikası `SCHEDULED` olarak yayınlandı; `FINANCE_EARNING_HOLD_HOURS`, `FINANCE_MIN_PAYOUT_MINOR` iş onaylı.
- [ ] Planlı mutabakat açık (`RECONCILIATION_INTERVAL_MINUTES`) ve ilk çalışma temiz. Mutabakat otomatik düzeltme yapmaz.
- [ ] Kill switch'ler (`payments`, `payouts`, `cash`, `new_jobs`) denendi.

## Monitoring

- [ ] `/metrics` toplanıyor (token ile), JSON loglar merkezi sisteme gidiyor, uyarı kanalı (pager/e-posta) bağlı — **Faz 6'da yok, engel**.
- [ ] Hata raporlayıcı gerçek servise bağlı (`ERROR_REPORTER` bugün `console`).

## Backup

- [ ] Otomatik yedek + zaman noktasına geri dönüş; geri yükleme tatbikatı ([felaket kurtarma](disaster-recovery.md)). RPO/RTO iş kararıdır.

## DNS/TLS

- [ ] Alan adları, TLS sertifikaları, HSTS (API katı ortamda gönderir). Faz 6'da DNS yok.

## Mobile builds

- [ ] EAS üretim profili, `EXPO_PUBLIC_API_URL` üretim adresi, mağaza hesapları, gizlilik etiketleri. Faz 6'da mağaza işlemi yok.

## Rollback

- [ ] Önceki imaj hazır; migration'lar yalnız eklemeli olduğu için kod geri alınabilir.
- [ ] Acil durumda önce `payments` / `payouts` kill switch'leri kapatılır, sonra geri alınır.
