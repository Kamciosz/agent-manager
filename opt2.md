# Optymalizacja wydajności AI i aplikacji

Data: 2026-04-30  
Status: szczegółowy plan po analizie repo oraz porównaniu z projektami OpenHands, AutoGPT, CrewAI, Langflow, Flowise, MetaGPT, Open WebUI, LocalAI, Ollama i LiteLLM.

## 1. Najkrótsza diagnoza

Największe źródła spowolnień w Agent Manager nie są jednym problemem. To suma kilku warstw:

- za duże prompty dla prostych zadań,
- brak pełnego routingu `fast/standard/deep`,
- jeden prosty endpoint `POST /generate` bez streamingu, kolejki, metryk i profili modeli,
- brak pomiaru tokenów, czasu do pierwszego tokenu i tokens/s,
- job queue oparta na zwykłym polling/select, a nie atomowym lease,
- brak cache i idempotencji dla powtarzalnych działań,
- Supabase Realtime/polling bez pełnego budżetu eventów i bez metryk,
- frontend bez bundlingu, typów i testów wydajności,
- stacje robocze nie mają scoringu zdrowia ani model-aware scheduler.

Do poprawy wydajności nie wystarczy "mocniejszy model". Trzeba zmniejszyć liczbę tokenów, lepiej dobierać model do zadania, mierzyć runtime, ograniczyć ruch Supabase, uszczelnić kolejkę i dodać mechanizmy backpressure.

## 2. Czego uczą podobne projekty

| Projekt | Wzorzec wydajnościowy | Wniosek dla Agent Manager |
|---------|-----------------------|---------------------------|
| OpenHands | Oddziela SDK/CLI/GUI/Cloud; ma REST API i evaluation infrastructure. | Oddzielić runtime od UI i dodać benchmark harness dla zadań agentowych. |
| AutoGPT | Workflow/block model, deployment controls, benchmark `agbenchmark`, monitoring/analytics. | Mierzyć skuteczność i koszt każdego workflow, nie tylko czas odpowiedzi modelu. |
| CrewAI | Rozróżnia `Crews` i `Flows`, czyli autonomię i kontrolowane wykonanie. | Proste zadania wykonywać jako krótki flow, a pełny Hermes tylko dla złożonych. |
| Langflow/Flowise | Wizualne workflow, API/MCP, server + UI, obserwowalność integracji. | Każdy workflow powinien być wywoływalny, mierzalny i debuggowalny jako oddzielny run. |
| MetaGPT | SOP i role generują artefakty krok po kroku. | Długie zadania dzielić na artefakty i krótkie kroki zamiast jednego ogromnego promptu. |
| Open WebUI | Multi-model, RAG, OpenTelemetry, Redis-backed multi-node WebSocket, RBAC. | Dodać telemetry, model routing, cache stanu i przygotować Realtime do skali. |
| LocalAI | OpenAI-compatible API, wiele backendów, distributed mode, model gallery, load-on-demand. | Proxy/stacje powinny raportować capabilities i ładować modele według potrzeb. |
| Ollama | Prosty lokalny model server z REST API i bibliotekami. | Standaryzować API runtime, żeby łatwo podmienić llama.cpp/Ollama/LocalAI. |
| LiteLLM | Gateway: routing, fallback, load balancing, virtual keys, cost/spend, guardrails. | `proxy.js` powinien docelowo stać się małym lokalnym AI gateway, nie tylko forwarderem. |

## 3. Najpierw pomiary, potem tuning

Bez metryk łatwo pomylić realną optymalizację z wrażeniem szybkości.

### 3.1 Metryki AI

Dodać zapisywanie dla każdego requestu:

