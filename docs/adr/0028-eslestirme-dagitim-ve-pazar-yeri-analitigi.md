# ADR-0028: Eşleştirme (MATCH_V1), dalga dağıtımı ve pazar yeri analitiği

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-04

## Bağlam

Faz 2–6'da yayınlanan bir talep, uygun olan tüm ustalara aynı anda "yeni iş" olarak görünüyordu.
Türkiye geneline açılınca bu hem gürültü (her usta her işi görür) hem haksızlık (ilk bakan kazanır)
üretir. Faz 7'de talep önce en uygun birkaç ustaya gider, teklif gelmezse halka genişler. Sıralama
açıklanabilir olmalı: admin "bu usta neden 1. sırada" sorusunu bir tabloyla cevaplayabilmeli.
Yapay zekâ, tahmini popülerlik ya da uydurma sinyal kullanılmaz.

## Karar

### Uygunluk (eligibility)

Tek bir SQL koşulu (`apps/api/src/matching/matching.repository.ts`) ustanın talebi hiç görüp
göremeyeceğine karar verir. Hepsi aynı anda sağlanmalıdır:

- Usta başvurusu `ACTIVE`, hesabı `ACTIVE` ya da `LIMITED`, kullanıcı aktif; aktif bir
  `JOB_RESTRICTION` cezası yok (NOW için `NOW_SUSPENSION` da). **Askıdaki usta hiçbir aşamada
  eşleşmeye girmez.**
- Kategori ustanın hizmetlerinde; kategori, il, ilçe ve il × kategori ayarı açık; kategori belge
  kuralları sağlanmış.
- **Kapsama:** ilçe listesinde (DISTRICT) ya da bir bölge kuralı (PROVINCE: tüm il, RADIUS:
  merkez ilçe + km) talebi kapsıyor.
- **Azami mesafe:** usta `maxTravelKm` verdiyse hizmet merkezinden talebe olan yaklaşık mesafe bu
  sınırı aşamaz.
- **Müsaitlik** (ADR-0031): "Yeni iş alma" kapalı değil, izinde değil, "bugün müsait değilim"
  değil; NOW için ayrıca çalışma saati içinde.
- **Tercih ve engel:** `preferredOnly` talebi yalnız seçilen ustaya gider; iki taraftan biri
  diğerini engellediyse eşleşme yok.

Uygun olmama nedenleri (`TOO_FAR`, `PROVIDER_UNAVAILABLE`, `PREFERRED_ONLY`, `BLOCKED`, …) saf
fonksiyonda (`matching/domain/eligibility.ts`) da vardır ve admin önizlemesinde gösterilir.

### Puan: MATCH_V1

`matching/domain/match-score.ts`, deterministik ve yalnız veriden:

| Bileşen                     | Puan                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------- |
| Alan uyumu                  | ilçe listesinde 10, bölge kuralıyla 6                                                 |
| Mesafe                      | 0–20, 50 km ufukta doğrusal; bilinmiyorsa 8 (nötr)                                    |
| Şu an çalışıyor             | çalışma saatinde 10, dışında 4                                                        |
| Kalite                      | UstaScore sıralama puanından 0–30; yeni usta nötr 60 kabul edilir                     |
| Yanıt                       | 0–10; en az `RESPONSE_STATS_MIN_SAMPLE` dağıtım yoksa nötr 5                          |
| Etkinlik                    | son 7 günde aktif 5, 30 günde 2                                                       |
| Doğrulanmış hesap           | +5 (**kalite puanı değildir**; kimlik/hesap doğrulaması ile kalite ayrı tutulur)      |
| Yeni usta (soğuk başlangıç) | ilk `MATCH_COLD_START_DAYS` gün +5                                                    |
| Cezalar                     | iptaller en çok −10, LIMITED −10, görünürlük azaltma −15, uyarı başına −3 (en çok −6) |

Eşitlikte puan, sonra mesafe, sonra usta id'si. Her dağıtım satırı (`request_dispatches`) algoritma
sürümünü (`MATCH_V1`), toplam puanı ve bileşen dökümünü saklar; sıralama sonradan
değişse bile o anki karar okunabilir.

Sponsorlu sıralama yoktur; keşif ve eşleştirme organiktir.

### Dalga dağıtımı

- `DISPATCH_WAVE_SIZES` (10,20,50) ve `DISPATCH_WAVE_RADII_KM` (15,40,0; 0 = yalnız ustanın kendi
  kapsaması sınırlar). İlçe listesinde olan usta her zaman "yakın" sayılır; mesafesi bilinmeyen usta
  yalnız sınırsız dalgaya girer.
- Dalgalar arası `DISPATCH_WAVE_INTERVAL_MINUTES` (NOW'da en çok 5 dakika). Talep
  `DISPATCH_TARGET_QUOTES` teklife ulaşınca, kabul edilince, iptal ya da süre dolunca durur.
- Tarama (`DispatchService.sweep`) her `DISPATCH_SWEEP_SECONDS` saniyede bir çalışır ve talep
  satırını `FOR UPDATE SKIP LOCKED` ile kilitler: iki API örneği aynı dalgayı iki kez göndermez.
  `(service_request_id, provider_id)` tekil anahtarı aynı ustaya ikinci bildirimi engeller.
- Bildirim: ustanın "yeni iş uyarısı" tercihi AÇIK → push, SESSİZ → yalnız uygulama içi, KAPALI →
  bildirim yok (iş yine gelen kutusundadır). NOW her zaman push'tur.
- Müşteri "Aramayı genişlet" ile bir sonraki dalgayı erkene alabilir (2 dakika bekleme,
  `SEARCH_RECENTLY_EXPANDED`). Teklif gelmezse `NO_OFFER_ALERT_MINUTES` sonra bir kez uyarılır.
- Bekleme listesindeki il (ADR-0029) teklif talebini kabul eder ama il açılana kadar kimseye
  dağıtmaz; il açılınca tarama devam eder.

### Analitik

`marketplace_events` tablosu (talep oluşturuldu, dağıtıldı, görüldü, teklif, kabul, iş başladı/
bitti, arama, sonuçsuz arama, favori, tekrar çağır) en iyi çaba ile, iş işleminin içinde yazılır.
Arama metni kaydedilmeden önce temizlenir (telefon/e-posta gibi kalıplar atılır). Admin panosu
huni, bölge, kategori ve "teklif gelmeyen talepler" görünümlerini bu tablodan ve çekirdek
tablolardan üretir. Küçük örneklemde (5'ten az talep) oranlar gösterilmez.

## Sonuçlar

- Sıralama açıklanabilir ve test edilebilir (birim testleri + e2e). Bir sonraki sürüm `MATCH_V2`
  olarak eklenir, eski satırlar `MATCH_V1` olarak kalır.
- Aday sorgusu `provider_profiles` üzerinde tarar; 1000 ustada ~6 ms (docs/faz7/BENCHMARK.md).
  On binlerce ustada coğrafi indeks gerekir (ADR-0029, "Coğrafi indeks").
- Gerçek zamanlı değil: tarama periyodiktir, mobil yoklama yapar.
