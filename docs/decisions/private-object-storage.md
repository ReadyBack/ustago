# Özel nesne depolama seçimi

- **Durum:** DECISION REQUIRED
- **Sahip:** Altyapı + güvenlik + hukuk

Doğrulama belgeleri ve talep fotoğrafları şu an yerel diskte (`STORAGE_DRIVER=local`) tutulur;
bu üretimde reddedilir. Erişim kısa ömürlü imzalı URL iledir ve denetlenir.

## Gereksinimler

- Varsayılan özel kova, sunucu tarafı şifreleme, sürümleme.
- İmzalı yükleme/indirme URL'leri, içerik türü ve boyut sınırı.
- Kötü amaçlı yazılım taraması (şu an yok: `MALWARE_SCANNER=none`).
- Verinin yurt içinde tutulması gerekip gerekmediği: **Legal review required** (KVKK yurt dışı aktarım).