| Metryka | Co mówi | Gdzie zapisywać |
|---------|---------|-----------------|
| `prompt_chars` | rozmiar wejścia bez tokenizera | `ai_request_logs` albo log JSONL proxy |
| `estimated_input_tokens` | przybliżony koszt promptu | proxy + task event |
| `output_tokens` | koszt odpowiedzi | proxy, jeśli backend poda token usage; inaczej estymacja |
| `time_to_first_token_ms` | czy model szybko zaczyna odpowiadać | wymaga streamingu/SSE |
| `generation_duration_ms` | całkowity czas generowania | już częściowo jest `durationMs` |
| `tokens_per_second` | realna szybkość modelu | proxy/stacja |
| `model_name` | który model odpowiadał | proxy/stacja/job |
| `role` | manager/executor/verifier/shared | header `X-Agent-Role` już dodany |
| `workflow_mode` | fast/standard/deep | z `context.raw.workflow.mode` |
| `error_code` | timeout, invalid, llama_down, cancelled | proxy/job |

### 3.2 Metryki kolejki

| Metryka | Definicja |
|---------|-----------|
| `queue_latency_ms` | od utworzenia jobu do claim |
| `lease_latency_ms` | od claim do start running |
| `run_duration_ms` | od running do succeeded/failed |
| `attempt_count` | ile prób wykonania |
| `dead_letter_count` | ile jobów nie do uratowania |
| `station_available_slots` | wolne sloty per stacja |
| `station_heartbeat_age_ms` | ile czasu od ostatniego heartbeat |
| `jobs_per_hour` | przepustowość systemu |

### 3.3 Metryki Supabase i frontendu

| Metryka | Po co |
|---------|-------|
| liczba zapytań `.select()` na minutę | wykrywa za agresywny polling |
| liczba eventów Realtime na minutę | kontrola limitów i burz eventów |
| p95 czasu listy zadań | UX dashboardu |
| liczba DOM nodes w task list | czy trzeba virtualizować listę |
| czas initial load UI | czy Tailwind CDN/moduły są problemem |
| liczba pełnych rerenderów | czy UI robi za dużo pracy |

## 4. Routing zadań: największy szybki zysk

Obecny projekt zrobił krok w dobrą stronę: krótkie zadania Hermes mogą ominąć część bram. Trzeba tę ideę rozwinąć w jawny router.

### 4.1 Klasy zadań

| Klasa | Przykłady | Workflow | Model | Timeout | Max output |
|-------|-----------|----------|-------|---------|------------|
| `instant` | `2 + 2`, krótkie pytanie, prosta transformacja tekstu | bez Hermes | mały/szybki | 15-30 s | 100-300 tokenów |
| `fast` | mała poprawka, krótka analiza, odpowiedź operacyjna | Hermes fast | mały/średni | 60-120 s | 400-800 tokenów |
| `standard` | typowe zadanie kodowe/dokumentacyjne | Hermes standard | średni | 5-10 min | 1200-2500 tokenów |
| `deep` | research, architektura, duże repo, krytyczna weryfikacja | Hermes deep | duży/lepszy | 15-30 min | 3000-6000 tokenów |
| `batch` | wiele podobnych zadań | workflow bez interakcji | model najtańszy/stabilny | wg paczki | per item |

### 4.2 Heurystyki routingu

Startowo bez ML, zwykłe reguły:

- liczba słów,
- liczba plików/ścieżek w opisie,
- słowa kluczowe: `analiza`, `research`, `architektura`, `migracja`, `RLS`, `bezpieczeństwo`, `testy`, `benchmark`,
- czy wybrano Hermes,
- czy zadanie wymaga stacji,
- czy zadanie zawiera kod,
- czy użytkownik zaznaczył tryb dokładny.

Przykład scoringu:

```js
function classifyTask({ title, description, template, hermesEnabled }) {
  const text = `${title || ''}\n${description || ''}`.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean).length
  let score = 0
  if (words > 80) score += 1
  if (words > 250) score += 2
  if (/analiza|research|architektura|rls|bezpiecze|migrac|benchmark/.test(text)) score += 2
  if (/napisz test|testy|e2e|playwright|supabase/.test(text)) score += 1
  if (template === 'hermes-labyrinth' || hermesEnabled) score += 1
  if (words < 25 && !score) return 'instant'
  if (score <= 1) return 'fast'
  if (score <= 3) return 'standard'
  return 'deep'
}
```

