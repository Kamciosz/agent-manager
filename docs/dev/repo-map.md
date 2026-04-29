# Struktura projektu

Data: 2026-04-28

Gdzie co leży i co zmieniać.

## Jak projekt jest zorganizowany

Agent Manager nie ma własnego kodu serwerowego. Backend to Supabase — usługa zewnętrzna. W repozytorium żyje tylko:

- **interfejs webowy** (pliki HTML/JS/CSS) — budowany i hostowany przez GitHub Pages
- **schemat bazy danych** (pliki SQL) — wersjonowany w repo i stosowany przez Supabase tools / ręczną migrację
- **dokumentacja** — wszystko w `docs/`

## Struktura katalogów

```
/ (katalog główny)
├── README.md               — opis projektu i szybki start
├── FORK_GUIDE.md           — jak uruchomić własną kopię (10 minut)
├── todo.md                 — kamienie milowe i lista zadań
│
├── ui/                     — interfejs webowy (GitHub Pages)
│   ├── index.html          — strona główna / dashboard
│   ├── app.js              — logika aplikacji (połączenie z Supabase)
│   └── style.css           — wygląd
│
├── supabase/               — konfiguracja backendu
│   ├── migrations/         — pliki SQL ze schematem bazy danych
│   │   ├── 001_tasks.sql   — tabela zadań
│   │   ├── 002_agents.sql  — tabela agentów i profili
│   │   └── 003_rls.sql     — polityki bezpieczeństwa (RLS)
│   └── migrations/         — migracje SQL stosowane poza workflow Pages
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
| Wygląd interfejsu | `ui/style.css` |
| Logika UI, połączenie z Supabase | `ui/app.js` |
| Schemat tabel w bazie danych | `supabase/migrations/` |
| Polityki dostępu (kto widzi co) | `supabase/migrations/003_rls.sql` |
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
| Infrastruktura (nginx, TLS) | `infra/` |
| Testy | `tests/` |

## Świadome decyzje architektoniczne

- UI runtime działa bez bundlera i bez `npm install`; większe refaktory zaczynaj od modułów ES, nie od obowiązkowej migracji na framework.
- Workflow GitHub Pages nie stosuje migracji Supabase. Migracje są jawne i wykonywane przez właściciela projektu/forka.
- Alpha działa jako wspólny team-space dla aplikacyjnych użytkowników jednej klasy/szkoły. To nie jest jeszcze model SaaS multi-tenant.
- Stacje robocze używają tokenu instalacyjnego i ograniczonej technicznej sesji stacji. Hasło operatora nie powinno trafiać do lokalnego `config.json`.
- AI kierownik nie dostaje narzędzi do arbitralnego wykonywania komend bez osobnego sandboxa i audit logu.
