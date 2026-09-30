# ADR-0029: Konum, mesafe ve konum gizliliği

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-04

## Bağlam

Faz 7 "yakındaki usta" ve "Yaklaşık 12 km" gösterir. Ama müşterinin ev adresi, anlaşmadan önce
ustaya; ustanın ev adresi hiçbir zaman müşteriye gösterilmemelidir. Harita servisi (Google, Mapbox)
bağlı değil ve bu fazda bağlanmayacak; yol mesafesi hesaplanamaz.

## Karar

### Referans koordinatlar

- 81 il ve 973 ilçe için yaklaşık merkez (ilçe merkezi yerleşimi) GeoNames verisinden
  (`cities.json`, CC BY 4.0) üretilir: 913 ilçe merkezi, 42 alan ortalaması, 18 il merkezi yedeği.
  Kaynak ve sınırlar: [turkey-locations](../reference-data/turkey-locations.md). Seed bu değerleri
  yalnız boş satırlara yazar (idempotent).

### Mesafe

- `DistanceCalculator` arayüzü, tek uygulaması Haversine (`apps/api/src/geo/distance.ts`). Mesafe
  **kuş uçuşu** ve **ilçe merkezleri arasıdır**; arayüzde her zaman "Yaklaşık N km" yazılır, asla
  "yol mesafesi" denmez. 10 km altı 0,5'e, üstü tam sayıya yuvarlanır, en az 1 km.
- Talebin noktası: adresin koordinatı varsa 2 ondalığa (≈1 km) kabalaştırılmış hâli, yoksa ilçe
  merkezi. Ustanın noktası: hizmet merkezi ilçesinin merkezi. Hizmet merkezi yoksa mesafe `null`
  (uydurulmaz).
- `MapProvider` bir soyutlama olarak tanımlıdır; bugün harita yoktur, mobil uygulama liste ve
  "Yaklaşık N km" gösterir.

### Gizlilik

- Usta, anlaşmadan önce talepte yalnız il/ilçe, kategori, açıklama, bütçe, fotoğraf ve yaklaşık
  mesafeyi görür: müşteri adı, telefon, e-posta, sokak, bina, daire, posta kodu, koordinat ve
  yol tarifi yoktur (izin listesiyle kurulan `toOpportunity`; e2e anahtar listesi testi).
- Müşteri ustanın profilinde telefon, e-posta, TC, belge, IBAN ya da adres görmez; hizmet
  merkezi yalnız "Seyhan merkezli 20 km" gibi bir etiket ve kabalaştırılmış nokta olarak çıkar.
- Hizmet merkezi bir **ilçedir**, ev adresi değildir.

### Lansman durumu

İl başına `ACTIVE` (açık), `WAITLIST` (talep kabul edilir, dağıtım il açılınca), `DISABLED`
(kapalı). Admin il ayarından değiştirir; denetime yazılır.

### Coğrafi indeks

Bugünkü ölçekte (yüzlerce–birkaç bin usta) SQL'de Haversine ve il/ilçe filtreleri yeterli
(docs/faz7/BENCHMARK.md). Usta sayısı on binlere çıkınca PostGIS (`geography` + GiST) ya da
geohash sütunu eklenir; `DistanceCalculator` ve depo katmanı bu değişikliği saklar. Bu fazda
PostGIS eklenmedi, çünkü yerel ve CI kurulumunu gereksiz yere ağırlaştırır.

## Sonuçlar

- Mesafe gerçek veriden ama yaklaşıktır; kullanıcıya böyle söylenir.
- Harita, rota ve gerçek yol mesafesi gelecekte bir `MapProvider` uygulaması ister (ücretli
  servis, anahtar yönetimi, KVKK değerlendirmesi).
