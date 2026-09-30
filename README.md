# UstaGO

Mobil öncelikli yerel hizmet pazaryeri ve usta işletme platformu.
Ürün ve teknik tanım: [PROJECT.md](PROJECT.md). Mimari kararlar: [docs/adr](docs/adr/README.md).

> **Durum:** Faz 3 tamamlandı: yerelde çalışan demo. Telefon + OTP girişi, adres, kategori, bütçeli
> ya da "bütçem belli değil" talep, usta modu, eşleşen işler, bütçeden bağımsız teklif, karşılıklı
> pazarlık, kabul, kilitlenen fiyat ve oluşan iş; UstaGO NOW (ACİL USTA) MVP; admin panelinde canlı
> sayılar ve talep listesi. Ödeme, push bildirim, mesajlaşma ve iş adımları sonraki fazlarda.

## Yapı

```text
apps/
  api/      NestJS 12 API (Prisma 7 + PostgreSQL, Redis)   → http://localhost:3000/api/v1
  admin/    Next.js 16 admin paneli                         → http://localhost:3001
  mobile/   Expo SDK 57 (React Native) uygulaması
packages/
  config/         Ortam değişkeni şemaları (Zod)
  types/          Paylaşılan TypeScript tipleri
  validation/     Paylaşılan Zod şemaları
  ui/             Tasarım tokenları
  eslint-config/  Ortak ESLint ayarları
  tsconfig/       Ortak TypeScript ayarları (strict)
infrastructure/   Docker ve yardımcı betikler
docs/             ADR, mimari, ürün ve API dokümanları
```

## USTAGO LOCAL DEVELOPMENT

Tek seferlik kurulum, ardından tek komutla çalıştırma. Komutlar Windows PowerShell, macOS ve Linux'ta
aynıdır.

### Gereksinimler

- **Node.js 22** (`.nvmrc`). Windows'ta [nodejs.org](https://nodejs.org) LTS yükleyicisi yeterli.
- **pnpm 10**: `corepack enable` (Windows'ta PowerShell'i bir kez "Yönetici olarak çalıştır" ile açın).
- **Docker Desktop** (PostgreSQL 17 ve Redis 7 için). Kurulumdan sonra bir kez açın; sağ alttaki
  balina simgesi "running" olmalı.
- **Git**.
- Telefonda deneme için: Play Store / App Store'dan **Expo Go** (SDK 57).

### Windows 11: sıfırdan ilk çalıştırma

PowerShell'de (Docker Desktop açıkken):

```powershell
git clone https://github.com/ReadyBack/ustago.git
cd ustago
corepack enable
pnpm install
pnpm dev:setup
pnpm dev
```

- `pnpm dev:setup` şunları yapar: `.env` yoksa `.env.example`'dan oluşturur ve içindeki yerel
  secret'ları rastgele üretir (`local-dev-...`; production değeri değildir, `.env` git'e girmez),
  paylaşılan paketleri derler, Prisma istemcisini üretir, Docker'da PostgreSQL + Redis'i başlatır,
  migration'ları uygular ve demo verisini yükler. Tekrar çalıştırmak güvenlidir; mevcut `.env`'deki
  dolu değerlere dokunmaz.