Docelowo router powinien zapisywać decyzję:

```json
{
  "route": "standard",
  "reason": ["task_has_security_keyword", "words_gt_80"],
  "modelProfile": "local-code-7b",
  "workflow": "hermes-labyrinth@2",
  "maxOutputTokens": 1800,
  "timeoutMs": 600000
}
```

## 5. Budżety promptów

Duże projekty agentowe nie wysyłają zawsze pełnego kontekstu. Agent Manager powinien mieć budżet per rola i tryb.

### 5.1 Budżet per rola

| Rola | Cel | Input budget | Output budget | Temperatura |
|------|-----|--------------|---------------|-------------|
| manager | routing, plan, decyzje | 800-1800 tokenów | 300-900 | 0.2-0.4 |
| executor | wykonanie | 1200-6000 | 800-3000 | 0.2-0.5 |
| verifier | sprawdzenie i ryzyka | 1000-3000 | 400-1200 | 0.1-0.3 |
| scribe | raport końcowy | 1000-2500 | 600-1500 | 0.3-0.5 |
| station reply | odpowiedź na wiadomość | 300-1200 | 150-500 | 0.2-0.4 |

### 5.2 Zasady skracania promptu

1. Nie powtarzać pól technicznych w promptach stacji, jeśli są już w JSON.
2. Dla `instant` nie dodawać Hermes roles ani gates.
3. Dla `fast` podawać tylko bieżące bramy: wykonanie, dowody, weryfikacja, raport.
4. Dla `standard` skracać role do jednej linijki.
5. Dla `deep` podawać pełne role, ale dzielić na kroki.
6. Zamiast całego `context.raw`, podawać tylko potrzebne pola.
7. Zachować podsumowanie poprzednich kroków jako artifact summary, nie cały transcript.
8. Odcinać powtarzalne preambuły typu „jesteś agentem...” do krótszej wersji.

### 5.3 Kontrakty odpowiedzi

Dla szybkości i stabilności odpowiedzi powinny mieć krótkie formaty.

`instant`:

```text
Odpowiedz bezpośrednio. Bez nagłówków. Maksymalnie 3 zdania.
```

`fast`:

```text
Sekcje:
1. Wynik
2. Sprawdzenie
3. Następny krok, jeśli potrzebny
```

`standard`:

```text
Sekcje:
1. Plan
2. Wykonanie
3. Dowody
4. Ryzyka
5. Raport końcowy
```

`deep`:

```text
Zwróć JSON-compatible markdown:
- mapa
- decyzje
- wykonanie
- artefakty
- testy/weryfikacja
- blokery
- raport
```

## 6. Modele i profile runtime

### 6.1 Zasada: jeden model nie powinien robić wszystkiego

Agent Manager może działać na jednym GGUF, ale wydajnościowo warto mieć profile:

| Profil | Zadanie | Przykładowy rozmiar | Priorytet |
|--------|---------|---------------------|-----------|
| `tiny-router` | klasyfikacja, routing, krótkie decyzje | 1.5B-3B | szybkość |
| `fast-general` | proste odpowiedzi i manager | 3B-7B | niski latency |
| `code-executor` | kod, refactor, analiza techniczna | 7B-14B | jakość/kod |
| `deep-reasoner` | research, architektura, weryfikacja | 14B-32B | jakość |
| `verifier` | krótkie sprawdzenie ryzyk | 3B-7B lub mocny model | deterministyczność |

Nie trzeba mieć wszystkich od razu. Ważne, żeby system umiał zapisać `model_profile` i później wybrać model świadomie.

### 6.2 Kwantyzacja

Ogólna matryca wyboru:

