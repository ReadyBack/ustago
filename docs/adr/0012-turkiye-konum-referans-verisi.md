# ADR-0012: Türkiye konum referans verisi

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

UstaGO tek bir şehre kilitli değildir; 81 ilin tamamı ve ilçeleri adres, hizmet bölgesi ve ileride
eşleştirme için gereklidir. Faz 1'de yalnızca İstanbul, Ankara ve İzmir ilçeleri vardı. İlçe
listesi uydurulamaz; güvenilir bir kaynaktan, tekrar üretilebilir şekilde gelmelidir.

## Karar

- 81 il (plaka kodu = birincil anahtar) ve 973 ilçe her ortamda seed edilir.
- İlçe listesi `apps/api/scripts/import-turkey-districts.mjs` ile iki bağımsız kaynaktan üretilir
  (PTT posta kodu listesi ve NVI kodlu ikinci liste); kaynaklar isim isim birebir uyuşmazsa betik
  hiçbir şey yazmaz. Kaynaklar ve sınırlamalar: `docs/reference-data/turkey-locations.md`.
- İsimler Türkçe karakterleriyle saklanır; `slug` ayrı alandır ve il içinde tekildir.
- Seed idempotenttir (`createMany … skipDuplicates`): var olan satırlara, admin'in açma/kapama
  seçimlerine dokunmaz. Kaldırılan ilçe silinmez, pasif yapılır (adres geçmişi korunur).
- Pazaryerinde açıklık iki katmandır: `provinces.is_active` (il açık mı) ve `province_categories`
  (bu ilde bu kategori açık mı, NOW açık mı). Satır yoksa kategori varsayılanı geçerlidir.
- API: `GET /locations/provinces`, `GET /locations/provinces/:id/districts`,
  `GET /locations/provinces/:id/categories` (herkese açık; `includeInactive=true` yalnızca admin),
  `PATCH /locations/provinces/:id` ve `PUT /locations/provinces/:id/categories/:categoryId` (admin).

## Sonuçlar

- Yeni bir il açmak veri yüklemesi değil, bir admin anahtarıdır.
- Mahalle verisi bu fazda yok (adreste serbest metin); gerekirse aynı kaynaktan eklenebilir.
- Resmi portallara bu geliştirme ortamından erişilemediği için canlı öncesi bir kişi tarafından
  e-İçişleri listesiyle son karşılaştırma önerilir.
