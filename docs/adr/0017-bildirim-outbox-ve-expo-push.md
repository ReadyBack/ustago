# ADR-0017: Bildirimler, outbox ve Expo push

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-30

## Bağlam

İş adımları (usta yola çıktı, geldi, ek iş onayı, tamamlandı) müşteriye zamanında ulaşmalı.
Uygulama içi bildirim her zaman kaynak olmalı; push yalnızca "dürtme"dir ve kaybolabilir. Push
gönderimi API isteğini yavaşlatmamalı, dış servis hatası iş adımını geri almamalı, bir bildirim
iki kez gitmemeli. Geliştirme ortamında gerçek push kimlik bilgisi yoktur ve olmamalıdır; sistem
"gönderildi" demediği sürece gönderilmiş sayılmamalıdır.

## Karar

### Uygulama içi bildirim (kaynak)

- Her olay (`job.en_route`, `job.arrived`, `job.started`, `change_order.created|accepted|rejected|
cancelled`, `job.completion_requested`, `job.completed`, `job.disputed`, `job.cancelled`,
  `dispute.resolved`, `review.received`, teklif olayları) Türkçe başlık/metin ve `data`
  (`jobId`, `quoteId`, `serviceRequestId`) ile `Notification` satırı olarak yazılır.
- Yazım, olayı üreten **aynı transaction** içinde yapılır (`notifications.enqueueIn(tx)`): iş adımı
  geri alınırsa bildirim de oluşmaz; iş adımı kalıcıysa bildirim de kalıcıdır.
- Mobil: `GET /me/notifications` (imleçli sayfalama), `GET /me/notifications/unread-count` (zil
  rozeti), `POST /me/notifications/read` (seçili veya tümü). Bildirime dokunmak ilgili işe, teklife
  veya talebe götürür.

### Outbox ve push işçisi

- Push isteyen her bildirim için aynı transaction'da bir `PushDelivery` satırı (`PENDING`)
  oluşur (transactional outbox). API isteği Expo'yu hiç beklemez.
- `PushWorkerService` (`PUSH_WORKER_INTERVAL_SECONDS`, varsayılan 5 sn) satırları
  `FOR UPDATE SKIP LOCKED` ile en fazla 50'lik gruplar halinde ve 120 sn kira ile alır; birden
  fazla API süreci aynı satırı iki kez göndermez.
- Hata: üstel geri çekilme 30 sn'den başlar, 1 saatte sınırlanır; `PUSH_MAX_ATTEMPTS`
  (varsayılan 5) sonra `FAILED`. Kayıtlı cihaz yoksa veya kullanıcı tercihi kapalıysa `SKIPPED`.
- Expo "ticket" sonuçları cihaz bazında saklanır; `PUSH_RECEIPT_DELAY_SECONDS` (varsayılan
  900 sn) sonra "receipt"ler okunur. `DeviceNotRegistered` gelen token pasifleştirilir.
- Tercihler: `GET/PATCH /me/notification-preferences`. İş güncellemeleri kapatılamaz (kapıya
  biri geliyor); teklif güncellemeleri ve pazarlama kapatılabilir.

### PushProvider soyutlaması

| `PUSH_PROVIDER` | Davranış                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `console`       | `[DEV PUSH]` log satırı, satır `DEV_LOGGED` olur. **Hiçbir şey sunucudan çıkmaz.** Prod'da yasak. |
| `expo`          | Expo Push API (`exp.host`), isteğe bağlı `EXPO_ACCESS_TOKEN`. Ticket/receipt işlenir.             |
| `disabled`      | Push satırları `SKIPPED`; uygulama içi bildirim çalışır.                                          |

- `DEV_LOGGED` hiçbir raporda `SENT` sayılmaz. Push durumu dürüst raporlanır: IN_APP (satır
  yazıldı) / OUTBOX (teslimat kuyruğu) / CONSOLE (yalnızca log) / EXPO PUSH (Expo'ya gerçekten
  gönderildi ve ticket alındı).
- Loglarda push token maskelenir (`ExponentPushToken[abcd…]`).

### Mobil kayıt

- İzin **açılışta istenmez**. Giriş sonrası ana sayfada, nedenini anlatan bir kart ("Usta yola
  çıktığında… hemen haberiniz olsun") ve "Bildirimleri aç" düğmesi gösterilir. İzin zaten
  verilmişse sessizce kaydolur.
- Token `getExpoPushTokenAsync({ projectId })` ile alınır; `projectId` EAS yapılandırmasından
  gelir. Tanımlı değilse token alınmaz ve geliştirici notu bunu açıkça söyler (sahte token yok).
- Token `POST /me/devices` ile kaydedilir. Android'de `default` kanalı açılır. Web'de push yoktur.
- Uygulama kapalıyken dokunulan bildirim de dahil, push'a dokunmak ilgili ekranı açar.

## Sonuçlar

- İş adımı ile bildirimi arasında tutarsızlık olmaz; Expo kesintisi iş akışını etkilemez.
- Gerçek cihaza push için EAS `projectId` ve fiziksel cihaz gerekir; bu fazda yerel ortamda
  push `console` sağlayıcısıyla yalnızca loglanır ve öyle raporlanır.
- İleride FCM/APNs doğrudan eklenirse yalnızca yeni bir `PushProvider` yazılır.