| Kwant | Kiedy | Plus | Minus |
|-------|-------|------|-------|
| Q4_K_M / Q4 | słabszy sprzęt, szybkie testy | mało RAM | gorsza jakość przy trudnych zadaniach |
| Q5_K_M / Q5 | balans | lepsza jakość niż Q4 | więcej RAM |
| Q6_K / Q6 | zadania kodowe i deep | dobra jakość | wolniej/więcej RAM |
| Q8_0 | wysoka jakość lokalnie | stabilność jakości | duży RAM/VRAM |

Rekomendacja:

- `fast` i `instant`: Q4/Q5 wystarczy.
- `standard`: Q5/Q6.
- `deep`: Q6/Q8, jeśli sprzęt pozwala.
- Verifier może być mniejszy, jeśli jego zadaniem jest kontrola checklisty, nie tworzenie rozwiązania.

### 6.3 Kontekst

Obecny launcher wspiera `native`, `64k`, `128k`, `256k` i KV cache. Produkcyjnie nie używać długiego kontekstu domyślnie dla wszystkiego.

| Tryb | Kontekst | Dlaczego |
|------|----------|----------|
| instant | 2k-4k | zadanie krótkie, mniejszy prefill |
| fast | 4k-8k | niski latency |
| standard | 8k-32k | typowe zadania z kontekstem |
| deep | 32k-64k | research/duże artefakty |
| exceptional | 128k+ | tylko opt-in, po ostrzeżeniu |

W llama.cpp długi kontekst zwiększa koszt prefill i KV memory. Nawet jeśli model obsługuje 128k/256k, użycie tego dla prostego pytania będzie wolniejsze.

### 6.4 KV cache

Obecny domyślny `q8_0` jest dobrym kompromisem. Plan:

1. Domyślnie `q8_0` dla 64k+.
2. Dla krótkiego kontekstu testować `f16` vs `q8_0`, bo `f16` może być szybsze przy wystarczającej pamięci.
3. `q4_0` tylko jako tryb low-memory.
4. RotorQuant/Planar/Iso/Turbo tylko po wykryciu obsługi przez binary i benchmarku jakości.
5. Zapisywać efektywny typ K/V w metadanych stacji.

## 7. Speculative decoding

Speculative decoding może przyspieszyć generowanie, ale tylko przy dobrze dobranym draft modelu.

### 7.1 Kiedy warto

- główny model jest duży i wolny,
- draft model jest mały i bardzo szybki,
- zadania mają długie odpowiedzi,
- oba modele mają kompatybilny tokenizer/rodzinę,
- sprzęt ma zapas pamięci na dwa modele.

### 7.2 Kiedy nie warto

- proste krótkie odpowiedzi,
- CPU bez zapasu RAM,
- draft model generuje dużo odrzuconych tokenów,
- `llama-server` nie obsługuje stabilnych flag SD,
- główny model jest już mały.

### 7.3 Plan benchmarku SD

Dla każdej stacji wykonać 10 powtarzalnych promptów:

| Zestaw | Opis |
|--------|------|
| A | 5 krótkich promptów `instant/fast` |
| B | 3 standardowe zadania kodowo-dokumentacyjne |
| C | 2 długie zadania Hermes deep |

Mierzyć:

- time to first token,
- total duration,
- tokens/s,
- RAM/VRAM,
- błąd/timeout,
- subiektywną jakość według verifier checklist.

Włączyć SD tylko, gdy:

- p50 total duration spada co najmniej 20%,
- p95 nie pogarsza się więcej niż 10%,
- jakość nie spada w verifier checklist,
- liczba błędów nie rośnie.

## 8. Proxy jako lokalny AI gateway

`local-ai-proxy/proxy.js` jest teraz prosty i dobry na alpha. Największy wzrost wydajności i debugowalności da rozbudowa go w mały gateway.

### 8.1 Endpointy docelowe

Zachować obecne:

```text
GET  /health
POST /generate
```

Dodać:

```text
GET  /metrics
GET  /models
POST /v1/chat/completions
POST /v1/responses
POST /generate/stream
POST /cancel/:requestId
```

OpenAI-compatible endpointy ułatwią integrację z LiteLLM, Open WebUI, Ollama-style klientami i testami.

### 8.2 Streaming

