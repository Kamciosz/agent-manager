# Optymalizacja do wersji produkcyjnej

Data: 2026-04-30  
Status: szczegółowy plan wyjścia z alpha/beta po analizie repo i porównaniu z podobnymi projektami open source.

## 1. Metoda researchu

Ten dokument powstał po dwóch rundach researchu:

1. Analiza obecnego repo Agent Manager:
   - `README.md`
   - `FORK_GUIDE.md`
   - `docs/architecture/overview.md`
   - `docs/architecture/communication.md`
   - `docs/architecture/agent-profiles.md`
   - `docs/product/hermes-labyrinth.md`
   - `docs/product/ui-spec.md`
   - `docs/product/alpha-release.md`
   - `docs/product/mvp-scope.md`
   - `docs/dev/api-reference.md`
   - `docs/dev/repo-map.md`
   - `docs/dev/testing.md`
   - `ui/*.js`
   - `local-ai-proxy/proxy.js`
   - `local-ai-proxy/workstation-agent.js`
   - `supabase/functions/*/index.ts`
   - `supabase/migrations/*.sql`
   - `.github/workflows/*.yml`
2. Porównanie z projektami agentowymi i lokalnymi platformami LLM na GitHub:
   - OpenHands
   - AutoGPT
   - CrewAI
   - Langflow
   - Flowise
   - MetaGPT
   - Open WebUI
   - LocalAI
   - Ollama
   - LiteLLM

Wniosek główny: Agent Manager ma sensowny kierunek jako lekki panel + Supabase + lokalne stacje GGUF, ale do produkcji brakuje mu twardego control plane: warstwy odpowiedzialnej za spójny model uprawnień, atomową kolejkę, ślady wykonania, wersjonowanie workflow, obserwowalność, migracje i automatyczne testy.

## 2. Najkrótsza diagnoza

Obecny projekt jest dobrym alpha/MVP, bo ma:

- działające UI na GitHub Pages,
- Supabase Auth/Postgres/Realtime,
- tabele zadań, przydziałów, wiadomości, profili i stacji,
- lokalny runtime przez `llama-server` + `proxy.js`,
- `workstation-agent.js`, który rejestruje stację, robi heartbeat i pobiera joby,
- Edge Functions do tokenów instalacyjnych stacji,
- launchery Windows/macOS/Linux,
- dokumentację i smoke testy launcherów.

Nie jest jeszcze produkcyjny, bo kluczowe zachowania są nadal zbyt luźne:

- część logiki orchestration działa w przeglądarce, a nie w kontrolowanej warstwie backendowej,
- kolejka jobów nie ma atomowego claim/lease/dead-letter,
- RLS i role są poprawiane, ale model tenant/organization/classroom/station identity nie jest jeszcze pełny,
- Hermes Labyrinth jest zapisanym kontekstem/presetem, a nie pełnym workflow run z krokami i artefaktami,
- brakuje pełnych testów RLS, E2E, Edge Functions, migracji, job queue i stacji,
- brakuje obserwowalności: trace id, metryk, dashboardów, alertów, historii zmian,
- deploy Pages nie stosuje migracji ani nie tworzy środowisk preview/staging,
- frontend jest praktyczny dla alpha, ale przy dalszym wzroście stanie się trudny w utrzymaniu.

## 3. Czego uczą podobne projekty z GitHuba

