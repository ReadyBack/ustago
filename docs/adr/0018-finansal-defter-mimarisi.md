# ADR-0018: Finansal defter (ledger) mimarisi

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-02

## Bağlam

Faz 5 ile UstaGO para akışını kaydetmeye başlar: uygulama içi ödeme, ustaya doğrudan (nakit)
ödeme, platform ücreti, usta kazancı, iade ve para çekme. Bu fazda **gerçek para hareketi
yoktur** (yalnızca test sağlayıcısı), ama kayıt modeli üretimdeki gibi olmalıdır: bakiyeler
sonradan açıklanabilmeli, iki istek aynı parayı iki kez harcayamamalı, hiçbir kayıt sessizce
değişmemelidir. ADR-0006 (tamsayı kuruş, `BigInt`) geçerliliğini korur.

## Karar

### Çift taraflı, yalnızca eklenen defter

- `ledger_transactions` (başlık) + `ledger_entries` (satırlar). Her işlem en az iki satırdır,
  tutarlar **pozitif tamsayı kuruştur**, yön (`DEBIT`/`CREDIT`) işareti taşır; toplam borç =
  toplam alacak.
- Veritabanı zorlar: ertelenmiş kısıt tetikleyicisi `ledger_entries_balanced` commit anında her
  işlemin ≥ 2 satır, tek para birimi ve borç = alacak olduğunu kontrol eder; `ledger_*_append_only`
  tetikleyicileri UPDATE ve DELETE'i reddeder. Düzeltme yalnızca yeni bir `REVERSAL` (ters kayıt,
  `reverses_id` tekil) veya `ADJUSTMENT` işlemiyle yapılır.
- Test temizliği için DELETE, yalnızca transaction içinde `SET LOCAL ustago.ledger_test_purge =
'on'` verildiğinde mümkündür; uygulama kodu bunu hiç yapmaz. Üretimde uygulama rolünün bu
  ayarı kullanamaması (veya tetikleyicinin sade "her zaman reddet" hâli) canlıya çıkış kontrol
  listesindedir.
- **Değiştirilebilir bakiye alanı yoktur.** Usta bakiyeleri (bekleyen, kullanılabilir, ayrılmış,
  platform borcu) her seferinde defter satırlarından hesaplanır (`LedgerService.providerBalances`).

### Hesaplar (uygulamanın kendi hesapları, resmî hesap planı değildir)

| Hesap                    | Sahibi   | Normal yön | Anlamı                                          |
| ------------------------ | -------- | ---------- | ----------------------------------------------- |
| `PLATFORM_CLEARING`      | Platform | Borç       | Ödeme kuruluşunda tutulan para                  |
| `PLATFORM_FEE_REVENUE`   | Platform | Alacak     | Platform ücreti                                 |
| `REFUND_LIABILITY`       | Platform | Alacak     | Kabul edilmiş, sağlayıcı onayı bekleyen iadeler |
| `PROVIDER_PENDING`       | Usta     | Alacak     | Ustaya borç, henüz serbest değil                |
| `PROVIDER_AVAILABLE`     | Usta     | Alacak     | Çekilebilir                                     |
| `PROVIDER_RESERVED`      | Usta     | Alacak     | Para çekme talebi için ayrılmış                 |
| `PROVIDER_PLATFORM_DEBT` | Usta     | Borç       | Ustanın platforma borcu (nakit ücreti, iade)    |

Hesaplar `(owner_key, type, currency)` ile tekildir; `owner_key` platform için `platform`, usta
için usta kimliğidir (NULL çakışmasını önler).

### İşlem türleri ve kaynak anahtarları

Her işlem tekil bir `source_key` taşır; aynı iş olayı iki kez deftere yazılamaz (tekrar deneme,
yarış, çift webhook):

| Olay                         | `source_key`            | Satırlar                                             |
| ---------------------------- | ----------------------- | ---------------------------------------------------- |
| Ödeme alındı                 | `payment:<id>:captured` | B Clearing = ücret (A Fee) + net (A Pending)         |
| Kazanç serbest               | `earning:<id>:released` | B Pending → A Debt (mahsup) + A Available            |
| Nakit iş ücreti              | `cash:<id>:fee`         | B Debt, A Fee                                        |
| İade talebi                  | `refund:<id>:requested` | B Fee + B Pending/Available/Debt, A Refund liability |
| İade tamamlandı              | `refund:<id>:completed` | B Refund liability, A Clearing                       |
| İade reddedildi              | `refund:<id>:reversed`  | talebin tam tersi (`REVERSAL`)                       |
| Para çekme talebi            | `payout:<id>:reserved`  | B Available, A Reserved                              |
| Para çekme ödendi (TEST)     | `payout:<id>:paid`      | B Reserved, A Clearing                               |
| Para çekme başarısız / iptal | `payout:<id>:released`  | B Reserved, A Available                              |

(B = borç, A = alacak.) Kurallar ve satır üreticileri `apps/api/src/finance/domain/ledger.ts`
içindedir; saf fonksiyonlardır ve rastgele dizilerle özellik testinden geçer.

### Eşzamanlılık

- Kilit sırası her yerde aynıdır: **iş → ödeme → iade → kazanç → usta defter hesapları** (kimliğe
  göre sıralı `SELECT … FOR UPDATE`). Bu sıra kilitlenmeyi (deadlock) önler.
- Durum geçişleri koşullu güncellemedir (`WHERE status = … AND version = …`); tekil kısıtlar
  son savunma hattıdır: iş başına tek aktif ödeme (kısmi tekil indeks), tekil `idempotency_key`
  (ödeme, deneme, iade, para çekme), tekil `(provider, event_id)` webhook, tekil `source_key`.
- Aynı ustanın iki eşzamanlı ₺2.000 talebi ₺2.295 bakiyeden yalnızca birini geçirir: ikisi de
  usta hesaplarını kilitler, ikincisi güncel bakiyeyi görür ve `INSUFFICIENT_AVAILABLE_BALANCE`
  alır (e2e testi).

### Mutabakat

`ReconciliationService` (admin **Mutabakat** sayfası ve `pnpm finance:reconcile`) tek bir
`REPEATABLE READ, READ ONLY` transaction'da kontrol eder: dengesiz işlem, negatif usta
bakiyesi, başarılı ödeme ↔ tahsilat kaydı (tutar, ücret), ödeme durumu ↔ iadeler, kazanç ↔
serbest bırakma kaydı, iade ↔ talep/kapanış/ters kayıt, para çekme ↔ ayırma/ödeme/serbest
bırakma, onaylı nakit ↔ ücret kaydı. **Hiçbir şeyi otomatik düzeltmez**; bulguyu bir insan
değerlendirir.

## Denetim kaydı ile defterin farkı

`audit_logs` "kim, ne zaman, neyi yaptı" sorusunu yanıtlar (`payment.created`, `refund.created`,
`payout.requested`, …; IP ile). Defter "para kime ait, neden değişti" sorusunu yanıtlar. İkisi
birbirinin yerine geçmez: denetim kaydı silinse de bakiye değişmez; bakiye hiçbir zaman denetim
kaydından hesaplanmaz.

## Sonuçlar

- Bakiyeler her zaman açıklanabilir; her kuruş bir işleme bağlıdır.
- Okuma maliyeti (toplama sorguları) Faz 5 ölçeğinde önemsizdir. Büyümede hesap başına
  günlük özet (snapshot) tablosu eklenebilir; defter yine tek doğruluk kaynağı kalır.
- Vergi, e-fatura ve resmî muhasebe bu defterin kapsamı dışındadır (hukuki-mali doğrulama
  gerektirir).
