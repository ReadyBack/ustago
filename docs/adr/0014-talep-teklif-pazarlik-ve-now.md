# ADR-0014: İş talebi, teklif, pazarlık ve UstaGO NOW

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-30

## Bağlam

Faz 3'ün hedefi uçtan uca çalışan yerel demo: müşteri talep açar, uygun ustalar görür, usta teklif
verir, iki taraf pazarlık eder, kabul edilen fiyat kilitlenir ve iş (Job) oluşur. Aynı akışın acil
sürümü UstaGO NOW (ACİL USTA). Ürün sahibinin Faz 1 kararları bağlayıcıdır: müşteri bütçesi tavan
değildir, teklifler revize edilebilir, anlaşılan fiyat kilitlenir, sahte puan / mesaj / bildirim yok.
Eşzamanlı istekler (iki kabul, kabul ile iptal, çift dokunma) tek tutarlı sonuç vermelidir.

## Karar

### Talep (ServiceRequest)

- İki tür: `QUOTE` (Teklif Al) ve `NOW` (Acil Usta). Durumlar: `DRAFT → PUBLISHED` (QUOTE) veya
  `MATCHING` (NOW) → `QUOTED` (açık teklif var) → `MATCHED` (anlaşma, iş oluştu); yan yollar
  `CANCELLED`, `EXPIRED`. `COMPLETED` iş adımlarıyla (sonraki faz) gelir.
- **Bütçe isteğe bağlıdır ve yalnızca tahmindir.** `budgetMinor` null ise "Bütçem belli değil".
  Backend teklifi bütçeyle hiçbir koşulda sınırlamaz; bütçenin üstündeki teklif normal kabul edilir
  (e2e testi: bütçe 1.500, teklif 2.500 → 201). Arayüz "Tahmini bütçeniz (ustalar farklı fiyat teklif
  edebilir)" der.
- Para her yerde `BigInt` kuruş (ADR-0006); API'de `{ amountMinor, currency }` tamsayı. Float yok.
- Süre: QUOTE talebi 14 gün (`QUOTE_REQUEST_TTL_HOURS`), NOW 60 dakika (`NOW_REQUEST_TTL_MINUTES`)
  açık kalır. Arka plandaki süpürücü (`REQUEST_EXPIRY_SWEEP_SECONDS`) süresi dolanları ve açık
  tekliflerini kapatır.
- Teklif geldikten sonra kategori, adres ve tür değişmez; anlaşmadan sonra hiçbir alan değişmez.
- Oluşturma `idempotencyKey` ile tekrar güvenlidir; yayınlama tekrar çağrıda etkisizdir.
- Fotoğraf: en fazla 5, JPEG/PNG, 10 MB; imzalı yükleme (ADR-0011 ile aynı depolama).

### Eşleşme ve gizlilik

- Usta, talebi yalnızca **ACTIVE** ise ve talebin kategorisi hizmetlerinde, ilçesi hizmet
  bölgelerinde, il ve kategori o ilde açıksa görür. Müşteri kendi talebine teklif veremez.
- Anlaşmadan önce usta talebin yalnızca **il / ilçe** bilgisini görür: müşteri adı, telefonu, sokak,
  bina, daire ve tarif gizlidir. Anlaşmadan sonra iş detayında iki taraf tam adresi ve birbirinin
  telefonunu görür.
- Admin talep detayında müşteri telefonu maskeli, adres mahalle düzeyindedir.
- Teklif kartında puan yalnızca gerçek yayınlanmış yorumlardan gelir; yoksa "Yeni Usta" yazar.

### Teklif ve pazarlık (Quote, QuoteRevision)

- Bir usta bir talebe bir teklif (tekil indeks) açar. Her hamle değişmez bir `QuoteRevision`
  satırıdır: `OFFER`, `CUSTOMER_COUNTER`, `PROVIDER_COUNTER`. En fazla 10 revizyon.