| Projekt | Co robi dobrze | Lekcja dla Agent Manager |
|---------|----------------|--------------------------|
| OpenHands | Rozdziela SDK, CLI, Local GUI, Cloud i Enterprise. Ma lokalny GUI z REST API, React SPA, multi-user, RBAC, collaboration i osobną infrastrukturę ewaluacji. | Rozdzielić produkt na: UI, API/control plane, worker/station runtime, workflow engine i test/eval harness. Nie trzymać całej orkiestracji w UI. |
| AutoGPT | Ma frontend, serwer, workflow/block builder, deployment controls, monitoring/analytics, marketplace, Agent Protocol i benchmark. | Dodać jawny protokół zadań i uruchomień: `task -> workflow_run -> steps -> artifacts -> result`. Przygotować standard API, nie tylko tabele Supabase. |
| CrewAI | Rozróżnia autonomiczne `Crews` i kontrolowane `Flows`. Używa konfiguracji agentów/tasks oraz event-driven state. | Hermes powinien mieć dwa tryby: szybki controlled flow dla prostych zadań i pełny multi-agent flow dla złożonych. Profile agentów powinny być wersjonowane jak konfiguracja. |
| Langflow | Visual builder, API/MCP server, observability integrations, deploy workflow as API, Python component customization. | Każdy workflow/preset powinien dać się wywołać jako API, przetestować, wyeksportować i wersjonować. Dodać MCP/API później, nie tylko UI. |
| Flowise | Monorepo z server/ui/components, Docker/self-host, Swagger/API docs, env config, load test, agentflow visualization i HITL. | Docelowo potrzebny jest backend API z dokumentacją, komponenty workflow, HITL i podgląd wykonania krok po kroku. |
| MetaGPT | Traktuje role agentów jako SOP: product manager, architect, engineer itd., generuje artefakty w workspace. | Hermes Labyrinth powinien materializować artefakty: mapa, decyzje, plan, kod, dowody, weryfikacja, raport. Nie tylko tekst w jednym `messages.content`. |
| Open WebUI | RBAC, user groups, flexible DB/storage, PWA, RAG, model builder, tools/plugins, OpenTelemetry, Redis-backed multi-worker WebSocket. | Do produkcji trzeba mieć grupy, role, retencję danych, storage artefaktów, telemetry i skalowanie realtime poza pojedynczy panel. |
| LocalAI | OpenAI/Anthropic-compatible API, wiele backendów, API key auth, quotas, role-based access, model gallery, distributed mode z PostgreSQL + NATS. | Lokalny runtime Agent Manager powinien iść w stronę standardowego API, capability discovery, quota/limits i opcjonalnego distributed queue. |
| Ollama | Prosty lokalny model server z REST API, bibliotekami, integracjami i jasnym modelem uruchamiania. | Im prostszy kontrakt runtime, tym łatwiej utrzymać launchery. Warto rozważyć zgodność z OpenAI/Ollama API zamiast własnego tylko `/generate`. |
| LiteLLM | AI gateway: unified API, auth, virtual keys, spend tracking, guardrails, load balancing, fallback, admin dashboard, release/load test discipline. | `proxy.js` powinien urosnąć w mały AI gateway: routing modeli, fallback, rate limit, audit, metryki, role i klucze. |

## 4. Obecny obraz projektu

### 4.1 Warstwy

| Warstwa | Obecnie | Problem produkcyjny | Docelowo |
|---------|---------|---------------------|----------|
| UI | Vanilla JS + Tailwind CDN na GitHub Pages | szybkie alpha, ale rosnące pliki i trudniejsza kontrola stanu | modułowy frontend lub React/Preact, testy komponentów, bundling, typy |
| Backend aplikacyjny | Supabase bez własnego serwera | logika orkiestracji częściowo w przeglądarce | Supabase RPC/Edge Functions albo lekki API server jako control plane |
| DB | Postgres migracje SQL ręcznie stosowane | brak automatycznej walidacji migracji i testów RLS | migracje w CI/staging, testy RLS i rollback plan |
| Realtime | Supabase Realtime + polling | ryzyko nadmiarowych eventów, limity free tier, brak trace | filtrowane kanały, event log, fallback polling/backoff |
| AI runtime | `proxy.js` -> llama.cpp `/completion` | jeden prosty endpoint, brak streamingu i metryk | OpenAI-compatible gateway, streaming, request ids, metrics |
| Stacje | `workstation-agent.js` polluje jobs/messages | brak atomowego claim z lease, słabe odzyskiwanie po crashu | RPC `claim_job`, lease, retry, dead-letter, heartbeat health score |
| Hermes | preset w `context.raw.workflow` | nie jest pełnym workflow engine | `workflow_runs`, `workflow_steps`, artifacts, gates, evaluations |
| CI | deploy Pages, security scan, smoke launchery | brak E2E, RLS, Edge Function, migration tests | pipeline alpha/beta/prod z testami i release artifacts |

