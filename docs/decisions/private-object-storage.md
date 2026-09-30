# Özel nesne depolama seçimi

**STATUS: DECISION REQUIRED** · Sahip: altyapı + güvenlik + hukuk

Belgeler ve talep fotoğrafları bugün yerel diskte (`STORAGE_DRIVER=local`) durur; bu üretimde
reddedilir. Yerel sürücü bile üretim davranışını taklit eder: rastgele anahtar, kısa ömürlü imzalı
URL, erişim denetimi, kalıcı açık URL yok. Tedarikçi seçilmedi.

## Gereksinimler

| Gereksinim    | Beklenti                                                                 |
| ------------- | ------------------------------------------------------------------------ |
| Private       | Varsayılan özel kova; açık URL yok                                       |
| Encryption    | Sunucu tarafı şifreleme (anahtar yönetimi kararı ayrı)                   |
| Signed access | Kısa ömürlü imzalı indirme/yükleme URL'leri                              |
| Retention     | Veri türüne göre süre ([data-retention](../security/data-retention.md))  |
| Delete        | Hukuki süre dolunca doğrulanabilir silme                                 |
| Audit         | Erişim logu; uygulama tarafında `verification.document_accessed`         |
| Backup        | Sürümleme / silme koruması                                               |
| Region        | Yurt içi zorunluluğu: **Legal review required** (KVKK yurt dışı aktarım) |

Ayrıca zararlı yazılım taraması gerekir (bugün `MALWARE_SCANNER=none`, belgeler `NOT_SCANNED`).
