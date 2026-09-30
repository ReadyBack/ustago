# ADR-0015: İş yaşam döngüsü, ek iş (change order), tamamlama ve sorun bildirimi

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-30

## Bağlam

Faz 3 anlaşmayı ve fiyat kilidini kurdu: kabul edilen teklif bir `Job` oluşturur,
`agreedPriceMinor` değişmez. Faz 4'te iş, anlaşmadan müşteri onayına kadar gerçek adımlarla
ilerlemeli, sahada çıkan ek iş fiyat kilidini bozmadan eklenebilmeli ve müşteri iş bittiğinde
onaylayabilmeli ya da sorun bildirebilmelidir. Aynı işe iki cihazdan, iki taraftan ya da çift
dokunmayla aynı anda istek gelebilir; her durumda tek tutarlı sonuç çıkmalıdır. Ödeme bu fazda
yoktur ve arayüzde ödeme metni gösterilmez.

## Karar

### Durum makinesi

Faz 1 enum adları korunur (`CREATED`, `CONFIRMED`, `PROVIDER_PREPARING`, `PROVIDER_EN_ROUTE`,
`PROVIDER_ARRIVED`, `IN_PROGRESS`, `AWAITING_COMPLETION_CONFIRMATION`, `COMPLETED`, `DISPUTED`,
`CANCELLED`). Geçiş kuralları tek yerdedir: `apps/api/src/jobs/domain/job-state-machine.ts`.

| Eylem (endpoint)                    | Kaynak durum                     | Hedef                            | Kim     |
| ----------------------------------- | -------------------------------- | -------------------------------- | ------- |
| `POST /jobs/:id/en-route`           | CREATED, CONFIRMED, PREPARING    | PROVIDER_EN_ROUTE                | Usta    |
| `POST /jobs/:id/arrive`             | PROVIDER_EN_ROUTE                | PROVIDER_ARRIVED                 | Usta    |
| `POST /jobs/:id/start`              | PROVIDER_ARRIVED                 | IN_PROGRESS                      | Usta    |
| `POST /jobs/:id/request-completion` | IN_PROGRESS                      | AWAITING_COMPLETION_CONFIRMATION | Usta    |
| `POST /jobs/:id/complete`           | AWAITING_COMPLETION_CONFIRMATION | COMPLETED                        | Müşteri |
| `POST /jobs/:id/dispute`            | tüm aktif durumlar               | DISPUTED                         | Müşteri |
| `POST /jobs/:id/cancel`             | CREATED, CONFIRMED, PREPARING    | CANCELLED                        | İkisi   |

- İşi yalnızca işin **kendi ustası** ilerletir; müşteri yalnızca onaylar, sorun bildirir veya
  (usta yola çıkmadan) iptal eder. Yanlış taraf `403 JOB_WRONG_PARTY`, işin tarafı olmayan
  `404 JOB_NOT_FOUND` alır (iş varlığı sızdırılmaz).
- Geçersiz geçiş `409 JOB_INVALID_TRANSITION` döner. Aynı eylemin tekrarı (çift dokunma, ağ
  tekrarı) hedef durum zaten sağlanmışsa **200 ve mevcut iş** döner; hiçbir şey ikinci kez yazılmaz,
  bildirim ikinci kez gitmez (idempotent).
- Her geçiş tek transaction'dır: iş satırı `SELECT … FOR UPDATE` ile kilitlenir, güncelleme
  kaynak duruma koşullu yapılır (`updateMany where status = from`). Her adımın zaman damgası
  (`enRouteAt`, `arrivedAt`, `startedAt`, `completionRequestedAt`, `completedAt`, `disputedAt`,
  `cancelledAt`) yalnızca bir kez yazılır ve değişmez; zaman çizelgesi bu gerçek zamanlardan
  üretilir. Her geçiş `JobStatusHistory`'ye (kim, ne zaman, nereden nereye) ve denetim kaydına
  (`job.en_route`, `job.arrived`, `job.started`, `job.completion_requested`, `job.completed`,
  `job.disputed`, `job.cancelled`) yazılır.
