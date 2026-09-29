# ADR-0005: Tek hesap, çoklu rol: kullanıcı, müşteri ve usta modeli

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

UstaGO'da aynı kişi hem hizmet alabilir hem hizmet verebilir (ör. bir elektrikçi evine
çilingir çağırır). Operasyon ekibi de sisteme aynı kimlik altyapısıyla girer. İki seçenek vardı:

1. Müşteri ve usta için ayrı hesaplar (ayrı e-posta/telefon, ayrı giriş).
2. Tek `User` hesabı, üzerine birden fazla rol ve role özel profil.

## Karar

- **Tek hesap:** kimlik (e-posta, telefon, şifre hash'i, durum) yalnızca `users` tablosundadır.
- **Roller `user_roles` tablosundadır** (`CUSTOMER`, `PROVIDER`, `ADMIN`, `SUPER_ADMIN`);
  bir kullanıcı birden çok role sahip olabilir. Rolü kimin verdiği (`granted_by_id`) saklanır.
- **Her hesap `CUSTOMER` rolüyle doğar** ve bir `customer_profiles` kaydı alır.
- **Usta olmak** `provider_profiles` kaydı açmak + `PROVIDER` rolü eklemektir. Kayıtta
  `accountType: PROVIDER` ile ya da sonradan `POST /api/v1/providers/me` ile yapılır. Profil `DRAFT`
  başlar; onay (Faz 2) sonrası `ACTIVE` olur.
- **İş kayıtları profillere bağlanır**, kullanıcıya değil: `service_requests.customer_id` →
  `customer_profiles`, `quotes.provider_id` / `jobs.provider_id` → `provider_profiles`. Böylece
  "bu kişi bu işte hangi rolde" sorusu şemadan okunur.
- **Yönetici rolleri** herkese açık kayıtla alınamaz. Yalnızca `SUPER_ADMIN`
  `PUT /api/v1/users/:id/roles/:role` ile `ADMIN`/`SUPER_ADMIN` verir. `SUPER_ADMIN`, `ADMIN`
  yetkilerini de kapsar.
- **Roller her istekte veritabanından okunur**, access token'a yazılmaz (ADR-0007). Rol verme/alma
  anında etkili olur.
- Güven ve disiplin kayıtları (`trust_events`, `disciplinary_actions`) `subject_role` alanıyla
  kişinin **usta mı müşteri mi** olarak değerlendirildiğini ayırır; aynı sistem kötü davranan
  müşterilere de uygulanır.

## Sonuçlar

- Rol değiştirmek için ikinci hesap gerekmez; mobil uygulama "Usta moduna geç" gibi bir akışla
  aynı oturumu kullanır.
- Yetki kontrolü tek yerde (`RolesGuard`) yapılır; iş kuralları (ör. kendi işine teklif
  verememe) ilgili serviste profil kimlikleri üzerinden kontrol edilir.
- Hesap askıya alma (`users.status`) tüm rolleri birlikte etkiler. Sadece usta tarafını kısıtlamak
  için `disciplinary_actions` (ör. `NOW_SUSPENSION`, `JOB_RESTRICTION`) kullanılır.