- Sıra tabanlı: teklif `PENDING_CUSTOMER` iken müşteri, `PENDING_PROVIDER` iken usta hamle yapar
  (karşı teklif veya kabul). Her hamle `expectedRevisionNo` taşır; arada başka hamle olduysa 409
  döner ve istemci güncel hali yeniden çeker (iyimser eşzamanlılık).
- Usta karşı teklifinde malzeme, süre ve not gibi ayrıntılar ustanın kendi son revizyonundan taşınır.
- Müşteri reddedebilir, usta geri çekebilir; kapanan teklif yeniden açılmaz.

### Kabul, fiyat kilidi ve iş (Job)

- Kabul tek transaction'da: önce talep satırı, sonra teklif satırı kilitlenir (`SELECT … FOR UPDATE`,
  hep aynı sırada; kilitlenme olmaz); durumlar koşullu güncellenir. Kabul edilen revizyonun tutarı
  `Job.agreedPriceMinor` olarak yazılır ve değişmez. İş talep başına tektir (tekil indeks). Talep
  `MATCHED` olur, diğer açık teklifler `REJECTED`.
- Yarışlar: iki farklı teklife aynı anda kabul, çift dokunma, kabul ile iptal, kabul ile karşı teklif
  → her durumda tam olarak biri başarılı, diğeri 409 (e2e: `concurrency.e2e-spec.ts`).
- Ödeme bu fazda yok: kart bilgisi alınmaz, sahte ödeme ekranı yoktur.

### UstaGO NOW (MVP)

- Kategori ve il için `supportsNow` / il-kategori ayarında NOW açık olmalı; demo seed'de Adana'da
  Klima (ve Elektrik, Su Tesisatı, Çilingir) açıktır.
- Yayınlanınca uygun, NOW'u açık **ve** "Müsaitim" durumundaki ustalardan bir dalga
  (`NOW_DISPATCH_WAVE_SIZE`, varsayılan 20) seçilir ve `EmergencyDispatchOffer` satırları yazılır.
  Uygun usta yoksa talep yine açılır ve müşteri "usta aranıyor" durumunu görür.
- NOW'da **tek tur fiyat**: usta bir fiyat verir, karşı teklif yoktur; müşteri gelen fiyatlardan birini
  kabul eder. Hız için pazarlık kapalıdır. Kabul edilince diğer dağıtım satırları `SUPERSEDED` olur.
- Usta uygulamasında NOW işleri 🚨 ACİL İŞ rozetiyle listenin başında görünür.

### Bildirim

- Bu fazda **push yok**. Olaylar (yeni talep, yeni teklif, karşı teklif, kabul) aynı transaction'da
  `Notification` tablosuna `channel = IN_APP`, `sentAt = null` olarak yazılır (outbox). Uygulama
  listeleri 10-15 saniyede bir yeniler. Arayüz "bildirim gönderildi" demez. Push teslimi sonraki
  fazda bu outbox'tan okunacak.

### Mobil istemci

- Expo Router. Tokenlar SecureStore'da (webde yerel önizleme için `sessionStorage`); AsyncStorage'da
  token yok. 401'de tek uçuşlu (single-flight) refresh: aynı anda düşen istekler tek refresh'i
  bekler, çünkü sunucu refresh token'ı döndürür ve eskisinin ikinci kullanımı oturumu kapatır.
- Kimlik doğrulamalı istekler, uygulama açılışında kayıtlı oturum okunana kadar bekler.

## Sonuçlar

- Olumlu: fiyat tavanı olmadığı için usta gerçek maliyetini yazabilir; revizyon geçmişi anlaşmazlıkta
  kanıttır; kilit sırası ve tekil indeksler yarışları veritabanı düzeyinde çözer.
- Olumsuz / ödünler: NOW'da pazarlık yok (bilinçli sadelik); push olmadığı için ustalar uygulamayı
  açık tutmalı; bildirim satırları şimdilik yalnızca okunur. Dağıtım dalgası tek seferlik; süre
  dolmadan yeni dalga (genişleyen yarıçap) sonraki fazda.
