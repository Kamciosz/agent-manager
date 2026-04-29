# Review sugestii modeli — backlog implementacyjny

Data: 2026-04-29
Zakres: pliki z katalogu `sugestie/` oraz aktualny stan repozytorium.

## Wniosek

Sugestie warto traktować jako backlog stabilizacji szkolnego wdrożenia, nie jako mandat do zmiany fundamentu projektu. Najbardziej zasadne są postulaty Kimi K2, Mistral, Qwen-3 i Minimax: odporność stacji na offline, rate limiting, pełniejszy lifecycle jobów, walidacja Edge Functions, centralne zarządzanie konfiguracją i obserwowalność stacji.

Nie rekomenduję teraz migracji na Python/LangChain, ciężkiego React/Vite, automatycznych migracji bazy przez GitHub Pages CI ani narzędzi wykonujących komendy bez sandboxa.

## Ocena modeli

| Źródło | Ocena zasadności | Co bierzemy | Co odrzucamy lub odkładamy |
|---|---|---|---|
| GLM-5 | Niska | Ogólne hasła: retry, stan, sandbox | Założenie, że projekt jest Python/LangChain |
| Qwen-3 | Wysoka | Walidacja, Node LTS, testy, diagramy | Pełny multi-tenant jako warunek dla alpha |
| ChatGPT | Średnia | Role, pipeline, observability | Generyczne rady bez znajomości repo |
| Copilot | Średnia/wysoka | Testy, security scan, dokumentacja | Duże refaktory bez bezpośredniego zysku |
| DeepSeek V4-think | Wysoka | Node LTS, releases, proces w tle | Jedno CLI w Go/Rust jako szybki krok |
| Gemini | Średnia | UX, onboarding, docs | Dark mode jako pilny priorytet |
| Kimi K2 | Najwyższa | Offline queue, batching, health smoke, rate limiting | Tooling AI bez sandboxa |
| Minimax M2 | Wysoka | Stabilność, bezpieczeństwo, observability | Enterprise-heavy warstwy przed beta |
| Mistral | Wysoka | CORS, walidacja, testy, constraints, retry | Sugestie już wdrożone jako nowe braki |

## Status postulatów

| Postulat | Status | Priorytet | Moduły |
|---|---|---|---|
| Tokeny instalacyjne z TTL i limitem użyć | Już jest | Done | `supabase/migrations`, `supabase/functions`, `ui/app.js` |
| Brak hasła operatora na stacjach | Już jest | Done | `workstation-agent.js`, launchery, Edge Functions |
| Drag/drop i usuwanie siatki sali | Już jest | Done | `ui/app.js` |
| Filtry poleceń | Już jest | Done | `ui/app.js`, `ui/index.html` |
| Security scan na sekrety/config | Już jest | Done | `.github/workflows/security-scan.yml` |
| Walidacja Edge Functions | Wdrożone w tej rundzie | P1 | `supabase/functions/*` |
| CORS Edge Functions bez `*` | Wdrożone w tej rundzie | P1 | `supabase/functions/*`, `FORK_GUIDE.md` |
| Rate limiting/fair-share użytkowników | Fundament wdrożony: limit 3 aktywnych zadań | P0 | `supabase/migrations`, `ui/app.js` |
| Cancel/retry/reassign zadań | Anuluj/Ponów wdrożone; przerzucanie na inną stację jeszcze do dopięcia | P0 | `supabase/migrations`, `ui/app.js`, `ui/manager.js`, `workstation-agent.js` |
| Offline queue stacji | Brak | P0 | `workstation-agent.js` |
| Batching logów i pollingu | Brak | P0 | `workstation-agent.js`, config |
| Run trace zadania | Brak | P1 | `ui/app.js`, `messages`, `workstation_messages`, `workstation_jobs` |
| Health smoke modelu | Brak | P1 | `proxy.js`, `workstation-agent.js`, monitor UI |
| Metryki zasobów stacji | Częściowe | P1 | `workstation-agent.js`, `ui/app.js` |
| Presety runtime i `reconfigure` | Brak | P1 | `ui/app.js`, `workstation-agent.js` |
| Node 20/22 LTS | Brak | P1 | README, launchery, workflow |
| `node:test` bez npm | Brak | P2 | `tests/`, workflows |
| Changelog/security docs | Brak | P2 | `CHANGELOG.md`, `SECURITY.md` |
| React/Vite albo Python rewrite | Odrzucone teraz | Later | Cały frontend/backend |
| Tooling AI z `execute_command` | Odrzucone bez sandboxa | Later | przyszły sandbox |

## Kolejność implementacji

1. P0: dokończyć przerzucanie retry na inną stację oraz zabezpieczenia offline queue/batchingu.
2. P0: batching i offline queue, żeby 20 stacji nie zabiło free tier Supabase i nie gubiło wyników przy słabym WiFi.
3. P1: run trace, health smoke i metryki stacji w monitorze.
4. P1: presety runtime oraz bezpieczna komenda `reconfigure`.
5. P2: testy `node:test`, changelog, security docs i release checklist.

## Decyzje

- GitHub Pages + Supabase + lokalne llama.cpp zostają fundamentem.
- Migracje bazy pozostają jawne i nie są wykonywane przez workflow Pages.
- Team-space alpha jest świadomym modelem dla jednej klasy/szkoły, nie SaaS multi-tenant.
- `ui/app.js` rozbijamy na ES modules dopiero wtedy, gdy P0/P1 są stabilne.
- Nie dodajemy arbitralnego wykonywania poleceń przez AI bez sandboxa, limitów i audit logu.