### 4.2 Co już jest wartościowe i warto zachować

- Prosta ścieżka wejścia: użytkownik może używać aplikacji bez instalacji.
- Brak własnego publicznego serwera zmniejsza koszt i próg utrzymania.
- Stacje komunikują się outbound przez Supabase, co pasuje do sieci szkolnych.
- `config.json` lokalny i gitignored to dobry wzorzec dla sekretów runtime.
- Edge Functions dla enrollmentu to dobry początek control plane.
- Launchery są już objęte smoke testami Windows/macOS/Linux.
- Dokumentacja alpha jasno mówi, że migracje trzeba stosować ręcznie.

### 4.3 Co jest największym ryzykiem

Największe ryzyko nie leży w samym modelu AI, tylko w spójności systemu:

- kto ma prawo widzieć i modyfikować zadanie,
- która stacja naprawdę przejęła job,
- co się dzieje po crashu stacji w trakcie generowania,
- czy dwa workery nie wykonają tego samego jobu,
- czy wynik da się odtworzyć i zweryfikować,
- czy owner forka potrafi bezpiecznie wdrożyć migracje,
- czy produkcyjny incydent da się zdiagnozować z logów i metryk.

## 5. Kryteria wyjścia z alpha

Alpha może zostać uznana za zakończoną dopiero, gdy projekt przestanie polegać na ręcznej weryfikacji jako głównej formie bezpieczeństwa.

### 5.1 Alpha -> Beta

Warunki minimalne:

- pełne RLS dla `tasks`, `assignments`, `messages`, `agents`, `workstations`, `workstation_models`, `workstation_messages`, `workstation_jobs`, `workstation_enrollment_tokens`,
- testy RLS dla minimum dwóch użytkowników i jednej stacji technicznej,
- atomowe przejmowanie jobów przez stację,
- retry/timeout/dead-letter dla `workstation_jobs`,
- podstawowy audit log dla tworzenia zadania, claim jobu, zakończenia jobu, komend systemowych i usuwania danych,
- Playwright E2E dla logowania, tworzenia zadania, Hermes, stacji i widoku szczegółów,
- Edge Function tests dla create/redeem enrollment,
- dokumentacja deployu z migracjami, rollbackiem i sekretem service-role,
- release package launcherów z checksums.

### 5.2 Beta -> Release Candidate

Warunki minimalne:

- osobne środowisko staging,
- migracje stosowane i walidowane automatycznie w CI albo półautomatycznie przez opisany release runbook,
- monitoring błędów frontend/proxy/stacji,
- metryki kolejki i generowania,
- API/control plane dla operacji krytycznych,
- role i uprawnienia możliwe do audytu,
- UI ma stabilny model stanu, paginację i brak pełnych odświeżeń list przy dużej liczbie rekordów,
- testy obciążeniowe dla 10, 50 i 100 aktywnych stacji,
- retencja logów i usuwanie danych po zadaniu,
- wersjonowanie workflow/presetów.

### 5.3 Release Candidate -> Production

Warunki minimalne:

- brak ręcznych kroków krytycznych bez checklisty i walidacji,
- kompletna polityka backup/restore,
- dokument bezpieczeństwa dla ownera forka,
- dokument obsługi incydentu,
- automatyczne skany sekretów i zależności,
- stabilna wersja API i migracji,
- semver i changelog,
- dashboard operacyjny pokazujący zdrowie stacji, kolejki, Supabase i lokalnych runtime,
- testy regresji uruchamiane przed release.

## 6. Braki P0: bezpieczeństwo i model tenantów

### 6.1 Pełny model organizacji

Obecny model jest blisko team-space. Produkcyjnie trzeba mieć jawny tenant, nawet jeśli pierwszym tenantem jest jedna szkoła lub jeden właściciel forka.

Proponowane tabele:

```sql
organizations (
  id uuid primary key,
  name text not null,
  slug text unique not null,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

organization_members (
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'executor', 'viewer')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
)

classrooms (
  id uuid primary key,
  organization_id uuid references organizations(id) on delete cascade,
  label text not null,
  grid_rows integer,
  grid_cols integer,
  created_at timestamptz not null default now()
)
```

Następnie dodać `organization_id` do:

- `tasks`,
- `assignments`,
- `messages`,
- `agents`,
- `workstations`,
- `workstation_jobs`,
- `workstation_messages`,
- `workstation_enrollment_tokens`,
- przyszłych `workflow_runs`, `workflow_steps`, `task_artifacts`, `audit_events`.

### 6.2 RLS jako produkt, nie dodatek

RLS musi być opisane i testowane jak API.

Minimalne reguły:

| Rola | Zadania | Stacje | Joby | Profile | Ustawienia |
|------|---------|--------|------|---------|------------|
| owner | wszystko w organizacji | wszystko | wszystko | wszystko | wszystko |
| admin | wszystko poza usunięciem organizacji | wszystko | wszystko | wszystko | większość |
| manager | tworzy i przydziela zadania | widzi i używa stacji | tworzy joby | czyta profile | ograniczone |
| executor | widzi tylko swoje przydziały | widzi przypisane stacje | aktualizuje swoje joby | czyta profile | brak |
| viewer | tylko odczyt wybranych zadań | tylko odczyt | tylko odczyt wyników | odczyt | brak |
| workstation | widzi tylko własną stację i własne joby | aktualizuje własny heartbeat | claim/update własnych jobów | brak | brak |

Testy RLS powinny pokrywać:

- użytkownik A nie widzi zadań użytkownika B,
- manager nie może modyfikować organizacji, której nie jest członkiem,
- stacja nie może claimować jobu innej stacji,
- viewer nie może insert/update/delete,
- service-role działa tylko w Edge Functions,
- usunięcie zadania nie zostawia danych widocznych obcym użytkownikom.

### 6.3 Audit log

Bez audit logu nie da się produkcyjnie debugować incydentów.

Tabela:

```sql
audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('user', 'workstation', 'edge_function', 'system')),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
)
```

Logować minimum:

- create/update/delete task,
- create assignment,
- claim/release/fail job,
- create/redeem/revoke enrollment token,
- station pause/resume/update/shutdown,
- zmiana roli użytkownika,
- zmiana profilu agenta,
- import/eksport workflow.

## 7. Braki P0: control plane i krytyczna logika poza UI

Obecna prostota ma sens w alpha, ale produkcyjnie logika krytyczna nie może zależeć od aktywnej zakładki przeglądarki.

### 7.1 Co przenieść do Supabase RPC / Edge Functions / API

Minimum:

- tworzenie zadania z walidacją i idempotency key,
- przydział zadania do workflow/workerów,
- claim jobu przez stację,
- update jobu z walidacją przejść statusu,
- create/redeem/revoke enrollment token,
- zapis eventów task timeline,
- zapis artefaktów i wyników,
- komendy systemowe stacji,
- adminowe zarządzanie rolami.

### 7.2 Dlaczego to jest konieczne

Frontend może:

- wyświetlać,
- zbierać input,
- subskrybować status,
- wysłać intencję.

Frontend nie powinien:

- decydować o prawie przejęcia jobu,
- samodzielnie wykonywać krytycznych przejść statusu,
- znać reguł wszystkich ról,
- być jedynym miejscem orkiestracji managera.

### 7.3 Minimalny wariant bez dużego backendu

Żeby nie zabijać prostoty projektu, pierwszy krok może zostać w Supabase:

- RPC w Postgres dla atomowych operacji,
- Edge Functions dla operacji z service-role,
- frontend dalej statyczny,
- station agent dalej przez Supabase REST.

Własny serwer Node/API można dodać dopiero w beta, jeśli Supabase RPC/Edge Functions okażą się niewystarczające.

## 8. Braki P0: kolejka jobów i stan zadań

### 8.1 Docelowy lifecycle zadania

Obecne statusy `pending`, `analyzing`, `in_progress`, `done`, `failed` są za mało precyzyjne.

Proponowany lifecycle `tasks.status`:

