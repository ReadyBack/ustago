# ADR-0030: Talebe bağlı sohbet

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-04

## Bağlam

Müşteri ile usta teklif aşamasında soru sormak ister. Serbest bir mesajlaşma dolandırıcılık,
platform dışına çekme ve "sohbetten fiyat değiştirme" riskleri taşır. Gerçek zamanlı altyapı
(WebSocket) bu fazda yoktur.

## Karar

- Sohbet **bir talebe ve bir ustaya** bağlıdır (`conversations` tekil `(service_request_id,
provider_id)`), teklif ya da iş üzerinden açılır. Katılımcılar yalnız o müşteri ve o ustadır;
  başka herkes 404 alır (IDOR testleri).
- Mesaj türleri: metin, görsel (tek kullanımlık yükleme, sihirli bayt kontrolü, imzalı URL) ve
  sistem satırı (teklif kabul, iş başladı/bitti, ek iş). Sistem satırı `eventKey` ile bir kez yazılır.
- **Sohbet resmi fiyatı değiştirmez.** Fiyat yalnız Teklif (karşı teklif, revizyon) ve İş (ek iş /
  change order) alanlarından değişir; sohbet ekranı bunu kullanıcıya söyler.
- İletişim bilgisi (telefon, e-posta, IBAN kalıbı) **işaretlenir, sansürlenmez**
  (`containsContactInfo`); mesaj olduğu gibi gider, admin raporlarında görünür.
- `clientMessageId` ile idempotent gönderim; kullanıcı başına sohbet başına dakikada
  `CHAT_RATE_LIMIT_PER_MINUTE`, saatte `CHAT_RATE_LIMIT_PER_HOUR` sınırı.
- Engelleme: iki taraftan biri engelleyince yeni mesaj gönderilemez ve eşleştirme artık bu
  ikiliyi eşleştirmez (ADR-0028).
- **Admin erişimi yalnız bir şikâyet üzerinden**: `ADMIN_SUPPORT` izni, gerekçe zorunlu, her erişim
  denetime yazılır. Admin sohbetleri gezip okuyamaz.
- Yenileme **yoklama (polling)** iledir: açık sohbet 5 saniyede, liste 30 saniyede bir. "Yazıyor…"
  ve "çevrimiçi" yoktur; sahte gerçek zamanlılık gösterilmez.
- Okundu bilgisi katılımcı başına son okunan mesaj zamanıdır.
- Görseller özel depolamadadır; yalnız katılımcıya (ve şikâyet üzerinden admin'e) kısa ömürlü imzalı
  URL ile verilir.
- **Saklama süresi: Policy TBD / legal validation required** (ADR-0027). Bugün mesajlar silinmez;
  kullanıcı bir sohbeti yalnız kendi listesinden gizleyebilir. Otomatik silme işi yoktur.

## Sonuçlar

- Anlık teslim yoktur; push bildirimi (ADR-0017) yeni mesajı haber verir.
- WebSocket/SSE ileride aynı mesaj tablosunun üstüne eklenebilir.
- Otomatik içerik moderasyonu (makine öğrenmesi) yoktur.
