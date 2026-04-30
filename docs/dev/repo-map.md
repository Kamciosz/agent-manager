# Struktura projektu

Data: 2026-04-28

Gdzie co leży i co zmieniać.

## Jak projekt jest zorganizowany

Agent Manager nie ma własnego kodu serwerowego. Backend to Supabase — usługa zewnętrzna. W repozytorium żyje tylko:

- **interfejs webowy** (statyczne HTML/JS) — publikowany przez GitHub Pages bez bundlera
- **schemat bazy danych** (pliki SQL) — wersjonowany w repo i stosowany przez Supabase tools / ręczną migrację
- **dokumentacja** — wszystko w `docs/`

## Struktura katalogów

```
/ (katalog główny)
├── README.md               — opis projektu i szybki start
├── FORK_GUIDE.md           — jak uruchomić własną kopię (10 minut)
├── CHANGELOG.md            — historia zmian
├── SECURITY.md             — zasady zgłaszania podatności
├── start.{sh,command,bat,ps1} — launchery stacji roboczej
├── Aktualizuj.{command,bat}, update.{sh,ps1} — aktualizacja launchera
│
├── ui/                     — interfejs webowy (GitHub Pages)
│   ├── index.html          — strona główna / dashboard
│   ├── app.js              — logika aplikacji (połączenie z Supabase)
│   ├── ai-client.js        — lokalny proxy AI / fallback
│   ├── manager.js          — przeglądarkowy kierownik AI
│   ├── executor.js         — przeglądarkowy executor
│   ├── settings.js         — preferencje UI
│   ├── task-events.js      — renderowanie historii zmian zadania
│   └── labyrinth.js        — preset Hermes Labyrinth
│
├── supabase/               — konfiguracja backendu
│   ├── migrations/         — migracje SQL stosowane poza workflow Pages
│   └── functions/          — Edge Functions dla tokenów instalacyjnych stacji
│
├── .github/
│   └── workflows/
│       └── deploy.yml      — automatyczny deploy (GitHub Actions)
│
├── docs/                   — dokumentacja (ten katalog)
│   ├── index.md            — mapa dokumentacji
│   ├── concept/            — wizja i role
│   ├── architecture/       — architektura i komunikacja AI↔AI
│   ├── product/            — MVP scope i UI spec
│   └── dev/                — szczegóły techniczne i testy
│
└── infra/                  — notatki infrastrukturalne (bez kodu)
```

## Co zmieniać gdzie

| Cel zmiany | Plik/katalog |
|-----------|--------------|
| Wygląd interfejsu | `ui/index.html` i klasy Tailwind CDN |
| Logika UI, połączenie z Supabase | `ui/app.js` oraz małe moduły w `ui/*.js` |
| Schemat tabel w bazie danych | `supabase/migrations/` |
| Polityki dostępu (kto widzi co) | najnowsze migracje w `supabase/migrations/` |
| Konfiguracja deploy | `.github/workflows/deploy.yml` |
| Dokumentacja | `docs/` |

## Jak to wdrożyć

Każdy `git push` do gałęzi `main`:
1. GitHub Actions uruchamia `deploy.yml`
2. Podmienia placeholdery Supabase w `ui/app.js`
3. Publikuje `ui/` na GitHub Pages

Migracje SQL z `supabase/migrations/` nie są wykonywane przez workflow Pages.
Stosuj je przez Supabase tools albo panel SQL przed wdrożeniem funkcji zależnych od nowego schematu.

Szczegółowy setup: [FORK_GUIDE.md](../../FORK_GUIDE.md)

## Świadome decyzje architektoniczne

- UI runtime działa bez bundlera i bez `npm install`; większe refaktory zaczynaj od modułów ES, nie od obowiązkowej migracji na framework.
- Workflow GitHub Pages nie stosuje migracji Supabase. Migracje są jawne i wykonywane przez właściciela projektu/forka.
- Alpha działa jako wspólny team-space dla aplikacyjnych użytkowników jednej klasy/szkoły. To nie jest jeszcze model SaaS multi-tenant.
- Stacje robocze używają tokenu instalacyjnego i ograniczonej technicznej sesji stacji. Hasło operatora nie powinno trafiać do lokalnego `config.json`.
- AI kierownik nie dostaje narzędzi do arbitralnego wykonywania komend bez osobnego sandboxa i audit logu.
