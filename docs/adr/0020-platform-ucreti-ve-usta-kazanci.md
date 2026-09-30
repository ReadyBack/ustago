# ADR-0020: Platform ücreti, usta kazancı, nakit, iade ve para çekme

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-02

## Bağlam

UstaGO her işten bir platform ücreti alır; usta kalanını kazanır. Müşteri uygulamadan veya
ustaya doğrudan (nakit) ödeyebilir. İade, anlaşmazlık ve para çekme bu hesapları değiştirir.
Ticari oran henüz karar verilmemiştir; kodda sabit bir "gerçek oran" olmamalıdır.

## Karar

### Platform ücreti politikası

- `platform_fee_policies`: `bps` (1500 = %15), `fixed_fee_minor`, `min_fee_minor`,
  `max_fee_minor`, `effective_from`, `is_development`. Formül: `clamp(sabit + yuvarla(brüt ×
bps / 10000), min, max)`, brütü asla aşmaz. Yuvarlama **HALF_UP**, yalnız tamsayı (`BigInt`);
  float yoktur.
- Geliştirme/demo için seed `DEV-DEFAULT-1500` (%15, `is_development = true`) yazar. **Bu nihai
  ticari fiyat değildir.** Üretimde seed politika yazmaz; politika olmadan online ödeme
  `FEE_POLICY_MISSING` (503) ile kapalı kalır.
- İş oluşturulurken geçerli politika işe **anlık görüntü** olarak yazılır (`platform_fee_policy_id`,
  `platform_fee_bps`); sonradan değişen oran eski işi etkilemez.
- Ücret iş toplamı üzerinden **kümülatif** alınır: `ücret(önceki + yeni) − ücret(önceki)`. Böylece
  parçalı ödemelerin ücretleri toplamı her zaman tek seferde ödenmiş gibi olur ve minimum ücret
  bir kez alınır (özellik testi).

### Usta kazancı

- Başarılı her online ödeme bir `provider_earnings` satırı açar (brüt, ücret, net, bps).
  Başlangıç `PENDING`; iş `COMPLETED` olunca `holdUntil = tamamlanma + FINANCE_EARNING_HOLD_HOURS`.
  Geliştirmede bekleme 0 saattir (anında serbest); üretimde değer zorunludur, varsayılan yoktur.
- Serbest bırakma (`EARNING_RELEASED`) açık platform borcunu önce mahsup eder
  (`FINANCE_DEBT_OFFSET_ENABLED`). Arka plan taraması (`FINANCE_SWEEP_SECONDS`) vadesi gelenleri
  serbest bırakır.
- Açık anlaşmazlık kazancı `HELD` yapar. Admin anlaşmazlığı sonuçlarken para tutuluyorsa
  finansal karar zorunludur (`DISPUTE_FINANCIAL_ACTION_REQUIRED`): `FULL_CUSTOMER_REFUND`,
  `PARTIAL_CUSTOMER_REFUND` (tutarla), `RELEASE_PROVIDER_FUNDS`; iade edilmeyen kısım ustaya
  serbest bırakılır.
- Çekilebilir = `max(0, kullanılabilir − platform borcu)`.

### Nakit ("Ustaya doğrudan öde")

- UstaGO parayı görmez; ödeme satırı ve clearing kaydı yoktur. `cash_settlements` iki taraflı
  onay ister: müşteri "Ödemeyi yaptım", usta "Ödemeyi aldım" (sıra fark etmez). Tek düğme
  işi kapatmaz. Durumlar: `AWAITING_CONFIRMATION → CUSTOMER_CONFIRMED | PROVIDER_CONFIRMED →
CONFIRMED`; her iki taraf onaydan önce `DISPUTED` diyebilir.
- `CONFIRMED` olunca `FINANCE_CASH_COMMISSION_ENABLED` açıksa platform ücreti ustanın
  **platform borcu** olur (`CASH_FEE_ASSESSED`). Borç sonraki online kazançtan mahsup edilir.
- Nakit anlaşmazlığında admin yalnızca sonucu kaydeder (`CONFIRM_PAID` ücret yazar,
  `MARK_UNPAID` yazmaz); "nakit iade" yoktur.

### İade

- Sunucu tarafında, ödeme satırı kilitliyken: iade edilebilir = ödenen − (başarısız olmayan
  iadeler). Fazlası `REFUND_EXCEEDS_REFUNDABLE`; veritabanı tetikleyicisi `refunds_total_guard`
  ikinci savunma hattıdır. Eşzamanlı iki iade toplamı aşamaz.
- İade, ödemenin ücret/usta oranında bölünür, kümülatif: parçalı iadeler toplamda ücreti tam
  olarak geri verir. Usta payı kazanç durumuna göre `PENDING`'den, serbest bırakılmışsa
  `AVAILABLE`'dan, o da yetmezse **platform borcuna** yazılır (bankadan geri çekme yoktur).
- İki adım: (1) transaction içinde `REFUND_REQUESTED` + defter; (2) commit sonrası sağlayıcı →
  `REFUND_COMPLETED` veya ret halinde `REVERSAL` ile geri alma. Takılan istekler taramada
  yeniden denenir; sağlayıcıya iade kimliği idempotency anahtarı olarak gider.
- Admin iade ekranı: tutar, neden kodu, zorunlu iç not, iki aşamalı onay ve
  `expectedRefundableMinor` (ekranda görülen tutar değiştiyse `REFUND_STALE`).
- İptal: iş yalnızca usta yola çıkmadan iptal edilebilir (ADR-0015); o anda yakalanmış ödeme
  **otomatik tam iade** edilir, bekleyen ödeme geri çekilir. Başladıktan sonra para konuları
  "Sorun bildir" (anlaşmazlık) yoluyla çözülür.
- Fazla ödeme oluşamaz (tek aktif ödeme + sunucu tutarı); yine de geç gelen bir başarı toplamı
  aşarsa fark otomatik iade edilir.

### Para çekme (payout)

- `payout_destinations`: yalnızca `TEST_BANK_ACCOUNT`; IBAN mod-97 ile doğrulanır, sonra atılır;
  saklanan `TR** **** **** **** **** **12 34` ve son 4 hanedir. Tam IBAN hiçbir API yanıtında yok.
- Talep: usta hesapları kilitli, `çekilebilir ≥ tutar ≥ FINANCE_MIN_PAYOUT_MINOR` (geliştirmede
  ₺100) → `PAYOUT_RESERVED`. Durumlar `REQUESTED → APPROVED → PROCESSING → PAID | FAILED`,
  `REQUESTED | APPROVED → CANCELLED`. `FAILED`/`CANCELLED` ayrılan tutarı geri verir.
- Bu fazda "ödendi" yalnızca geliştirmede admin'in **TEST: Ödendi işaretle** düğmesiyle olur;
  gerçek banka transferi yoktur ve üretimde bu uç yoktur (404).

### Vergi

KDV, stopaj, e-fatura/e-arşiv hesaplanmaz ve üretilmez. Müşteriye gösterilen belge "Ödeme
Özeti"dir, fatura değildir. Vergi/faturalandırma hukuki-mali doğrulama gerektirir.

## Sonuçlar

- Oran bir veri kararıdır, kod değişikliği gerektirmez; eski işler anlık görüntüyü korur.
- Nakit işlerde ücret tahsilatı ustanın sonraki online kazancına bağlıdır; hiç online işi
  olmayan ustanın borcu açık kalır (admin görür). Borç tahsil politikası ticari karardır.
- Bahşiş, kupon, çoklu para birimi bu fazda yoktur.
