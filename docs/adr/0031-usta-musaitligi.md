# ADR-0031: Usta müsaitliği

- **Durum:** Kabul edildi
- **Tarih:** 2026-10-04

## Bağlam

Faz 3'te ustanın tek anahtarı "Şu an müsaitim" (NOW) idi. Faz 7'de dağıtım (ADR-0028) ustanın
gerçekten iş alıp alamayacağını bilmeli; aksi hâlde müsait olmayan ustaya iş gider ve müşteri
bekler.

## Karar

- Ayarlar: **Yeni iş alma** (`acceptingNewJobs=false`, duraklatma), **Bugün müsait değilim**
  (`unavailableUntil` = İstanbul saatiyle günün sonu), **haftalık çalışma saatleri** (gün başına
  aralıklar) ve **izin** (başlangıç–bitiş, en çok 20 açık izin, geçmişe izin yok).
- Durum önceliği: `PAUSED` > `TIME_OFF` > `UNAVAILABLE_TODAY` > `OUTSIDE_HOURS` > `AVAILABLE`
  (`providers/domain/availability.ts`, saf fonksiyon ve birim testleri).
- Saat dilimi `MARKETPLACE_TIME_ZONE` (varsayılan `Europe/Istanbul`); veritabanı UTC tutar.
- Etki: duraklatma, izin ve "bugün müsait değilim" yeni dağıtımı durdurur. Çalışma saati yoksa usta
  esnek sayılır. Çalışma saati dışında olmak teklif talebini engellemez, yalnız puanı düşürür
  (10 yerine 4); **NOW için çalışma saati içinde olmak zorunludur** (tanımlıysa).
- Duraklatma "Şu an müsaitim"i de kapatır. Mevcut işler ve teklifler hiçbir ayardan etkilenmez.
- Her değişiklik denetime yazılır.

## Sonuçlar

- Takvim entegrasyonu (Google Calendar vb.) yoktur.
- Resmî tatiller otomatik bilinmez; usta izin olarak girer.
