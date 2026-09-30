# ADR-0026: Operasyon, gözlemlenebilirlik, mutabakat ve bildirim derin bağlantıları

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-03

## Bağlam

Üretimde bir sorunun kullanıcıdan önce fark edilmesi gerekir: işçi durdu mu, push birikti mi,
defter tutarlı mı? Faz 5 mutabakatı elle çalışan bir CLI idi.

## Karar

- **Sağlık:** `/health/live` (süreç ayakta), `/health` ve `/health/ready` (veritabanı + Redis).
- **Metrikler:** `/metrics`, Prometheus metin biçimi; üretimde `METRICS_TOKEN` bearer ister.
  HTTP istek sayısı/süresi (rota şablonu etiketiyle; şablon dışı istekler `unmatched`), domain
  olayları, işçi kalp atışları. Etiket değerleri `/^[\w:/{}.-]{0,120}$/` ile sınırlanır; kişisel
  veri etiket olamaz.
- **Yapılandırılmış loglar:** katı ortamda JSON; istek kimliği, rota, durum, süre; hassas alanlar
  `redact()` ile maskelenir. Hata raporlayıcı soyutlaması (`ERROR_REPORTER`), gerçek servis yok.
- **Kalp atışı ve izleme:** her arka plan işçisi (push, finans taraması, mutabakat, hesap silme)
  kalp atışı yazar. `ops-monitor` şunlarda uyarı açar: işçi hata veriyor/durdu, push kuyruğu
  birikti (`QUEUE_BACKLOG_ALERT_MINUTES`), push hataları eşiği aştı, payout sonucu belirsiz.
- **Uyarılar:** `OPEN → ACKNOWLEDGED → RESOLVED`, `dedupe_key` ile tekil; koşul geçince otomatik
  çözülebilir. Admin "Uyarılar" sayfasından onaylar/çözer (not zorunlu).
- **Planlı mutabakat:** `RECONCILIATION_INTERVAL_MINUTES` ile çalışır; `RUNNING` satırı kilittir
  (aynı anda tek çalışma). Defter dengesi, ödeme/kazanç/iade/payout ile defter kayıtlarının
  uyumu ve negatif bakiye kontrol edilir. **Otomatik düzeltme yapmaz**; uyumsuzluk CRITICAL
  uyarı ve çalışma kaydına yazılır, insan karar verir.
- **Derin bağlantılar:** bildirim `deepLink`, `entityType`, `entityId` taşır. Uygulama bilinen
  rotaları açar, bilinmeyen veya artık erişilemeyen hedefte güvenli bir yedek ekran gösterir.

## Sonuçlar

- Gerçek APM/uyarı kanalı (PagerDuty, Sentry vb.) seçimi Faz 6 dışındadır; soyutlama hazırdır.