- `pnpm dev` API, Admin ve Expo'yu birlikte başlatır, adresleri ve bilgisayarın yerel ağ IP'sini
  yazar. Ayrı pencerelerde çalıştırmak isterseniz: `pnpm dev:api`, `pnpm dev:admin`,
  `pnpm dev:mobile` (Expo'nun QR kodu ve kısayolları en rahat bu komutla, kendi penceresinde görünür).
- Durdurmak: `Ctrl+C`. Docker servisleri çalışmaya devam eder; kapatmak için `pnpm db:down`.

macOS / Linux'ta adımlar aynıdır (Docker Desktop veya Docker Engine + Compose v2).

## USTAGO LOCAL URLS

| Ne                 | Adres                                                     |
| ------------------ | --------------------------------------------------------- |
| API                | http://localhost:3000/api/v1                              |
| API sağlık         | http://localhost:3000/api/v1/health                       |
| Swagger            | http://localhost:3000/api/docs                            |
| Admin paneli       | http://localhost:3001                                     |
| Geliştirici durumu | http://localhost:3001/dev/status (yalnızca geliştirmede)  |
| Mobil (web)        | http://localhost:8081 (Expo çalışırken `w` veya doğrudan) |
| PostgreSQL / Redis | localhost:5432 / localhost:6379 (Docker)                  |

## LOCAL DEMO ACCOUNTS

Hepsi `pnpm dev:setup` / `pnpm dev:seed` ile oluşur, yalnızca geliştirmede (`NODE_ENV` production
değilken). Telefonlar **+90 500** ile başlar: bu blok hiçbir operatöre tahsis edilmemiştir, gerçek
bir kişiye ait değildir. E-postalar `.test` alan adındadır. Demo kayıtlarda "(DEMO)" / "DEMO DATA"
etiketi vardır.

| Hesap                       | Mobil giriş (telefon) | Rol ve durum                                                                               |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `musteri@ustago.test`       | 500 000 00 01         | Müşteri "Ayşe Demo", Seyhan / Adana'da kayıtlı "Ev (DEMO)" adresi                          |
| `usta-klima@ustago.test`    | 500 000 00 02         | Onaylı usta "Demo Klima Ustası": Klima + Beyaz Eşya, Seyhan + Çukurova, NOW açık ve müsait |
| `usta-elektrik@ustago.test` | 500 000 00 03         | Onaylı elektrikçi, NOW açık ama müsait değil                                               |
| `usta-tesisat@ustago.test`  | 500 000 00 04         | Onaylı tesisatçı, yalnızca teklif (NOW kapalı), Çukurova                                   |
| `usta-bekleyen@ustago.test` | 500 000 00 05         | İnceleme bekleyen başvuru (admin panelinde onay/red denemesi için)                         |
| `demo-musteri-zeynep@…`     | 500 000 00 11         | Geçmiş müşteri (Faz 4): Demo Klima Ustası'na 5 yıldız vermiş tamamlanmış iş                |
| `demo-musteri-ali@…`        | 500 000 00 12         | Geçmiş müşteri (Faz 4): 4 yıldız, "yarım saat geç geldi" yorumu                            |
| `demo-musteri-elif@…`       | 500 000 00 13         | Geçmiş müşteri (Faz 4): 5 yıldız, montaj işi                                               |
| `admin@ustago.test`         | (e-posta + şifre)     | SUPER_ADMIN, admin paneli                                                                  |
| `usta@ustago.test`          | (e-posta + şifre)     | İstanbul'da onaylı usta (Faz 2 demo hesabı)                                                |
| `destek@ustago.test`        | (e-posta + şifre)     | Faz 6: ADMIN + yalnız `ADMIN_SUPPORT` (anlaşmazlık, yorum, ceza, risk)                     |
| `finans@ustago.test`        | (e-posta + şifre)     | Faz 6: ADMIN + yalnız `ADMIN_FINANCE` (iade, para çekme, komisyon politikası)              |
| `dogrulama@ustago.test`     | (e-posta + şifre)     | Faz 6: ADMIN + yalnız `ADMIN_VERIFICATION` (usta doğrulama, askıya alma)                   |
| `usta-revizyon@ustago.test` | (e-posta + şifre)     | Faz 6: doğrulaması "Düzeltme gerekli" (reddedilen kimlik belgesi, gerekçeli)               |
| `usta-askida@ustago.test`   | (e-posta + şifre)     | Faz 6: hesabı askıda usta (teklif veremez, para çekemez)                                   |

- **OTP kodu**: gerçek SMS gönderilmez (`SMS_PROVIDER=console`). "Kod Gönder"e bastıktan sonra API
  çıktısında şu satırı arayın: `[DEV SMS → +90500*****01] OTP KODU: 123456`. Kod 3 dakika geçerli.
  Bu satır yalnızca console sağlayıcısında yazılır; API yanıtı kodu hiçbir ortamda döndürmez.
- **Admin / e-posta şifresi**: `.env` içindeki `SEED_DEV_PASSWORD`. `pnpm dev:setup` bunu rastgele
  üretir; görmek için `.env` dosyasını açın. Değiştirirseniz `pnpm dev:seed` demo hesapların şifresini
  yeni değere eşitler.
- Açık iller: Adana (demo) ve İstanbul. Diğer iller admin tarafından açılana kadar talep kabul etmez.

## 5 DAKİKADA USTAGO DEMO

`pnpm dev` çalışırken http://localhost:8081 adresini açın (tarayıcıda telefon görünümü için
geliştirici araçlarından mobil görünümü seçebilirsiniz) ya da telefonda Expo Go ile QR kodu okutun.
Müşteri ve usta için iki ayrı tarayıcı penceresi (biri gizli pencere) en rahatıdır.

