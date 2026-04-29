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
| P0 | Brak prawdziwego widoku trace/run dla pojedynczego zadania | LangSmith i Flowise wygrywają tym, że każdy run ma czytelną oś zdarzeń, input/output, koszty/czasy | Dodać kartę `Run trace` w Task Detail: manager decision, workstation job, prompt preview, result/error, czas trwania |
| P0 | Brak anulowania i ponawiania | Usunięcie zadania to porządek, nie kontrola procesu | Dodać status `cancelled` i akcje `Anuluj`, `Ponów`, `Ponów na innej stacji` |
| P1 | Brak zapisanych presetów konfiguracji stacji | Sale szkolne zwykle potrzebują powtarzalnego profilu runtime | Dodać presety: `Operator Mac`, `Sala CPU`, `Sala GPU`, `Długi kontekst`, `RotorQuant` |
| P1 | Brak walidacji wygenerowanego configu w UI | Operator może wygenerować sprzeczne wartości, zanim trafi do launchera | Dodać panel walidacji: porty, harmonogram, SD bez draft modelu, 256k warning |
| P1 | Dokumentacja API jest częściowo starsza niż obecny schemat | Nowy tester może mylić `repo` z `git_repo` albo team-space z per-user RLS | Odświeżyć `docs/dev/api-reference.md` do aktualnych tabel i RLS |
| P2 | Brak ocen jakości wyników | Dify/Flowise/LangSmith mają ewaluacje; tutaj brak feedbacku `dobry/zły` | Dodać ocenę wyniku zadania i prosty dataset regresyjny |
| P2 | Brak widoku zasobów runtime | Open WebUI mocno eksponuje modele/providerów; tu brakuje RAM/VRAM/CPU telemetry | Dodać opcjonalne metadata: RAM, GPU, token/s, czas generowania |

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

Produkt jest alpha-plus: działa jako panel szkolno-operatorski z lokalnymi stacjami, ale przed beta potrzebuje lepszego `Run trace`, anulowania/ponawiania i presetów konfiguracji. Największa przewaga forka to połączenie GitHub Pages + Supabase + lokalne szkolne stacje bez haseł operatora. Największe ryzyko to rosnąca złożoność `ui/app.js` oraz brak automatycznych E2E.

## Usprawnienie wdrożone z review

Dodano filtry poleceń po tekście, statusie i priorytecie. To bezpośrednio odpowiada na lukę operacyjną z konkurencyjnych widoków runs/traces: przy większej liczbie poleceń operator ma szybko zawęzić listę, bez przechodzenia do Supabase.

## Usprawnienie wdrożone z sugestii modeli

Po przeglądzie folderu `sugestie/` utwardzono tokenowe Edge Functions: payloady są walidowane, token redeem musi mieć format `amst_...`, czas życia tokenu nie może przekroczyć 7 dni, a CORS nie używa już globalnego `*`. Fork powinien ustawić sekret `ALLOWED_APP_ORIGINS` z adresem swojej strony GitHub Pages.