```text
draft
submitted
planning
queued
assigned
running
needs_input
verifying
succeeded
failed
cancelled
expired
```

Proponowany lifecycle `workstation_jobs.status`:

```text
queued
leased
running
succeeded
failed
retrying
cancelled
expired
dead_letter
```

### 8.2 Lease zamiast prostego `status=queued`

W `workstation_jobs` dodać:

```sql
lease_owner text,
lease_expires_at timestamptz,
attempt_count integer not null default 0,
max_attempts integer not null default 3,
priority integer not null default 100,
idempotency_key text,
cancel_requested_at timestamptz,
last_error_code text,
last_error_at timestamptz
```

Atomowy claim przez RPC:

```sql
create or replace function public.claim_workstation_jobs(
  p_workstation_id uuid,
  p_limit integer,
  p_lease_seconds integer default 900
)
returns setof public.workstation_jobs
language sql
security definer
as $$
  update public.workstation_jobs j
  set
    status = 'leased',
    lease_owner = p_workstation_id::text,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = attempt_count + 1,
    updated_at = now()
  where j.id in (
    select id
    from public.workstation_jobs
    where workstation_id = p_workstation_id
      and (
        status = 'queued'
        or (status in ('leased', 'running') and lease_expires_at < now())
      )
      and attempt_count < max_attempts
    order by priority asc, created_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 4))
  )
  returning j.*;
$$;
```

To usuwa klasę błędów: dwa procesy pobierają ten sam rekord i oba wykonują ten sam job.

### 8.3 Task events zamiast zgadywania timeline

Tabela:

```sql
task_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references tasks(id) on delete cascade,
  event_type text not null,
  actor_kind text not null,
  actor_id text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
)
```

UI timeline powinien czytać `task_events`, nie odtwarzać historię z obecnego `status` i kilku wiadomości.

## 9. Braki P0/P1: Hermes Labyrinth jako prawdziwy workflow

Teraz Hermes jest wartościowym presetem: zapisuje role, bramy i instrukcje w kontekście. Do produkcji powinien stać się wersjonowanym workflow.

### 9.1 Proponowany model

```sql
workflow_definitions (
  id uuid primary key,
  organization_id uuid,
  key text not null,
  version integer not null,
  name text not null,
  definition jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, key, version)
)

workflow_runs (
  id uuid primary key,
  organization_id uuid not null,
  task_id uuid not null references tasks(id) on delete cascade,
  workflow_key text not null,
  workflow_version integer not null,
  mode text not null,
  status text not null,
  started_at timestamptz,
  finished_at timestamptz,
  input_snapshot jsonb not null default '{}'::jsonb,
  output_summary text,
  created_at timestamptz not null default now()
)

workflow_steps (
  id uuid primary key,
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  step_key text not null,
  role_key text,
  status text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz
)
```

### 9.2 Hermes fast/standard/deep

Warto utrzymać świeżo dodaną ideę szybkiej ścieżki, ale nazwać ją produkcyjnie:

| Tryb | Kiedy | Kroki | Limit |
|------|-------|-------|-------|
| `fast` | krótkie pytanie, proste obliczenie, mały refactor | execute -> evidence -> verify -> report | krótki prompt, mały model, krótki timeout |
| `standard` | typowe zadanie implementacyjne/analityczne | intake -> route -> execute -> verify -> report | średni kontekst, jeden executor |
| `deep` | research, architektura, duży kod, ryzyko | intake -> map -> route -> execute -> evidence -> verify -> report | pełny Hermes, możliwe role równoległe |

### 9.3 Artefakty jako osobne rekordy

Tabela:

```sql
task_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references tasks(id) on delete cascade,
  workflow_run_id uuid references workflow_runs(id) on delete set null,
  artifact_type text not null,
  title text not null,
  content text,
  content_json jsonb,
  mime_type text,
  created_by text,
  created_at timestamptz not null default now()
)
```

Hermes powinien zapisywać minimum:

- `intake_summary`,
- `risk_map`,
- `role_plan`,
- `execution_output`,
- `evidence`,
- `verification`,
- `final_report`.

