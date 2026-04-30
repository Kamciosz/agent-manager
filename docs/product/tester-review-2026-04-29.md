# Review testera — Agent Manager fork

Data: 2026-04-29
Rola: tester produktu + QA techniczny

## Zakres sprawdzenia

Przejrzano UI, runtime lokalny, stacje robocze, launchery, dokumentację, migracje Supabase oraz aktualne wzorce z projektów Dify, Flowise, LangSmith, Open WebUI i CrewAI.

Walidacja wykonana w tej rundzie: statyczny review kodu, `node --check`, `bash -n`, `git diff --check` i diagnostyka VS Code. Próba otwarcia strony w narzędziu przeglądarkowym uruchomiła kartę, ale agentowy backend snapshotu zamknął kontekst strony, więc pełny click-through UI zostaje w manualnej checklistcie.

## Funkcje i oczekiwane działanie

| Funkcja | Oczekiwanie testera | Faktyczne działanie | Ocena |
|---|---|---|---|
| Logowanie Supabase | Użytkownik widzi panel dopiero po sesji, a błąd logowania jest czytelny | Auth jest w `ui/app.js`, ekran aplikacji ukryty bez sesji, błędy trafiają do formularza | Dobre |
| Polecenia | Dodanie polecenia ma być proste: tytuł, opis, repo, kontekst, priorytet, stacja/model | Formularz zapisuje realne pola `tasks`: `git_repo`, `user_id`, `context`, `requested_workstation_id`, `requested_model_name` | Dobre |
| Lista poleceń | Przy rosnącej liczbie zadań operator musi filtrować jak w widoku runs/traces | Dodano filtry po tekście, statusie i priorytecie dla listy i kafelków | Ulepszone w tej rundzie |
| Manager AI | Po nowym zadaniu powinien przejąć `pending`, uniknąć duplikatów i wybrać wykonawcę | `claimPendingTask()` atomowo zmienia status; wybiera stację albo fallback executor | Dobre |
| Executor przeglądarkowy | Gdy nie ma stacji, system nie powinien stać | Fallback executor działa przez `assignments` i kończy zadanie raportem | Miłe zaskoczenie |
| Stacje robocze | Komputer szkolny ma rejestrować model, status, sloty i przyjmować joby bez hasła operatora | Token enrollment + ograniczona sesja stacji; agent raportuje metadata i pobiera joby | Dobre |
| Operator MacBook | Komputer nauczyciela nie może wyglądać jak stanowisko ucznia | `stationMode=operator` pomija `workstation-agent`, panel filtruje operatora z jobów i planu sali | Dobre |
| Plan sali | Sala 226 może mieć 4 x 6 pól, puste pola i podpisy stanowisk | Siatka trzyma layout, drag/drop działa, dodano usuwanie siatki bez kasowania stacji | Ulepszone w tej rundzie |
| Monitor | Operator powinien widzieć aktywne zadania, stacje, live log i móc reagować | Monitor pokazuje zadania/stacje/log, a komendy stacji są też w monitorze | Dobre |
| Advanced runtime | Wszystko, co jest w config/runtime, powinno być widoczne w przeglądarce | Widok pokazuje sloty, kontekst, KV, SD, harmonogram, porty, timeout, draft model | Dobre |
| Konfigurator stacji | Przeciętny operator ma dostać instrukcję i podgląd configu bez terminalowej wiedzy | Dashboard generuje instrukcję i podgląd `config.json`; zapis nadal robi lokalny launcher | Dobre, ale jeszcze nie automatyczne |
| Harmonogram | Runtime ma ładować model tylko w oknie pracy i lekko czekać poza oknem | Launcher obsługuje `wait/exit`, `finish-current/stop-now`, dump; UI pokazuje pola | Dobre |
| RotorQuant/KV | Zaawansowana kompresja ma być opcjonalna i bezpieczna | Obsługa par K/V `iso3/iso3`, `planar3/f16`, fallback do `q8_0/q8_0` | Miłe zaskoczenie |
| Aktualizacja | Stacje powinny same aktualizować repo bez ryzyka resetowania lokalnych zmian | `git pull --ff-only`, komenda `update`, updater ZIP zachowuje config/model/logi | Dobre |

## Braki i ryzyka przed beta

