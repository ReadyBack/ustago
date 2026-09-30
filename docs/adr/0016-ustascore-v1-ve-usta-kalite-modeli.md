# ADR-0016: Değerlendirmeler, UstaScore V1 ve usta kalite modeli

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-30

## Bağlam

Müşteri güveni gerçek verilere dayanmalı: sahte puan, uydurma yorum, "4.9 yıldız" gibi dolgu yok.
Tek bir 5 yıldız, yeni bir ustayı yüzlerce iyi iş yapmış bir ustanın önüne geçirmemeli. Müşteri
iptali ustaya, açık (henüz karara bağlanmamış) bir şikâyet ise hükme dönüşmemeli. Yaptırımlar
otomatik değil, gerekçeli admin kararı olmalı. Sıralama ile "işi görebilir mi" kararı ayrı
tutulmalı.

## Karar

### Değerlendirme

- Yalnızca **tamamlanan işin müşterisi**, iş başına **bir kez** değerlendirir
  (`POST /jobs/:id/review`; tekil indeks + `409 REVIEW_ALREADY_EXISTS`). İşin tarafı olmayan
  `403`, tamamlanmamış iş `409 REVIEW_NOT_ALLOWED` alır.
- Genel puan 1–5 zorunlu; işçilik, iletişim, dakiklik, fiyat/performans alt puanları isteğe
  bağlı. Yorum en fazla 1000 karakter düz metin (HTML/kontrol karakteri reddedilir).
- Yazan kişi 30 gün içinde düzenleyebilir (`PATCH /reviews/:id`); sonrası
  `409 REVIEW_NOT_EDITABLE`. Her yazma denetim kaydına (`review.created`, `review.updated` önceki
  değerlerle) yazılır. Yazma kullanıcı başına saatte 20 ile sınırlı.
- Admin gizler/geri alır (`review.hidden`, `review.restored`); gizlenen yorum profilden ve
  ortalamadan çıkar, silinmez.
- Herkese açık profil (`GET /providers/:id`, `GET /providers/:id/reviews`) yalnızca yayındaki
  yorumları, **maskeli** adla ("Zeynep D.") gösterir; telefon, e-posta, adres, iş kimliği yoktur.
  Hiç yorum yoksa arayüz **"Yeni Usta"** yazar.

### İki ayrı sayı

1. **Kullanıcı Puanı:** yayındaki yorumların düz ortalaması ("⭐ 4.7 · 3 değerlendirme").
2. **UstaScore (0–100):** sıralamada kullanılan güven puanı.

### UstaScore V1 formülü

`skor = Σ(wᵢ · sᵢ) / Σ(wᵢ, verisi olan etkenler) − yaptırım puanı` (0–100 aralığına kırpılır)

| Etken        | Ağırlık | Puan (0–100)                                                    | Veri yoksa           |
| ------------ | ------- | --------------------------------------------------------------- | -------------------- |
| Yorumlar     | %40     | Bayes ortalaması: (5 × 4.0 + Σpuan) / (5 + n), 1–5 → 0–100      | yorum yok → dışarıda |
| Tamamlama    | %20     | tamamlanan / (tamamlanan + usta iptali + aleyhe karar)          | < 3 iş → dışarıda    |
| Usta iptali  | %10     | 1 − usta iptali / (müşteri/sistem iptali hariç işler)           | < 3 iş → dışarıda    |
| Sorun kararı | %10     | 1 − (aleyhe + 0.5 × kısmi) / (tamamlanan + karara bağlanan)     | < 3 iş → dışarıda    |
| Yanıt hızı   | %10     | karşı teklife medyan yanıt süresi (≤15 dk 100 … >24 sa 0)       | < 3 yanıt → dışarıda |
| Doğrulama    | %5      | kimlik 70 + mesleki belge 30 (admin onaylı)                     | her zaman var        |
| Deneyim      | %5      | platformda tamamlanan iş (≤50) %70 + beyan edilen yıl (≤20) %30 | her zaman var        |

- **Eksik etken uydurulmaz:** verisi olmayan etken hesaptan çıkar, kalan ağırlıklar yeniden
  normalize edilir (`effectiveWeight`). Admin ekranı her etkenin ağırlığını, etkin ağırlığını,
  puanını ve nasıl hesaplandığını gösterir.
- **Bayes küçültmesi:** her usta "5 adet 4.0 yorumla" başlar; tek 5 yıldız yeni ustayı tepeye
  taşımaz.
- **Doğru tarafa yazma:** müşteri ve sistem iptalleri ustaya yazılmaz; açık sorun bildirimi
  hüküm değildir, yalnızca admin kararı sayılır (usta lehine karar ve `CLOSED` 0 sayılır).
- **Yeni Usta:** 3'ten az tamamlanan işi olan usta `isNewProvider`; profilde UstaScore gösterilmez.
- **Anlık görüntü:** her hesap `ProviderScore` satırına (`algorithmVersion = v1`, etkenler,
  yaptırım puanı, örneklem) yazılır; yorum, karar, yaptırım ve iş bitişi aynı transaction'da
  yeniden hesaplatır, arka plan süpürücü de periyodik hesaplar. Sürüm değişirse eski
  görüntüler karşılaştırma için kalır.

### Sıralama ve uygunluk ayrıdır

- **Uygunluk** (işi görebilir mi): ACTIVE usta, kategori, ilçe, NOW için müsaitlik ve yürürlükteki
  yaptırımlar (`JOB_RESTRICTION` tüm yeni işleri, `NOW_SUSPENSION` acil işleri gizler).
- **Sıralama** (hangi sırayla): UstaScore azalan; yeni ustalar nötr 60 ile sıralanır ki ne
  gömülsün ne de tek yorumla öne geçsin; eşitlikte onay tarihi.

### Yaptırımlar

- Yalnızca admin, gerekçe ve kodla verir (`POST /admin/providers/:id/penalties`), kaldırır
  (`POST /admin/penalties/:id/revoke`). Tek yorum, tek şikâyet veya açık bir sorun bildirimi
  otomatik yaptırım üretmez.
- Ağırlık: Uyarı −2, Sıralamada geri düşürme −10, NOW uzaklaştırma / iş kısıtlaması −20 (toplam
  en fazla −40). Hesabı askıya alma ve kalıcı kapatma puan etkisi değil, ayrı hesap kararıdır
  (usta inceleme akışı). İtirazdaki yaptırım karar çıkana kadar yürürlükte kalır.

## Sonuçlar

- Puanlar açıklanabilir ve itiraz edilebilir: her etkenin kaynağı admin ekranında yazılı.
- Veri azken skor çoğunlukla doğrulama ve deneyimden oluşur; bu bilinçli olarak "Yeni Usta"
  etiketiyle gösterilir, sahte puanla doldurulmaz.
- Ağırlıklar ve eşikler `quality/domain/usta-score.ts` içinde sabit; değişiklik yeni
  `algorithmVersion` ve yeni ADR gerektirir.
