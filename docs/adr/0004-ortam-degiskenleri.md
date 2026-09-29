# ADR-0004: Ortam değişkenleri ve secret yönetimi

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

Hiçbir secret koda yazılmamalıdır (PROJECT.md §31.14–15).

## Karar

- Lokal geliştirme: kökte tek `.env` (git'e girmez). Şablon: `.env.example`.
- Admin ve mobil kendi küçük `.env.example` dosyalarına sahiptir (`ADMIN_API_URL`, `EXPO_PUBLIC_API_URL`).
- API açılışta `@ustago/config` içindeki Zod şemasıyla ortamı doğrular; hata varsa başlamaz.
  Hata mesajları değişken adını söyler, değeri asla yazdırmaz.
- `EXPO_PUBLIC_*` değişkenleri uygulama paketine gömülür; bu yüzden asla secret içeremez.
- Üretim secret'ları deploy platformunun secret yöneticisinden gelir (Faz 0 kapsamı dışında).

## Sonuçlar

- Yeni bir değişken eklemek = şemaya ve `.env.example`'a eklemek; ikisi aynı PR'da güncellenir.