## 10. Braki P1: obserwowalność i operacje

### 10.1 Trace ID wszędzie

Każde zadanie powinno mieć `trace_id`. Każdy request proxy, job, wiadomość i event powinien go propagować.

Minimalne pola:

- `trace_id`,
- `request_id`,
- `workflow_run_id`,
- `job_id`,
- `workstation_id`,
- `model_name`,
- `duration_ms`,
- `input_tokens`,
- `output_tokens`,
- `error_code`.

### 10.2 Metryki do dashboardu

W produkcji UI powinno pokazywać panel operacyjny:

- liczba zadań w kolejce,
- średni czas od submit do startu,
- średni czas generowania,
- p95 czasu generowania,
- liczba jobów failed/dead_letter,
- liczba stacji online/busy/offline,
- ostatni heartbeat każdej stacji,
- tokeny/s per model/stacja,
- błędy proxy/llama-server,
- liczba eventów Realtime/polling na minutę.

### 10.3 Logi i retencja

Proponowane minimum:

- `task_events` trzymane 90 dni,
- `audit_events` trzymane 180/365 dni,
- duże `workstation_messages.content` z wynikami przenosić do artefaktów,
- logi stacji lokalnie rotowane po rozmiarze i czasie,
- dane usuniętych zadań anonimizowane albo kasowane zgodnie z polityką organizacji.

## 11. Braki P1: frontend i UX

Obecny vanilla JS jest zgodny z alpha, ale produkcyjnie rosną problemy:

- zbyt dużo stanu globalnego,
- trudne testowanie widoków,
- ryzyko regresji przy każdej zmianie DOM,
- brak typów danych,
- Tailwind CDN bez kontroli builda,
- brak testów dostępności.

### 11.1 Dwie możliwe ścieżki

| Ścieżka | Zalety | Wady | Rekomendacja |
|---------|--------|------|--------------|
| Utrzymać vanilla JS | najmniejsza zmiana, brak builda | rosnący koszt utrzymania | dobre tylko do końca alpha |
| Przejść na Preact/React + Vite | komponenty, testy, bundling, typy | większa złożoność startu | zalecane przed beta |

### 11.2 Minimalny standard UI beta

- Jeden store stanu aplikacji.
- Osobne moduły API dla Supabase, Edge Functions i local proxy.
- Komponenty: task list, task detail, workflow timeline, station grid, agent profiles, settings.
- Paginacja i filtrowanie po stronie DB.
- Brak pełnego rerenderu listy przy każdym evencie.
- Skeleton/loading/error states.
- Dostępność: focus, aria-label, kontrast, obsługa klawiatury.
- E2E snapshoty najważniejszych przepływów.

## 12. Braki P1: API i integracje

Projekty typu Langflow, Flowise, AutoGPT i OpenHands traktują workflow jako coś, co można wywołać spoza UI.

Agent Manager powinien mieć stabilny interfejs:

```text
POST   /api/tasks
GET    /api/tasks/:id
POST   /api/tasks/:id/cancel
POST   /api/tasks/:id/retry
GET    /api/tasks/:id/events
GET    /api/tasks/:id/artifacts
POST   /api/workstations/:id/commands
GET    /api/workstations
GET    /api/workflows
POST   /api/workflows/:key/run
```

W wariancie Supabase-only te endpointy mogą być Edge Functions. W wariancie beta/prod można dodać mały API server.

## 13. Braki P1/P2: profile agentów i modele

Profile agentów powinny być wersjonowane, testowalne i rozdzielone od jednorazowych promptów.

Proponowane tabele:

```sql
agent_profile_versions (
  id uuid primary key,
  organization_id uuid,
  profile_key text not null,
  version integer not null,
  display_name text not null,
  role text not null,
  instructions text not null,
  skills text[] not null default '{}',
  default_model_profile_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, profile_key, version)
)

model_profiles (
  id uuid primary key,
  organization_id uuid,
  name text not null,
  provider text not null,
  model_name text not null,
  max_tokens integer,
  temperature numeric,
  context_tokens integer,
  metadata jsonb not null default '{}'::jsonb
)
```