Obecnie proxy czeka na całą odpowiedź. Streaming daje:

- szybsze wrażenie odpowiedzi,
- time-to-first-token jako metrykę,
- możliwość cancel,
- możliwość pokazywania progresu w UI.

Plan:

1. Dodać `stream: true` do llama.cpp request.
2. Parsować token chunks.
3. Wystawiać SSE do przeglądarki/stacji.
4. Zapisywać partial output co kilka sekund dla jobów długich.
5. Dodać cancel przez `AbortController` i mapę requestów.

### 8.3 Request queue w proxy

Jeśli UI i workstation agent wyślą kilka requestów naraz, proxy powinno kontrolować kolejkę lokalną.

Prosty model:

```js
const queue = []
const running = new Map()
const maxConcurrent = cfg.parallelSlots || 1
```

Priorytety:

1. cancel/status/health,
2. krótkie manager routing,
3. verifier,
4. executor standard,
5. deep jobs.

### 8.4 Cache

Nie cache'ować losowych generacji jako prawdy, ale cache'ować:

- health llama-server przez 1-2 s,
- model capabilities,
- token estimation,
- routing decision dla tego samego task id,
- static prompt templates,
- summary poprzednich kroków workflow.

Można dodać idempotency key dla requestów:

```json
{
  "idempotencyKey": "task:<taskId>:workflow:<runId>:step:<stepKey>:attempt:<n>"
}
```

Jeśli request padnie po stronie UI, ale proxy/stacja ma wynik, można odzyskać odpowiedź bez ponownej generacji.

## 9. Workstation scheduler

### 9.1 Problem obecny

`workstation-agent.js` pobiera joby cyklicznie i patrzy na `parallelSlots`, ale produkcyjnie trzeba rozwiązać:

- atomowy claim,
- wygasanie lease,
- retry,
- deduplikację,
- priorytet,
- affinity do modelu,
- health score stacji,
- backpressure.

### 9.2 Model-aware scheduling

Każda stacja raportuje:

```json
{
  "models": ["Qwen3.6-27B-UD-Q6_K_XL.gguf"],
  "backend": "cuda|metal|vulkan|cpu",
  "parallelSlots": 1,
  "availableSlots": 1,
  "contextSizeTokens": 65536,
  "effectiveKvCacheQuantization": "q8_0",
  "tokensPerSecondP50": 8.4,
  "tokensPerSecondP95": 5.1,
  "failureRate24h": 0.02,
  "heartbeatAgeMs": 5000
}
```

Scheduler wybiera stację według:

- czy ma wymagany model,
- czy ma wolne sloty,
- czy jest w harmonogramie,
- czy heartbeat jest świeży,
- czy failure rate jest niski,
- czy zadanie jest krótkie/długie,
- czy użytkownik wskazał konkretną stację.

### 9.3 Backpressure

Jeśli żadna stacja nie ma wolnego slotu:

- nie tworzyć nieskończenie wielu `running`,
- zostawić job jako `queued`,
- pokazać w UI przewidywany czas,
- dla prostych zadań użyć browser executor/local operator fallback,
- dla deep zadań poczekać.

### 9.4 Partial progress

Długie joby powinny wysyłać progres:

- `claimed`,
- `model_starting`,
- `prefill_started`,
- `first_token`,
- `tokens_generated`,
- `artifact_saved`,
- `verifying`,
- `done`.

Nawet jeśli llama.cpp nie daje wszystkich stanów, proxy może wysłać minimum:

- request accepted,
- llama request sent,
- first bytes/token,
- completed/failed.

## 10. Supabase: wydajność DB i Realtime

### 10.1 Query patterns

Zasady:

1. Nie robić `select('*')` dla list, jeśli potrzeba tylko pól listy.
2. Paginować taski.
3. Dla timeline pobierać `task_events`, nie wszystkie messages.
4. Dla station grid pobierać tylko aktualny snapshot stacji.
5. Dla wiadomości pobierać po `task_id`, `created_at`, limit.
6. Dla polling używać `created_at > lastSeen` albo `updated_at > lastSeen`.