1. **Müşteri girişi**: 500 000 00 01 → "Kod Gönder" → API çıktısındaki 6 haneli kod.
2. **Talep**: Ana Sayfa → Klima → başlık ve açıklama → adres "Ev (DEMO)" → (fotoğraf isteğe bağlı) →
   Tahmini bütçe **1.500** yazın ya da "Bütçem belli değil" seçin → zaman → Önizleme → **Talebi Yayınla**.
3. **Usta girişi** (ikinci pencere): 500 000 00 02 → Profil → **🔧 Usta Moduna Geç**. "İşler" sekmesinde
   talep görünür (liste 10-15 saniyede bir kendini yeniler).
4. **Teklif**: işe dokunun → fiyat **2.500** (bütçenin üstünde teklif serbesttir) → süre, not →
   **Teklif Gönder**.
5. **Pazarlık**: müşteri talebinde teklifi açar → karşı teklif **2.000**. Usta karşı teklif **2.200**.
6. **Anlaşma**: müşteri "✓ ₺2.200 ile Anlaş". Fiyat kilitlenir, iş oluşur; iki taraf da iş detayında
   anlaşılan fiyatı, adresi ve karşı tarafın telefonunu görür. Diğer ustaların teklifleri kapanır.
7. **ACİL USTA (NOW)**: müşteri Ana Sayfa'da 🚨 **ACİL USTA** → Klima → talep. Müsait ve NOW'u açık
   klima ustası (500 000 00 02) "İşler"de 🚨 **ACİL İŞ** rozetiyle görür ve tek seferlik fiyat verir;
   NOW'da karşı teklif yoktur, müşteri gelen fiyatlardan birini kabul eder.
