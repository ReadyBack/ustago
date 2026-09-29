# ADR-0001: pnpm + Turborepo monorepo, modüler monolith

- **Durum:** Kabul edildi
- **Tarih:** 2026-09-29

## Bağlam

UstaGO; mobil uygulama (Expo), admin paneli (Next.js) ve API'den (NestJS) oluşur.
Tipler, doğrulama şemaları ve tasarım tokenları üç uygulama arasında paylaşılmalıdır.
PROJECT.md §15.2 ilk aşamada microservice yerine modüler monolith önerir.

## Karar

- Tek repo, `pnpm` workspace'leri: `apps/*` ve `packages/*`.
- Görev orkestrasyonu ve önbellek için **Turborepo** (`turbo run lint|typecheck|test|build`).
- Paylaşılan paketler (`@ustago/types`, `validation`, `config`, `ui`) `tsc` ile `dist/`e derlenir;
  Turborepo `^build` bağımlılığıyla uygulamalardan önce derler.
- API tek bir NestJS uygulamasıdır; alanlar (auth, jobs, payments…) Nest modülleri olarak ayrılır.
  Matching, chat, notification ve payment worker'ları ölçek gerektiğinde ayrıştırılabilir.

## Sonuçlar

- Paylaşılan kod tek yerde; bir tip değişikliği tüm uygulamalarda typecheck ile yakalanır.
- Turborepo önbelleği CI ve lokal süreleri kısaltır.
- Paketler derlendiği için ilk kurulumda `pnpm build` (veya herhangi bir turbo görevi) gerekir.