Przykład listy:

```js
supabase
  .from('tasks')
  .select('id,title,status,priority,created_at,updated_at,requested_workstation_id')
  .order('created_at', { ascending: false })
  .range(offset, offset + pageSize - 1)
```

### 10.2 Indeksy

Warto mieć indeksy pod realne zapytania:

```sql
create index if not exists idx_tasks_user_status_created
  on public.tasks(user_id, status, created_at desc);

create index if not exists idx_tasks_org_status_created
  on public.tasks(organization_id, status, created_at desc);

create index if not exists idx_messages_task_created
  on public.messages(task_id, created_at desc);

create index if not exists idx_assignments_agent_status
  on public.assignments(agent_id, status, created_at desc);

create index if not exists idx_workstation_jobs_claim
  on public.workstation_jobs(workstation_id, status, priority, created_at)
  where status in ('queued', 'leased', 'running');

create index if not exists idx_workstation_jobs_lease_expired
  on public.workstation_jobs(status, lease_expires_at)
  where status in ('leased', 'running');

create index if not exists idx_workstations_owner_status
  on public.workstations(owner_user_id, status, last_seen_at desc);

create index if not exists idx_task_events_task_created
  on public.task_events(task_id, created_at asc);
```

Nie dodawać indeksów ślepo. Po wdrożeniu sprawdzić Supabase Performance Advisor i query plan.

### 10.3 Realtime vs polling

Realtime używać dla:

- nowych task eventów aktualnie otwartego zadania,
- zmian statusu zadań aktualnego użytkownika,
- heartbeat/station grid z ograniczonym filtrem,
- krytycznych eventów UI.

Polling używać dla:

- manager/executor background checks,
- station agent jobs/messages,
- widoków listy, gdy karta jest w tle,
- fallback po błędzie WebSocket.

Reguły:

- widok aktywny: Realtime + krótki debounce,
- karta w tle: polling 15-30 s,
- stacja: polling/RPC co 3-8 s z jitter,
- błędy: exponential backoff,
- lista tasków: odświeżać tylko zmienione rekordy.

### 10.4 Redukcja payloadów

Realtime payload potrafi być drogi, jeśli każdy event niesie duże JSON-y.

- Nie wkładać dużych wyników modelu w `tasks.context`.
- Wyniki zapisywać jako `task_artifacts` lub `workstation_messages` z limitem.
- W listach pobierać tylko `result_summary`, nie pełny `result_payload`.
- Dla JSONB `payload` trzymać tylko potrzebne dane runtime, resztę jako artifact.

## 11. Frontend

### 11.1 Szybkie usprawnienia bez przebudowy

Można zrobić jeszcze w vanilla JS:

- centralny cache zadań po `id`,
- render tylko zmienionego wiersza/kafelka,
- debounce dla eventów Realtime,
- pagination zamiast pełnej listy,
- `documentFragment` przy dużych listach,
- lazy load widoków settings/stations/monitor,
- nie odpalać ciężkich subskrypcji dla ukrytych widoków,
- `AbortController` dla porzuconych requestów,
- localStorage tylko dla ustawień UI, nie jako źródło prawdy.

### 11.2 Docelowy frontend beta

Przejście na Vite + Preact/React da:

- bundling i minifikację,
- kontrolę Tailwind zamiast CDN,
- komponenty,
- testy Vitest/RTL,
- typy JSDoc albo TypeScript,
- lepszą kontrolę rerenderów,
- code splitting.

Jeśli zachować mały footprint, Preact jest dobrym kompromisem.

### 11.3 UI performance budżety

| Widok | Budżet |
|-------|--------|
| initial dashboard load | < 2 s na typowym laptopie |
| task list first render | < 500 ms dla 100 tasków |
| task detail load | < 700 ms bez dużych artefaktów |
| station grid update | < 200 ms po evencie |
| modal submit | natychmiastowy, bez zapytań blokujących |