| Priorytet | Brak | Dlaczego ważne | Proponowana poprawka |
|---|---|---|---|
| P0 | Run trace pojedynczego zadania | Wdrożone | Task Detail pokazuje joby stacji, wiadomości AI i wiadomości runtime na jednej osi |
| P0 | Anulowanie i ponawianie | Wdrożone | Dodano `cancelled`, `Anuluj`, `Ponów` i `Ponów auto` z ponownym doborem stacji |
| P1 | Edycja polecenia przed wykonaniem | Wdrożone | Oczekujące, anulowane i błędne polecenia można poprawić w tym samym wizardzie bez tworzenia duplikatu |
| P1 | Presety konfiguracji stacji | Wdrożone | `Operator Mac`, `Sala CPU`, `Sala GPU`, `Długi kontekst`, `RotorQuant` |
| P1 | Walidacja wygenerowanego configu w UI | Wdrożone | Panel sprawdza porty, harmonogram, SD bez draft modelu, 256k i konflikty pamięci |
| P1 | Aktualność dokumentacji API | Ulepszone | Dodano opis `task_feedback`; pełny opis wszystkich tabel stacji pozostaje do dalszego porządkowania |
| P2 | Oceny jakości wyników | Wdrożone | Task Detail zapisuje `Dobry/Zły` i notatkę do `task_feedback`; dataset jest w `tests/data/regression-prompts.json` |
| P2 | Widok zasobów runtime | Wdrożone | Heartbeat raportuje RAM/load/RSS, a dashboard pokazuje zasoby i kolejkę offline |

## Co miło zaskoczyło

- Fallback executor oznacza, że system działa nawet bez stacji i bez lokalnego modelu.
- Enrollment token rozwiązuje problem haseł operatora na komputerach uczniów.
- Operator/classroom jest teraz osobnym pojęciem, a nie efektem ubocznym `accepts_jobs`.
- RotorQuant jest obsłużony defensywnie, bez zakładania konkretnej binarki.
- Launchery są dużo dojrzalsze niż typowy prototyp: `--doctor`, auto-update, harmonogram, ZIP updater, fallbacki llama.cpp.

## Inspiracje z innych projektów

| Projekt | Co robi dobrze | Co warto przenieść do Agent Manager |
|---|---|---|
| LangSmith | Trace, evals, prompt testing, deployment workflow | `Run trace` i oceny wyników jako pierwszorzędny widok |
| Flowise | Visual builder, tracing/analytics, human-in-the-loop, workspaces | Presety przepływów i ręczne zatwierdzanie kroku przed wykonaniem |
| Dify | Wizualne workflow, narzędzia, deployment aplikacji AI | Szablony poleceń i workflow do wielokrotnego użycia |
| Open WebUI | Provider-agnostic settings, plugin/tool calling, context/RAG, aktualizacje | Lepszy panel modeli/runtime oraz prostszy onboarding lokalnego AI |
| CrewAI | Guardrails, memory, knowledge, observability | Guardrails dla stacji: limity, zakazane komendy, wymagane raporty |

## Decyzja testera po tej rundzie

Produkt jest alpha-plus blisko beta: działa jako panel szkolno-operatorski z lokalnymi stacjami, ma trace, anulowanie/ponawianie, edycję oczekujących poleceń, presety, smoke runtime i oceny wyników. Największa przewaga forka to połączenie GitHub Pages + Supabase + lokalne szkolne stacje bez haseł operatora. Największe ryzyko to rosnąca złożoność `ui/app.js` oraz brak automatycznych E2E.

## Usprawnienie wdrożone z review

Dodano filtry poleceń po tekście, statusie i priorytecie oraz edycję polecenia przed wykonaniem. To bezpośrednio odpowiada na lukę operacyjną z konkurencyjnych widoków runs/traces: operator może szybko znaleźć polecenie i poprawić literówkę, priorytet, repo, stację albo model bez tworzenia duplikatu.

## Usprawnienie wdrożone z sugestii modeli

Po przeglądzie folderu `sugestie/` utwardzono tokenowe Edge Functions: payloady są walidowane, token redeem musi mieć format `amst_...`, czas życia tokenu nie może przekroczyć 7 dni, a CORS nie używa już globalnego `*`. Fork powinien ustawić sekret `ALLOWED_APP_ORIGINS` z adresem swojej strony GitHub Pages.