- Otomatik tamamlama **yoktur**: iş yalnızca müşteri "İŞ TAMAMLANDI" dediğinde tamamlanır.
- NOW işleri aynı makineyi izler.
- Cevap gövdesi `actions` alanında izleyicinin o an yapabileceği eylemleri taşır; mobil ekran
  her rol ve durum için **tek birincil eylem** gösterir (YOLA ÇIKTIM → ADRESE ULAŞTIM → İŞE
  BAŞLADIM → İŞİ TAMAMLADIM; müşteride İŞ TAMAMLANDI / SORUN BİLDİR).

### Ek iş (change order)

- Usta, iş `IN_PROGRESS` iken `POST /jobs/:id/change-orders { amountMinor, description }` ile ek iş
  onayı ister. Tutar pozitif tamsayı kuruştur; toplam `MAX_PRICE_MINOR` sınırını aşarsa
  `422 CHANGE_ORDER_INVALID_AMOUNT`. Aynı anda en fazla bir bekleyen ek iş vardır (kısmi tekil
  indeks + `409 CHANGE_ORDER_ALREADY_PENDING`).
- Müşteri `POST /change-orders/:id/accept|reject`, usta `…/cancel` (geri çekme) yapar.
- **`agreedPriceMinor` asla değişmez.** Onaylanan ek iş yalnızca `currentTotalMinor`'u artırır:
  2.200 TL + 500 TL onay → 2.700 TL; ardından 300 TL red → 2.700 TL kalır.
- Kabul/red kilit sırası hep **iş → ek iş**'tir (kilitlenme olmaz); ek iş durumu ve iş toplamı
  koşullu güncellenir. Eşzamanlı kabul + red + geri çekmeden tam olarak biri kazanır, diğerleri
  `409 CHANGE_ORDER_NOT_PENDING` alır. Ek iş açıkken toplam değiştiyse `409 CHANGE_ORDER_STALE`.
- Denetim: `job.change_order.created`, `.accepted`, `.rejected`, `.cancelled`. Türkçe bildirim
  karşı tarafa gider. Onay penceresi "Yeni toplam ₺2.700 olacak." der.
- Bekleyen ek iş varken tamamlama isteği `409 JOB_HAS_PENDING_CHANGE_ORDER` döner; ekran
  "Önce bekleyen ek iş talebinin sonuçlanması gerekiyor." der. İptal veya sorun bildirimi bekleyen
  ek işi `CANCELLED` yapar.

### Sorun bildirimi (dispute)

- Müşteri "SORUN BİLDİR" ile neden (`DisputeReason`) ve en az 10 karakter açıklama gönderir; iş
  `DISPUTED` olur, bir `Dispute` satırı açılır, ustaya bildirim gider.
- Usta adrese ulaşmadan yalnızca "Usta gelmedi" (`NO_SHOW`) seçilebilir; diğer nedenler
  `422 DISPUTE_REASON_NOT_ALLOWED`.
- Admin sonucu (`RESOLVED_FOR_CUSTOMER`, `RESOLVED_FOR_PROVIDER`, `RESOLVED_PARTIAL`, `CLOSED`) ve
  notla karar verir; iki tarafa bildirim gider, denetim `dispute.resolved`. İş `DISPUTED`
  durumunda kalır (bu fazda iade/ödeme olmadığı için ayrı bir kapanış durumu gerekmedi). Aynı
  anda iki karar verilirse biri `409 DISPUTE_ALREADY_RESOLVED` alır.

### İptal

- Usta yola çıkmadan iki taraf da gerekçeyle iptal edebilir. İptal eden taraf
  `cancellationActor` alanına yazılır; UstaScore yalnızca **usta** iptallerini ustaya yazar
  (ADR-0016). İptal bağlı talebi de kapatır.

## Sonuçlar

- Tüm geçişler tek dosyada test edilir (birim) ve gerçek Postgres üzerinde yarış testleriyle
  doğrulanır (`job-lifecycle`, `job-concurrency`, `job-constraints` e2e).
- Yeni bir durum eklemek (ör. ödeme) yalnızca kural tablosunu ve eylem listesini genişletir.
- Ödeme, iade, otomatik tamamlama ve usta tarafından sorun bildirimi bilinçli olarak kapsam
  dışıdır; ilgili fazda ayrı ADR ile eklenir.