## 12. Edge Functions

Edge Functions już obsługują enrollment. Wydajnościowo i produkcyjnie dodać:

- idempotency key dla create token,
- rate limit per user,
- krótsze odpowiedzi błędów dla klienta, pełne logi tylko serwerowo,
- audit event przy create/redeem/revoke,
- endpoint revoke token,
- endpoint rotate station session,
- testy integracyjne z mockiem Supabase albo lokalnym Supabase.

Token redemption powinien być szybki i rzadki, więc największy problem to nie latency, tylko odporność i bezpieczeństwo.

## 13. Cache i pamięć długoterminowa

### 13.1 Co cache'ować

- Profile agentów i workflow definitions.
- Lista modeli stacji.
- Station health snapshot.
- Wyniki routingu taska.
- Streszczenia artefaktów.
- Ostatnie odpowiedzi managera dla powtarzalnych pytań operacyjnych.

### 13.2 Czego nie cache'ować ślepo

- Wyników zadań użytkownika bez idempotency key.
- Odpowiedzi zawierających sekrety lub dane prywatne.
- Błędów modelu jako trwałych odpowiedzi.
- Długich promptów z pełnym kontekstem.

### 13.3 Pamięć workflow

Dla deep zadań zamiast trzymać cały transcript:

1. Po każdym kroku tworzyć artifact.
2. Tworzyć krótkie summary artifactu.
3. Następny krok dostaje summary + link/id artifactu.
4. Pełny artifact ładować tylko, gdy verifier tego potrzebuje.

To redukuje prefill i obniża ryzyko, że model zgubi cel w zbyt długim kontekście.

## 14. Benchmark plan

### 14.1 Zestaw testowy

Utworzyć `benchmarks/`:

```text
benchmarks/
  prompts/
    instant.jsonl
    fast.jsonl
    standard.jsonl
    deep.jsonl
  expected/
    verifier-checklists.json
  run-local-proxy.js
  run-station-queue.js
  report-template.md
```

Każdy prompt JSONL:

```json
{"id":"instant-001","class":"instant","prompt":"2 + 2","expectedContains":"4"}
```

### 14.2 Scenariusze benchmarku

| Scenariusz | Cel |
|------------|-----|
| proxy health x100 | koszt `/health` i stabilność |
| instant x50 | latency prostych zadań |
| fast Hermes x20 | koszt szybkiej ścieżki |
| standard x10 | typowa praca |
| deep x3 | długi kontekst i timeout |
| queue 1 station x20 | claim/lease/retry |
| queue 5 stations x100 | rozdział obciążenia |
| station crash | lease expiry i retry |
| realtime storm | dużo statusów bez zacięcia UI |

### 14.3 Raport benchmarku

Każdy benchmark powinien generować tabelę:

| id | class | model | context | kv | sd | p50 ms | p95 ms | tok/s | fail % | uwagi |
|----|-------|-------|---------|----|----|--------|--------|-------|--------|-------|

Wyniki commitować tylko jako przykładowe albo trzymać w artifacts CI, żeby nie zaśmiecać repo.

## 15. Konkretne usprawnienia w obecnym kodzie

### 15.1 `ui/labyrinth.js`

Kierunek:

- rozbudować fast route do `instant/fast/standard/deep`,
- zwracać `routing` w context,
- ograniczać prompt block zależnie od trybu,
- dodać unit testy dla klasyfikacji.

### 15.2 `ui/ai-client.js`

Kierunek:

- dodać `requestId`,
- dodać `workflowMode`,
- dodać timeout/cancel z `AbortController`,
- obsłużyć streaming,
- raportować duration/error do task event.

### 15.3 `local-ai-proxy/proxy.js`

Kierunek:

- `/metrics`,
- streaming SSE,
- local queue,
- request id,
- role/model profile,
- rate limit,
- token estimation,
- OpenAI-compatible `/v1/chat/completions`,
- JSONL logs z rotacją.

### 15.4 `local-ai-proxy/workstation-agent.js`