To pozwala odpowiedzieć na pytania produkcyjne:

- który prompt wygenerował dany wynik,
- która wersja profilu była aktywna,
- jaki model i parametry były użyte,
- czy można odtworzyć wynik po czasie.

## 14. Braki P0/P1: testy

### 14.1 Testy, których obecnie najbardziej brakuje

| Obszar | Test | Cel |
|--------|------|-----|
| RLS | SQL/pgTAP albo Supabase test harness | wykazać izolację użytkowników/stacji |
| Edge Functions | unit + integration | create/redeem/revoke tokenów |
| UI | Playwright | login, task create, Hermes, station grid, delete, settings |
| Workstation | Node integration z mock Supabase REST/proxy | claim, heartbeat, result, failure, command |
| Proxy | Node test | CORS, timeout, invalid JSON, role header, health |
| Migracje | świeża baza + wszystkie migracje | wykryć drift i brakujące policy/index |
| Load | skrypt tworzący wiele tasków/jobów | kolejka i Realtime/polling pod presją |
| Security | secret scanning + dependency scanning | uniknąć wycieku kluczy i znanych CVE |

### 14.2 Minimalna matryca E2E

1. Rejestracja/logowanie.
2. Utworzenie zwykłego zadania.
3. Utworzenie zadania Hermes fast.
4. Utworzenie zadania Hermes deep.
5. Manager przydziela zadanie.
6. Browser executor kończy zadanie fallbackowo.
7. Stacja przyjmuje job i odsyła wynik.
8. Stacja offline -> job zostaje queued.
9. Job timeout -> retry.
10. Job po max attempts -> dead_letter.
11. Użytkownik A nie widzi danych użytkownika B.
12. Viewer nie może edytować.
13. Enrollment token wygasa i nie działa ponownie.
14. Komendy `pause`, `resume`, `status`, `update` wracają jako `system`.

## 15. Braki P1: release, deploy i migracje

### 15.1 Obecny problem

Deploy GitHub Pages publikuje UI, ale migracje Supabase są ręczne. To jest OK dla alpha, ale w produkcji grozi sytuacją:

- UI oczekuje kolumny, której baza nie ma,
- RLS w kodzie jest opisane, ale nie zastosowane,
- Edge Function oczekuje RPC, którego nie ma,
- rollback UI nie cofa schematu.

### 15.2 Minimalny release runbook

Każdy release powinien mieć checklistę:

1. Uruchom testy lokalne: JS syntax, Node checks, PowerShell parser, shell syntax.
2. Zastosuj migracje na staging.
3. Uruchom migration smoke test.
4. Uruchom RLS test suite.
5. Deploy Edge Functions na staging.
6. Uruchom Playwright E2E na staging.
7. Wygeneruj paczki launcherów.
8. Sprawdź checksums.
9. Zastosuj migracje na production.
10. Deploy Edge Functions na production.
11. Deploy Pages.
12. Wykonaj smoke test produkcyjny.
13. Oznacz release tagiem.

### 15.3 Artifact signing/checksums

Dla ZIP-ów launcherów dodać:

- SHA256SUMS,
- release notes,
- wersję aplikacji w pliku `VERSION`,
- link do changeloga,
- opcjonalnie podpisy cosign/minisign w późniejszej fazie.

## 16. Braki P1/P2: bezpieczeństwo runtime i promptów

### 16.1 Local proxy

`proxy.js` już sprawdza origin i nasłuchuje na `127.0.0.1`, ale produkcyjnie warto dodać:

- lokalny token w nagłówku, generowany podczas `--config`,
- limit requestów na minutę,
- maksymalny rozmiar promptu zależny od trybu,
- request id i log JSONL,
- endpoint `/metrics`,
- opcjonalne SSE streaming,
- jasne rozróżnienie błędów: timeout, llama down, invalid request, cancelled.

### 16.2 Prompt injection i narzędzia

Jeżeli agenci dostaną tools/MCP/API, trzeba dodać:

- allowlist narzędzi per rola,
- sandbox komend systemowych,
- human approval dla operacji destrukcyjnych,
- blokadę sekretów w promptach i artefaktach,
- skan wyników pod kątem przypadkowego ujawnienia tokenów,
- politykę: model nie decyduje sam o wykonaniu komendy `update/shutdown/delete` bez autoryzowanej intencji użytkownika.

## 17. Proponowana kolejność prac

### Etap 1: Alpha hardening

Czas: 1-2 tygodnie.

1. Spisać aktualny schemat bazy jako źródło prawdy.
2. Dodać testy składni/migracji/RLS dla obecnych tabel.
3. Dodać `task_events`.
4. Dodać podstawowy `audit_events`.
5. Dodać atomowy `claim_workstation_jobs`.
6. Zmienić `workstation-agent.js`, aby używał RPC claim zamiast zwykłego select queued.
7. Dodać retry/dead-letter.
8. Dodać Playwright smoke dla głównego happy path.

### Etap 2: Beta foundation

Czas: 3-6 tygodni.

1. Wprowadzić `organizations` i `organization_members`.
2. Dodać `organization_id` do wszystkich tabel roboczych.
3. Przepisać RLS pod organizacje i role.
4. Przenieść krytyczne operacje do RPC/Edge Functions.
5. Dodać `workflow_runs` i `workflow_steps` dla Hermes.
6. Dodać `task_artifacts`.
7. Wersjonować profile agentów i modele.
8. Dodać staging i release runbook.

### Etap 3: Product beta

Czas: 6-10 tygodni.

1. Uporządkować frontend w komponenty.
2. Dodać station health dashboard.
3. Dodać workflow timeline z prawdziwych eventów.
4. Dodać retry/cancel/re-run w UI.
5. Dodać import/export workflow/presetów.
6. Dodać artefakty do widoku zadania.
7. Dodać obserwowalność i metryki.

### Etap 4: Production candidate

Czas: 10-14 tygodni.

1. Load test na 100 stacji i 1000 zadań testowych.
2. Backup/restore drill.
3. Security review RLS/Edge Functions/proxy.
4. Dokument incydentów.
5. Signed/checksummed launchers.
6. Semver release.
7. Publiczny changelog.

## 18. Konkretne kryteria akceptacji produkcyjnej

Projekt można nazwać produkcyjnym dopiero, gdy spełnia wszystkie punkty:

- [ ] Nowy użytkownik nie widzi żadnych cudzych danych po rejestracji.
- [ ] Organizacja/klasa/stacja mają jawnego ownera.
- [ ] Wszystkie tabele z danymi użytkownika mają RLS i testy RLS.
- [ ] Job może zostać wykonany tylko raz albo idempotentnie ponowiony.
- [ ] Crash stacji nie blokuje jobu na zawsze.
- [ ] Każdy job ma historię: queued -> leased -> running -> result/failure.
- [ ] Każdy task ma event timeline.
- [ ] Hermes zapisuje kroki i artefakty, nie tylko tekst końcowy.
- [ ] UI ma test E2E dla głównego przepływu.
- [ ] Edge Functions mają test create/redeem/revoke token.
- [ ] Migracje można zastosować na świeżej bazie bez ręcznych poprawek.
- [ ] Release ma runbook i rollback.
- [ ] Launchery mają smoke testy i checksums.
- [ ] Proxy ma timeout, request id, role, origin allowlist i rate limit.
- [ ] Dashboard pokazuje zdrowie kolejki i stacji.
- [ ] Owner forka ma jasną instrukcję: secrets, migrations, Edge Functions, Pages, backup.

## 19. Priorytet absolutny

Jeśli robić tylko pięć rzeczy przed kolejną większą wersją, kolejność powinna być taka:

1. Atomowa kolejka jobów z lease/retry/dead-letter.
2. Pełne testy RLS dla użytkowników i stacji.
3. `task_events` + `audit_events`.
4. Hermes jako `workflow_runs` + `workflow_steps` + artefakty.
5. Playwright E2E + release runbook dla migracji i Edge Functions.

Te pięć zmian najbardziej zmienia projekt z eksperymentu alpha w system, który da się bezpiecznie utrzymywać.