8. **Admin**: http://localhost:3001 → `admin@ustago.test` + `SEED_DEV_PASSWORD` → Genel bakış (canlı
   sayılar), İş talepleri (filtreler, pazarlık geçmişi), Usta başvuruları (500 000 00 05'i onaylayın).

Temiz bir başlangıç için `pnpm dev:reset` (onay ister; yalnız yerel veritabanında çalışır).

## FAZ 4 — 10 DAKİKALIK DEMO

Faz 3 demosunun 1-6. adımlarıyla (Klima, bütçe 1.500 → teklif 2.500 → 2.000 → 2.200 → anlaşma)
bir iş oluşturun. Müşteri (500 000 00 01) ve usta (500 000 00 02) iki ayrı pencerede açık kalsın.
Ekranlar 10 saniyede bir kendini yeniler; zil ikonu okunmamış bildirim sayısını gösterir.

1. **Ana sayfa kartı**: müşteri Ana Sayfa'da "AKTİF İŞİNİZ" kartını, usta "İşler" sekmesinin
   başında "AKTİF İŞ" kartını görür. Karta dokunun.
2. **Usta yola çıkar**: usta iş ekranında tek büyük düğme **YOLA ÇIKTIM** → onay. Müşteride
   durum "Usta yolda" olur, zaman çizelgesinde gerçek saat yazar, 🔔 bildirim gelir.
3. **Varış ve başlangıç**: usta **ADRESE ULAŞTIM**, sonra **İŞE BAŞLADIM**. İki tarafta da
   "📞 Ara" düğmesi karşı tarafın telefonunu açar.
4. **Ek iş**: usta "+ Ek iş onayı iste" → **500** TL, "Kompresör rölesi değişti" → onay. Müşteri
   "Ek iş onayı bekleniyor" kartında **Onayla** der; pencere "Yeni toplam ₺2.700 olacak." yazar.
   Anlaşılan fiyat ₺2.200 olarak kalır, güncel toplam ₺2.700 olur.
5. **Reddedilen ek iş**: usta 300 TL daha ister, müşteri **Reddet** der → toplam ₺2.700 kalır.
   Ek iş beklerken usta "İŞİ TAMAMLADIM"a basamaz: "Önce bekleyen ek iş talebinin sonuçlanması
   gerekiyor."
6. **Tamamlama**: usta **İŞİ TAMAMLADIM** → "İşi tamamladığınızı müşteriye bildirmek istiyor
   musunuz?" → Bildir. Müşteride **İŞ TAMAMLANDI** ve **SORUN BİLDİR** çıkar; İŞ TAMAMLANDI → Onayla.
   Otomatik tamamlama yoktur.
7. **Değerlendirme**: müşteri yıldızlara dokunur (genel puan zorunlu, alt puanlar isteğe bağlı),
   en fazla 1000 karakter yorum → Gönder. 30 gün içinde düzenlenebilir.
8. **Usta profili**: iş ekranında "Usta profilini gör". Puan yalnızca gerçek yorumlardan gelir
   (seed'deki 3 DEMO yorumla ⭐ 4.7); yorum yazan adları maskelidir ("Zeynep D."), telefon/e-posta
   görünmez. Hiç yorumu olmayan usta "Yeni Usta" görünür.
9. **Sorun bildirimi**: yeni bir işte usta adrese vardıktan sonra müşteri **SORUN BİLDİR** →
   neden + açıklama → iş "Sorun bildirildi" olur. (Usta gelmeden yalnızca "Usta gelmedi" seçilir.)
10. **Admin** (http://localhost:3001): **İşler** (filtreler, iş detayı: durum geçmişi, pazarlık,
    ek işler, denetim kaydı) → **Sorun bildirimleri** → bildirimi açın, sonucu ve notu yazıp
    **Sonuçlandır** → **Değerlendirmeler** (gerekçeyle gizle / geri al) → **Usta başvuruları** →
    Demo Klima Ustası → **Kalite ve UstaScore** (etkenler, ağırlıklar, yaptırım verme/kaldırma).

**Push bildirimi hakkında:** yerelde `PUSH_PROVIDER=console`'dur. Bildirimler uygulama içinde
(🔔) gerçekten oluşur; push kopyası yalnızca API çıktısına `[DEV PUSH]` satırı olarak yazılır ve
sunucudan dışarı hiçbir şey gönderilmez. Gerçek cihaza push için EAS `projectId` ile derlenmiş bir
uygulama ve `PUSH_PROVIDER=expo` gerekir (ADR-0017).

## FAZ 5 — FINANCE LOCAL DEMO

**Gerçek para hareketi yoktur.** Yerelde `PAYMENT_PROVIDER=mock` ve `PAYOUT_PROVIDER=mock`
kullanılır: kart bilgisi istenmez, hiçbir ödeme kuruluşuna ya da bankaya bağlanılmaz. Mobilde
"TEST ÖDEME ORTAMI — gerçek ücret alınmaz", admin panelinde "TEST ÖDEME SAĞLAYICISI AKTİF —
Gerçek para hareketi yoktur." yazar. Üretimde mock sağlayıcı ve `/dev/*` uçları açılmaz (API
başlamaz / 404). Platform ücreti geliştirme politikası `DEV-DEFAULT-1500` (%15) nihai ticari oran
değildir. Vergi/faturalandırma hukuki-mali doğrulama gerektirir; müşteriye "Ödeme Özeti"
gösterilir, fatura değildir.

Seed, **Demo Elektrik Ustası**'na (500 000 00 03) hazır finans verisi yazar: 3 tamamlanmış iş
(₺3.000 uygulamadan + ₺250 admin iadesi, ₺800 nakit, ₺1.200 uygulamadan), TEST banka hesabı ve
ödenmiş ₺1.000 para çekme. Demo Klima Ustası senaryolar için temiz bırakılır.

- **A — Uygulamadan ödeme:** Faz 4 demosundaki işi (₺2.200) açın. Müşteri iş ekranındaki
  **Ödeme** kartında "Uygulamadan öde" → **₺2.200 ÖDE** → **Başarılı ödeme (TEST)**. Usta aynı
  kartta Brüt ₺2.200, Platform ücreti (%15) ₺330, Net kazancınız ₺1.870 görür. "Başarısız ödeme
  (TEST)" → "Ödeme alınamadı. Lütfen tekrar deneyin." ve yeniden deneme.
- **A2 — Ek iş farkı:** +₺500 ek iş onaylanınca kart **Kalan ₺500 ÖDE** gösterir; sessiz ek çekim
  yoktur. Fark ödenince toplam ücret ₺405 (₺2.700'ün %15'i).
- **B — Nakit:** başka bir işte "Ustaya doğrudan öde". Müşteri **Ödemeyi yaptım**, usta **Ödemeyi
  aldım** der (tek taraf yetmez). Onaydan sonra platform ücreti ustanın **platform borcu** olur ve
  sonraki online kazançtan mahsup edilir.
- **C — İade:** admin → **Finans → Ödemeler** → ödeme → **İade başlat**: tutar, neden, zorunlu iç
  not, iki aşamalı onay. İade edilebilir tutarı aşan istek reddedilir.
- **D — Kazançlarım ve para çekme:** usta modunda **Kazançlarım** sekmesi (bekleyen, kullanılabilir,
  ayrılan, platform borcu). **Para Çek** → TEST IBAN `TR33 0006 1005 1978 6457 8413 26` (yalnız
  maskeli hâli saklanır) → tutar → talep. Admin **Finans → Para çekme** → Onayla → **TEST: Ödendi
  işaretle**.
- **E — Anlaşmazlık:** iş "Sorun bildirildi" olunca kazanç tutulur. Admin sorun bildirimini
  sonuçlarken finansal karar seçer: tam iade, kısmi iade veya ustaya serbest bırak.
- **F — Mutabakat:** admin **Finans → Mutabakat** ya da terminalde:

```bash
pnpm finance:reconcile          # özet; uyumsuzluk varsa çıkış kodu 1
pnpm finance:reconcile --json   # makine okunur rapor
```

Seed sonrası beklenen çıktı: 2 ödeme, 1 iade, 2 kazanç, 1 para çekme, 1 nakit kayıt, 9 defter
kaydı; borç ₺10.390 = alacak ₺10.390, **DENGELİ**, uyumsuzluk 0. Mutabakat hiçbir şeyi otomatik
düzeltmez. Ayrıntı: ADR-0018, 0019, 0020 ve [docs/api](docs/api/README.md) Faz 5 bölümü.

## Troubleshooting

| Belirti                                                  | Çözüm                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Docker erişilemiyor` / `docker: command not found`      | Docker Desktop'ı açın, "running" olmasını bekleyin, komutu tekrarlayın.                                                                                           |
| `Port 3000 zaten kullanımda` (3001, 8081, 5432, 6379)    | Windows: `netstat -ano \| findstr :3000` → `taskkill /PID <PID> /F`. macOS/Linux: `lsof -i :3000` → `kill <PID>`.                                                 |
| `password authentication failed for user "ustago"`       | Docker volume eski bir şifreyle oluşmuş. `.env`'deki `POSTGRES_PASSWORD`'ü eski değere döndürün ya da (veri silinir) `docker compose down -v` → `pnpm dev:setup`. |
| Mobil uygulama "Sunucuya ulaşılamadı" diyor              | API çalışıyor mu (`pnpm dev:api`)? Telefon için aşağıdaki "Fiziksel telefon" notlarına bakın.                                                                     |
| OTP satırı görünmüyor                                    | API'yi `pnpm dev` / `pnpm dev:api` ile başlattığınız pencereye bakın; `.env`'de `SMS_PROVIDER=console` olmalı.                                                    |
| "Çok sık kod istendi"                                    | Telefon başına saatlik sınır ve 60 sn yeniden gönderme beklemesi var; bekleyin veya başka demo numarası kullanın.                                                 |
| Admin girişi reddediliyor                                | Şifre `.env`'deki `SEED_DEV_PASSWORD`; değiştirdiyseniz `pnpm dev:seed`.                                                                                          |
| `pnpm dev:reset` bir AI aracından çalıştırılınca duruyor | Prisma, yapay zekâ ajanlarının `migrate reset`'ini kullanıcı onayı olmadan engeller; kendi terminalinizden çalıştırın.                                            |
| PowerShell `running scripts is disabled`                 | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (pnpm/corepack betikleri için).                                                                             |
| Expo "Metro bundler" hatası / eski ekran                 | Expo penceresinde `r` (yenile) veya `pnpm --filter @ustago/mobile exec expo start -c` (önbelleği temizler).                                                       |

### Fiziksel telefon (Expo Go)

- Telefon ve bilgisayar **aynı Wi-Fi** ağında olmalı. Misafir ağları ve bazı kurumsal ağlar cihazlar
  arası bağlantıyı engeller; o durumda telefonun hotspot'una bilgisayarı bağlayın.
- Uygulama API adresini kendisi bulur: QR kodla açıldığında Metro'nun çalıştığı bilgisayarın IP'sini
  kullanır (`http://<bilgisayar-ip>:3000`). Android emülatörü `10.0.2.2`, web ve iOS simülatörü
  `localhost` kullanır. Elle vermek için `apps/mobile/.env` içine
  `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000` yazıp Expo'yu yeniden başlatın.
- Windows Güvenlik Duvarı ilk çalıştırmada Node.js için izin sorar: **Özel ağlar**'a izin verin.
  Sormadıysa: Windows Güvenlik → Güvenlik duvarı → "Bir uygulamaya izin ver" → Node.js (Özel).
- Tokenlar telefonda şifreli depoda (SecureStore) tutulur. Web önizlemesinde SecureStore olmadığı için
  sekme kapanınca silinen `sessionStorage` kullanılır; bu yalnızca yerel önizleme içindir.

### Manuel kurulum (script kullanmadan)

```bash
cp .env.example .env            # secret alanlarını doldurun (en az 32 karakter)
pnpm install
pnpm build --filter "./packages/*"
pnpm db:up && pnpm db:deploy && pnpm db:seed
pnpm --filter @ustago/api dev   # ayrı pencerelerde: admin, mobile
```

Testler: `pnpm test` (Docker gerekmez), `pnpm test:e2e` (PostgreSQL + Redis gerekir).

### Demo hesaplar ve API ile deneme

Swagger'da (http://localhost:3000/api/docs) `POST /api/v1/auth/login` ile e-posta + şifre girişi
yapın ya da `POST /api/v1/auth/otp/request { "phone": "0500 000 00 01" }` → API çıktısındaki kod →
`POST /api/v1/auth/otp/verify`. Dönen `accessToken`'ı **Authorize** düğmesine yapıştırın. Production'da
`console` ve `fake` SMS sağlayıcıları ortam şeması tarafından reddedilir
([ADR-0009](docs/adr/0009-telefon-otp-ve-sms.md)). Üretimde (`NODE_ENV=production`) seed yalnızca
il/ilçe/kategori verisini yükler.

### Admin paneli

`admin@ustago.test` ile giriş yapın. Panel: genel bakış (veritabanından canlı sayılar), iş talepleri
(durum, tür, il, kategori filtreleri; teklif ve pazarlık geçmişi; müşteri telefonu maskeli, açık adres
yok), usta başvuruları ve belge kuyruğu, geliştirici durumu. Oturum httpOnly çerezlerde tutulur; token
tarayıcı JavaScript'ine verilmez ([ADR-0013](docs/adr/0013-admin-kimlik-dogrulama.md)). Belge ve
fotoğraf yüklemeleri geliştirmede `apps/api/.data/storage` altında durur (git'e girmez).

## Komutlar

| Komut                               | Açıklama                                                              |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev:setup`                    | Tek seferlik kurulum: `.env`, paketler, Docker, migration, demo seed  |
| `pnpm dev`                          | API + Admin + Expo (Docker servislerini gerekirse başlatır)           |
| `pnpm dev:api` / `dev:admin`        | Yalnız API (:3000) / yalnız Admin (:3001)                             |
| `pnpm dev:mobile`                   | Expo (QR kod, `w` web, `a` Android emülatör)                          |
| `pnpm dev:infra`                    | Yalnız PostgreSQL + Redis (Docker)                                    |
| `pnpm dev:seed`                     | Migration + demo verisi (tekrar çalıştırılabilir)                     |
| `pnpm dev:reset`                    | Yerel veritabanını siler, yeniden kurar ve demo verisini yükler       |
| `pnpm lint`                         | Tüm paketlerde ESLint                                                 |
| `pnpm typecheck`                    | Tüm paketlerde TypeScript (strict)                                    |
| `pnpm test`                         | Birim ve smoke testleri (Docker gerekmez)                             |
| `pnpm test:e2e`                     | API'yi gerçek PostgreSQL + Redis ile test eder (`pnpm db:up` gerekir) |
| `pnpm format` / `pnpm format:check` | Prettier                                                              |
| `pnpm build`                        | Tüm paketleri ve uygulamaları derler                                  |
| `pnpm db:up` / `pnpm db:down`       | Docker servislerini başlatır / durdurur                               |
| `pnpm db:generate`                  | Prisma istemcisini üretir                                             |
| `pnpm db:migrate`                   | Prisma migration oluşturur ve uygular (geliştirme)                    |
| `pnpm db:deploy`                    | Mevcut migration'ları uygular (CI / üretim)                           |
| `pnpm db:seed`                      | Referans veri + (geliştirmede) demo hesaplar                          |
| `pnpm db:reset`                     | Lokal veritabanını sıfırlar, migration + seed (Prisma CLI)            |
| `pnpm db:validate`                  | Prisma şemasını doğrular                                              |
| `pnpm finance:reconcile`            | Defter ve finans kayıtlarının mutabakatı (salt okunur)                |
| `pnpm config:check`                 | Ortam değişkenlerini API açılışıyla aynı kurallarla doğrular (Faz 6)  |
| `pnpm security:secrets`             | Repodaki dosyalarda sır/anahtar taraması                              |
| `pnpm db:migration-guard`           | Faz 5 sonrası migration'ların yalnız ekleme yaptığını doğrular        |

## Kurallar (özet)

Tam liste: PROJECT.md §31.

- TypeScript `strict`, `any` yasak (ESLint hatası).
- Input doğrulaması backend'de zorunlu; şemalar `@ustago/validation` içinde.
- Para her zaman `amount_minor` tamsayı + `currency`; tarih veritabanında UTC.
- Secret koda yazılmaz; yeni değişken hem şemaya hem `.env.example`'a eklenir.
- Her fazın sonunda `pnpm lint && pnpm typecheck && pnpm test`.

## Dokümanlar

- API, hata biçimi ve uç noktalar: [docs/api](docs/api/README.md)
- Domain modeli: [docs/architecture/domain-model.md](docs/architecture/domain-model.md)
- Kararlar: [docs/adr](docs/adr/README.md) (0005 rol modeli, 0006 para, 0007 auth, 0008 domain,
  0009 OTP/SMS, 0010 usta yaşam döngüsü ve NOW, 0011 belge ve depolama, 0012 konum verisi,
  0013 admin oturumu, 0014 talep, teklif, pazarlık ve NOW, 0015 iş yaşam döngüsü ve ek iş,
  0016 değerlendirme ve UstaScore V1, 0017 bildirim outbox ve Expo push, 0018 finansal defter,
  0019 ödeme sağlayıcı soyutlaması, 0020 platform ücreti ve usta kazancı, 0021 üretim hazırlığı
  seviyeleri, 0022 ortam ayrımı ve fail-closed config, 0023 usta doğrulama ve askıya alma,
  0024 admin yetkileri ve oturum güvenliği, 0025 komisyon politikası ve finans sertleştirme,
  0026 operasyon ve mutabakat, 0027 hesap silme ve veri dışa aktarma)
- Runbook'lar: [docs/runbooks](docs/runbooks) (üretim sürüm kontrol listesi, felaket kurtarma,
  belirsiz para çekme, mutabakat uyumsuzluğu)
- Bekleyen kararlar (DECISION REQUIRED): [docs/decisions](docs/decisions)
- Veri sınıflandırma ve saklama (Legal review required): [docs/security](docs/security)
- Türkiye il/ilçe verisinin kaynağı: [docs/reference-data](docs/reference-data/turkey-locations.md)

## CI

`.github/workflows/ci.yml`: install → format check → sır taraması + ekleme-only migration kontrolü →
bağımlılık denetimi (kritikte kırmızı) → lint → typecheck → test → build → üretim config kontrolü (mock sağlayıcı/demo seed reddedilmeli, eksiksiz üretim config'i
kabul edilmeli) → Prisma validate +
migrate deploy + şema/migration fark kontrolü → seed (iki kez, idempotent) → API e2e
(GitHub Actions servis konteynerlerinde PostgreSQL + Redis).