Kierunek:

- użyć RPC claim z lease,
- wysyłać progress events,
- rozróżniać failed/retrying/dead_letter,
- dynamiczny polling z jitter,
- model-aware accept/reject,
- raportować p50/p95 tokens/s z ostatnich jobów.

### 15.5 Supabase migrations

Kierunek:

- indeksy pod query patterns,
- `task_events`,
- `audit_events`,
- `workflow_runs`,
- `workflow_steps`,
- `task_artifacts`,
- lease fields w `workstation_jobs`,
- RPC claim/release/complete/fail.

## 16. Plan prac według wpływu

### 16.1 Największy efekt w 1-2 dni

1. Dodać metryki `durationMs`, `role`, `workflowMode`, `model` do każdego job result.
2. Dodać routing `instant/fast/standard/deep`.
3. Ograniczyć prompt stacji dla prostych zadań.
4. Dodać paginację task list.
5. Dodać polling z jitter dla station agent.
6. Dodać indeksy pod `tasks(user_id,status,created_at)` i `messages(task_id,created_at)`.

### 16.2 Największy efekt w 1 tydzień

1. Atomowy claim jobów.
2. Lease expiry + retry.
3. `/metrics` w proxy.
4. JSONL logs proxy i station agent.
5. Benchmark harness dla 4 klas zadań.
6. Station health score.

### 16.3 Największy efekt w 2-4 tygodnie

1. Streaming SSE.
2. Workflow artifacts i summaries.
3. Model profiles.
4. OpenAI-compatible local gateway.
5. Playwright performance smoke.
6. Supabase load test z wieloma stacjami.

## 17. Proponowane wartości domyślne

Na start:

```json
{
  "routing": {
    "instantMaxWords": 25,
    "fastMaxWords": 100,
    "standardMaxWords": 350
  },
  "generation": {
    "instant": { "maxTokens": 180, "temperature": 0.2, "timeoutMs": 30000 },
    "fast": { "maxTokens": 700, "temperature": 0.3, "timeoutMs": 120000 },
    "standard": { "maxTokens": 1800, "temperature": 0.35, "timeoutMs": 600000 },
    "deep": { "maxTokens": 4000, "temperature": 0.25, "timeoutMs": 1800000 }
  },
  "station": {
    "pollMs": 8000,
    "pollJitterMs": 2000,
    "heartbeatMs": 15000,
    "leaseSeconds": 900,
    "maxAttempts": 3
  },
  "context": {
    "instantTokens": 4096,
    "fastTokens": 8192,
    "standardTokens": 32768,
    "deepTokens": 65536
  }
}
```

## 18. Kryteria sukcesu wydajnościowego

Pierwsze realne cele:

- `instant`: p95 poniżej 10 s lokalnie na sensownym małym modelu albo natychmiast w trybie fallback bez LLM.
- `fast`: p95 poniżej 60 s.
- `standard`: p95 poniżej 8 min.
- `deep`: brak timeoutów poniżej ustalonego limitu 30 min.
- queue claim: poniżej 2x polling interval.
- station heartbeat age: zielony < 30 s, żółty 30-90 s, czerwony > 90 s.
- UI list 100 tasków: render poniżej 500 ms.
- Realtime: brak globalnych subskrypcji bez filtra użytkownika/organizacji.
- Dead-letter: każdy nieudany job ma widoczny powód i możliwość retry.

## 19. Priorytet absolutny

Jeśli robić tylko pięć rzeczy dla wydajności, kolejność powinna być taka:

1. Routing `instant/fast/standard/deep` z budżetami promptów i max tokenów.
2. Atomowy scheduler jobów z lease/retry/dead-letter.
3. Metryki proxy/stacji: duration, tok/s, model, workflow mode, errors.
4. Streaming/cancel w proxy dla długich odpowiedzi.
5. Paginacja/filtrowane zapytania Supabase i redukcja payloadów Realtime.

To da największy realny wzrost szybkości oraz najwięcej informacji do dalszego tuningu.