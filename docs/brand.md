# UstaBulHemen marka görselleri

Resmi marka görselleri proje sahibi tarafından verildi (2026-09-30). Görseller yeniden
tasarlanmaz; yalnızca kırpma, boyutlandırma, dolgu ve PNG optimizasyonu yapılır. En-boy
oranı korunur.

| Dosya                            | İçerik                                       | Kullanım                                                                 |
| -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `ustabulhemen-main-icon.png`     | Turuncu ev, usta karakteri, İngiliz anahtarı | Ana marka, müşteri uygulaması, giriş/kayıt, splash, büyük marka alanları |
| `ustabulhemen-app-icon.png`      | Lacivert zemin, beyaz ev, turuncu çekiç      | Uygulama ikonu, favicon, PWA ikonu, admin kompakt logo, küçük alanlar    |
| `ustabulhemen-location-icon.png` | Yeşil zemin, beyaz konum pini, ev            | Konumunu kullan, yakındaki ustalar, hizmet bölgeleri, konum ekranları    |
| `ustabulhemen-wordmark.png`      | Usta karakteri, "ustabulhemen.com" ve slogan | Yazılı tam logo (henüz ekranda kullanılmıyor)                            |

## Konumlar

- Orijinaller (bayt bayt aynı): `apps/mobile/assets/brand/` ve `apps/admin/public/brand/`.
- Ekranlarda kullanılan küçük kopyalar: `.../brand/ui/`. Kare kırpılmış (yuvarlak köşeli
  karonun içi) ve küçültülmüş; köşeler ekranda `borderRadius` ile yuvarlatılır.
- Mobil uygulama ikonu `apps/mobile/assets/icon.png`, Android adaptive ön plan
  `android-icon-foreground.png` (beyaz zemin, güvenli alan için dolgu), web favicon
  `favicon.png`: hepsi app icon'un kırpılmış hâli.
- Admin: `src/app/favicon.ico`, `icon.png`, `apple-icon.png` ve PWA için
  `public/brand/app-icon-192.png`, `app-icon-512.png` (`src/app/manifest.ts`).

## Kod

- Mobil: `apps/mobile/src/components/Brand.tsx` (`BrandIcon`, `BrandName`, `BrandHero`).
- Admin: `apps/admin/src/components/brand.tsx` (`BrandIcon`).
- Renkler (yazılı logodan örneklendi): lacivert `#051B33`, turuncu `#FA9205`, gri `#5A7080`.

Teknik kimlikler (paket adları `@ustago/*`, bundle id `com.ustago.app`, `ustago://` şeması,
veritabanı) bilerek değiştirilmedi; mağaza/derin bağlantı etkisi olduğu için ayrı karar ister.
