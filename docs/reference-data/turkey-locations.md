# Türkiye il / ilçe referans verisi

UstaGO tüm Türkiye için tasarlandı: 81 il ve 973 ilçenin tamamı her ortamda
seed edilir. İller ve ilçeler varsayılan olarak veritabanında bulunur; bir ilin
pazaryerinde **açık** olup olmadığı (`provinces.is_active`) ve il × kategori
ayarları (`province_categories`) admin tarafından yönetilir.

## Kapsam

| Veri | Adet | Dosya |
| --- | --- | --- |
| İl (plaka kodu 1–81) | 81 | `apps/api/src/seed/reference-data.ts` (`PROVINCES`) |
| İlçe | 973 | `apps/api/src/seed/data/turkey-districts.ts` (üretilmiş) |

- İsimler Türkçe karakterleriyle saklanır (`Şereflikoçhisar`, `Eyüpsultan`).
- `slug` ayrı alandır, seed sırasında `slugify()` ile üretilir
  (`sereflikochisar`) ve `(province_id, slug)` üzerinde tekildir.
- 52 il için merkez ilçe kaynakta olduğu gibi **`Merkez`** adıyla yer alır
  (ör. Bartın → Merkez). Büyükşehirlerde merkez ilçeler kendi adlarıyla gelir.
- İsmi harf dışı karakter içeren tek ilçe `19 Mayıs` (Samsun).

## Kaynak

| | Kaynak | Sürüm / tarih |
| --- | --- | --- |
| Birincil | PTT posta kodu listesi (`https://postakodu.ptt.gov.tr/Dosyalar/pk_list.zip`), npm paketi [`turkey-neighbourhoods`](https://www.npmjs.com/package/turkey-neighbourhoods) aracılığıyla (`src/data/districtsByCityCode.json`) | 4.0.3, yayın 2024-03-31 |
| Çapraz kontrol | [`snrylmz/il-ilce-json`](https://github.com/snrylmz/il-ilce-json) (`js/il-ilce.json`, NVI ilçe kodlarıyla) | `master`, erişim 2026-09-29 |

İki kaynak il bazında, isim isim (Türkçe büyük harfe çevrilerek) karşılaştırıldı:
**81 il, 973 ilçe, 0 fark.** Faz 1'de elle girilen İstanbul (39), Ankara (25) ve
İzmir (30) listeleri de birebir aynıdır.

### Bilinen sınırlamalar

- Resmi kurum sitelerine (e-İçişleri, TÜİK, NVI, PTT) bu geliştirme ortamının
  ağ politikası nedeniyle doğrudan erişilemedi; PTT listesi yukarıdaki npm
  paketinden alındı ve ikinci, bağımsız bir kaynakla doğrulandı. Canlıya
  çıkmadan önce bir kişinin e-İçişleri “İl ve İlçe Listesi” ile son bir kez
  karşılaştırması önerilir.
- 2024-03-31 sonrasında kurulan yeni ilçe bilinmiyor; yeni bir ilçe
  kurulursa aşağıdaki güncelleme adımları izlenir.
- Mahalle verisi Faz 2 kapsamında değil (adreslerde serbest metin).

## Güncelleme

1. İki kaynağın güncel JSON dosyalarını indirin.
2. `node apps/api/scripts/import-turkey-districts.mjs <districtsByCityCode.json> <il-ilce.json>`
   — kaynaklar birebir uyuşmazsa betik hiçbir şey yazmaz ve farkları listeler.
   Betik isimleri asla “düzeltmez”, uydurmaz.
3. `pnpm exec prettier --write apps/api/src/seed/data/turkey-districts.ts`
4. `reference-data.spec.ts` içindeki toplam sayıyı güncelleyin, testleri çalıştırın.
5. `pnpm db:seed` — seed idempotenttir (`createMany … skipDuplicates`); var olan
   satırlara ve admin'in `is_active` seçimlerine dokunmaz. Kaldırılan bir ilçe
   silinmez (adresler ona bağlı olabilir); admin tarafından pasif yapılır.
