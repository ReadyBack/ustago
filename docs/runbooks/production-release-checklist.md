# Üretim sürüm kontrol listesi

> **Durum:** Taslak. UstaGO henüz üretime alınmadı. Bu liste gerçek bir deploy için **gerekli
> ama yeterli olmayan** adımları toplar; gerçek ödeme/KYC/SMS sağlayıcısı ve hukuki onay olmadan
> üretim açılmaz ([ADR-0021](../adr/0021-uretim-hazirligi-seviyeleri.md)).

## 1. Kararlar (sürümden önce, bir kez)

- [ ] Ödeme sağlayıcısı seçildi ve sözleşme imzalandı ([karar](../decisions/payment-provider-selection.md)).
- [ ] KYC yöntemi seçildi ([karar](../decisions/kyc-provider-selection.md)).
- [ ] Özel nesne depolama seçildi ([karar](../decisions/private-object-storage.md)).
- [ ] Ticari oran onaylandı ve bir komisyon politikası `SCHEDULED` olarak yayınlandı.
- [ ] `FINANCE_EARNING_HOLD_HOURS`, `FINANCE_MIN_PAYOUT_MINOR` iş tarafından onaylandı.
- [ ] `ACCOUNT_DELETION_GRACE_HOURS` ve saklama süreleri hukuken onaylandı (**Legal review required**).
- [ ] KVKK aydınlatma metni, açık rıza ve kullanıcı sözleşmesi hazır (**Legal review required**).

## 2. Yapılandırma

- [ ] `APP_ENV=production`, `NODE_ENV=production`.
- [ ] `pnpm --filter @ustago/api config:check` üretim ortam değişkenleriyle **"Config OK"** veriyor.
- [ ] Sırlar bir sır yöneticisinden geliyor; hiçbiri repoda veya CI logunda değil.
- [ ] `PAYMENT_PROVIDER`, `PAYOUT_PROVIDER` mock değil; `DEMO_SEED`, `ALLOW_TEST_KYC`,
      `ALLOW_DEV_PAYMENT_SIMULATION` tanımsız veya `false`.
- [ ] `API_CORS_ORIGINS` yalnız https üretim alan adları.
- [ ] `METRICS_TOKEN` tanımlı; `/metrics` yalnız iç ağdan erişilebilir.
- [ ] Açılış logundaki özet beklenen sağlayıcıları gösteriyor ("Demo data: disabled",
      "Dev routes: disabled").

## 3. Veritabanı

- [ ] Yedek alındı ve geri yükleme denendi ([felaket kurtarma](disaster-recovery.md)).
- [ ] `prisma migrate deploy` staging'de aynı veri hacmiyle denendi; migration'lar yalnız ekleme.
- [ ] **Test temizleme bayrakları:** `ustago.ledger_test_purge` ve `ustago.audit_test_purge`
      yalnız test fikstürleri içindir. Üretim uygulama rolünün `ledger_*`, `audit_logs`,
      `provider_verification_events` tablolarında `DELETE` yetkisi **kaldırılır**
      (`REVOKE DELETE ... FROM <app_role>`), böylece bayrak ayarlansa bile silme yapılamaz.
      Migration rolü ile uygulama rolü ayrıdır.
- [ ] Seed üretimde çalıştırılmaz (yalnız referans veri; demo seed katı ortamda zaten kapalı).
- [ ] `platform_fee_policies` içinde `is_development = true` politika aktif değil.

## 4. Uygulama

- [ ] CI yeşil: lint, typecheck, birim, e2e, prettier, migration diff, bağımlılık denetimi.
- [ ] Admin hesapları en az yetkiyle (ADMIN_SUPPORT / ADMIN_VERIFICATION / ADMIN_FINANCE).
- [ ] Kill switch'ler (`payments`, `payouts`, `cash`, `new_jobs`) admin panelinden çalışıyor.
- [ ] Planlı mutabakat açık ve ilk çalışması temiz.
- [ ] Uyarı kanalı (e-posta/pager) bağlı. **Faz 6'da yok; engel.**

## 5. Sürüm sonrası

- [ ] `/health/ready` 200, `/metrics` akıyor, hata oranı normal.
- [ ] İlk gerçek ödeme küçük tutarla ve iç hesapla denendi, mutabakat temiz.
- [ ] Geri dönüş planı: önceki imaj + `payments`/`payouts` kill switch kapatma.
