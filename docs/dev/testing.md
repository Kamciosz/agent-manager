# Walidacja i testy akceptacyjne

Data: 2026-04-28

Kryteria walidacji i scenariusze testów dla projektu Agent Manager. Backend to Supabase — testy sprawdzają działanie przez przeglądarkę i Supabase JS SDK.

## Kryteria walidacji

| ID | Kryterium | Metoda weryfikacji | Warunek przejścia |
|----|-----------|-------------------|-------------------|
| AM-VAL-001 | Tworzenie zadania | Ręczny test w UI — formularz Submit Task | Zadanie pojawia się w tabeli Supabase; status `pending`; widoczne na liście zadań |
| AM-VAL-002 | Przydział polecenia przez AI kierownika | Ręczny test — dodaj polecenie, sprawdź czy AI kierownik przydzielił je w ciągu ~5 sekund | Wpis w tabeli `assignments`; agent wykonawczy dostaje powiadomienie real-time |
| AM-VAL-003 | Aktualizacja statusu zadania | Sprawdź w UI czy status zmienia się na żywo bez odświeżania | Historia statusów w bazie; bieżący status poprawny |
| AM-VAL-004 | Profile agentów | CRUD w UI — utwórz, edytuj, usuń profil; sprawdź czy AI kierownik uwzględnia go przy przydziale | Profile zapisywane w Supabase; AI kierownik respektuje skills i limity |
| AM-VAL-005 | Autodebug | Ustaw status zadania na `failed`; sprawdź czy system generuje raport | Raport zawiera opis błędu, sugestię naprawy, logi |
| AM-VAL-006 | Kontrola dostępu | Zaloguj się jako `executor`; sprawdź że nie widzisz zadań innych użytkowników | RLS blokuje nieautoryzowany dostęp; role egzekwowane przez Supabase |
| AM-VAL-007 | Komunikacja AI↔AI | Utwórz zadanie; sprawdź w logach że AI kierownik i agenty wykonawcze wymieniają wiadomości przez kanały Realtime | Kanały `tasks`, `assignments`, `sync` aktywne; wiadomości dostarczane < 1s |

## Scenariusze testów akceptacyjnych

### Scenariusz 1 — Pełny przepływ zadania (happy path)

**Cel:** Zadanie przechodzi przez pełny cykl: użytkownik → AI kierownik → agent wykonawczy → wynik.

**Kroki:**
1. Zaloguj się jako manager w aplikacji.
2. Kliknij „Dodaj polecenie" → wypełnij formularz → „Wyślij polecenie".
3. Obserwuj stronę Task Detail.

**Oczekiwany wynik:**

Timeline na stronie Task Detail powinien pokazywać kolejno: zadanie wysłane → AI kierownik przejął zadanie (w ciągu 3 sekund) → podzielono na podzadania → przydzielono do agenta → agent rozpoczął pracę → agent zakończył (status: done). Każda zmiana statusu pojawia się na żywo bez odświeżania strony.

---

### Scenariusz 2 — Komunikacja AI↔AI

**Cel:** Sprawdzenie że AI kierownik i agenty wykonawcze faktycznie się komunikują przez Supabase Realtime.

**Kroki:**
1. Utwórz zadanie wymagające 2 podzadań.
2. Otwórz panel Supabase → **Realtime** → **Inspect**.
3. Obserwuj aktywność na kanałach.

**Oczekiwany wynik:**
- Kanał `tasks` — zdarzenie INSERT po wysłaniu zadania
- Kanał `assignments` — dwa zdarzenia INSERT (AI kierownik przydziela agentom wykonawczym)
- Kanał `sync` — wiadomości między agentami wykonawczymi podczas pracy
- Kanał `reports` — zdarzenia INSERT gdy agenty wykonawcze kończą

Wszystkie zdarzenia powinny się pojawić w ciągu kilku sekund od wysłania zadania.

---

### Scenariusz 3 — Kontrola dostępu (RBAC)

**Cel:** Użytkownik z rolą `executor` nie widzi zadań innych użytkowników.

**Kroki:**
1. Utwórz konto managera i konto executora (dwa różne emaile).
2. Jako manager: utwórz 3 zadania, przydziel 1 do executora.
3. Zaloguj się jako executor.

**Oczekiwany wynik:**
- Executor widzi tylko 1 zadanie (swoje przydzielone)
- Nie może tworzyć ani przydzielać zadań
- Supabase RLS automatycznie filtruje dane — zero zmian w kodzie UI

---

### Scenariusz 4 — Odporność na offline

**Cel:** Zadanie nie ginie gdy agent się rozłączy.

**Kroki:**
1. Utwórz zadanie i przydziel do agenta.
2. Zamknij przeglądarkę agenta (symulacja offline).
3. Poczekaj 1 minutę.
4. Otwórz ponownie przeglądarkę agenta i zaloguj się.

**Oczekiwany wynik:**
- Zadanie nadal widoczne w stanie `in_progress` lub `pending`
- Agent może je wznowić — dane nie zginęły
- Supabase PostgreSQL trwale przechowuje stan

---

### Scenariusz 5 — Autodebug

**Cel:** System wykrywa błąd i generuje raport.

**Kroki:**
1. Ustaw status zadania na `failed` z polem `error`.
2. Kliknij „Uruchom diagnostykę" na stronie Task Detail.

**Oczekiwany wynik:**
- Karta wyników z: opisem błędu, sugestią naprawy, logami z tablicy `task_logs`
- Przycisk „Pobierz raport" i „Utwórz zgłoszenie"

## Smoke testy launcherów i bezpieczeństwa

Przed pushem uruchom lokalnie:

```bash
bash -n start.sh
node --check --input-type=module < ui/app.js
node --check --input-type=module < ui/ai-client.js
node --check --input-type=module < ui/manager.js
node --check --input-type=module < ui/executor.js
node --check --input-type=module < ui/settings.js
node --check --input-type=module < ui/labyrinth.js
node --check local-ai-proxy/proxy.js local-ai-proxy/workstation-agent.js local-ai-proxy/runtime-schedule.js
node --test tests/*.test.js
./start.sh --doctor
git diff --check
```

Po pushu muszą przejść workflow:

| Workflow | Co sprawdza |
|----------|-------------|
| `Deploy to GitHub Pages` | Wstrzyknięcie Supabase secrets i publikację `ui/` |
| `Static UI smoke` | Składnię modułów `ui/*.js`, testy `node:test`, brak `package.json` i statyczne serwowanie `ui/` |
| `Security scan` | Brak śledzonego `local-ai-proxy/config.json` i oczywistych sekretów |
| `Windows launcher smoke` | `node --test`, parser PowerShell, `start.ps1 --help`, `start.bat --help`, `start.ps1 --doctor` |
| `macOS and Linux launcher smoke` | `bash -n`, `node --check`, `node --test`, `start.sh --help`, `start.sh --doctor` |
| `Package launchers` | ZIP-y `AgentManager-Windows`, `AgentManager-macOS`, `AgentManager-Linux` |

Manualny test UI po tej rundzie:

1. Otwórz aplikację i przejdź do **Ustawienia**.
2. Zmień motyw na ciemny, odśwież stronę i sprawdź, czy wybór został.
3. Dodaj polecenie bez repo i bez stacji.
4. Dodaj polecenie z repo i jedną stacją.
5. Sprawdź, czy formularz nie wymaga JSON i czy tooltipy `?` wyjaśniają pola.
6. W **Stacje robocze** użyj konfiguratora i sprawdź, czy generuje instrukcję `--config`.
7. Wybierz szablon **Hermes Labyrinth** i sprawdź, czy krok 2 pokazuje mapę bram oraz zapisuje workflow w kontekście zadania.
8. Na MacBooku operatora uruchom `./start.sh --no-pull` i sprawdź w podsumowaniu, że `stationMode` to `operator`, a `station agent` jest pominięty.
9. W **Stacje robocze** sprawdź, że MacBook operatora ma typ `operator`, nie pojawia się w planie sali i nie jest dostępny przy wyborze stacji dla polecenia.
10. Ułóż salę `226` jako 4 x 6 i odśwież stronę; plan nadal pokazuje puste pola oraz podpisy w stylu `226_2_5`.
11. Usuń siatkę sali `226`; rekordy stacji mają zostać, ale sala/pozycje powinny się wyczyścić i trafić do nieprzypisanych.
12. W konfiguratorze stacji wybierz tryb `operator`, ustaw porty, timeout, `18:00-08:00`, `wait`, `finish-current`, dump i wygeneruj instrukcję; podgląd `config.json` ma zawierać te pola.
13. W **Polecenia** przełącz widok z listy na kafelki i utwórz polecenie, wybierając stację kafelkiem.
14. Użyj filtrów poleceń po statusie, priorytecie i tekście; ten sam wynik ma być widoczny w liście i kafelkach.
15. Jako zwykły użytkownik utwórz 3 aktywne polecenia; czwarte powinno zostać odrzucone czytelnym komunikatem o limicie.
16. Dla aktywnego polecenia kliknij `Anuluj`; status ma przejść na `Anulowane`, a aktywny `workstation_job` nie może później przepisać zadania na `Gotowe`.
17. Dla polecenia `Błąd` albo `Anulowane` kliknij `Ponów`; licznik ponowień ma wzrosnąć, status wrócić na `Oczekuje`, a manager ma ponownie przydzielić wykonanie.
18. Wyślij do stacji komendy `Odśwież`, `Wstrzymaj`, `Wznów` i `Aktualizuj` z tabeli stacji oraz z monitora; w logu stacji wynik powinien być podpisany jako `system`.
19. Wyślij do stacji komendę `Smoke`; wynik ma pokazać odpowiedź `/health/smoke`, model, backend i czas generowania albo czytelny błąd połączenia.
20. W konfiguratorze stacji wybierz preset, zmień `messageBatchSize` i `offlineQueueMax`, kliknij `Rekonfiguruj`; odpowiedź systemowa ma pokazać zastosowane pola, a następny heartbeat ma odświeżyć metadane.
21. Odłącz stację od internetu/Supabase, wyślij wiadomość operacyjną i przywróć sieć; `offlineQueueDepth` ma wzrosnąć, a potem spaść po flushu.
22. W szczegółach zadania sprawdź `Run trace`; lista ma łączyć joby stacji, wiadomości AI i wiadomości runtime w kolejności czasu.
23. Dla zadania po błędzie kliknij `Ponów auto`; `requested_workstation_id` i `requested_model_name` mają się wyczyścić, a manager ma ponownie dobrać stację.
24. W konfiguratorze KV wybierz `iso3/iso3` albo `planar3/f16`; stock llama.cpp ma spaść do `q8_0/q8_0`, a kompatybilny build RotorQuant ma przyjąć osobne typy K/V.
25. Utwórz proste polecenie `2 + 2`; odpowiedź stacji ma zawierać bezpośredni wynik, bez przepisywania pól `Tytuł`, `Opis`, `Repo` ani `Kontekst`.

---

## Gdzie sprawdzać dane podczas testów

Supabase dostarcza panel webowy do przeglądania bazy danych:

1. Zaloguj się na [supabase.com](https://supabase.com) → otwórz projekt.
2. Przejdź do **Table Editor** — widok wszystkich rekordów w tabelach.
3. Przejdź do **Realtime** → **Inspect** — podgląd live wiadomości przez kanały.
4. Przejdź do **Authentication** → **Users** — lista zarejestrowanych użytkowników i ich ról.
Żadnego curl ani terminala — wszystko przez przeglądarkę.

---

## Walidacja schematów

```bash
# ajv (Node.js)
ajv validate -s schemas/submitTask.json -d tests/data/submitTask_payload.json

# jsonschema (Python)
python -m jsonschema -i tests/data/submitTask_payload.json schemas/submitTask.json
```

## Integracja z CI

Dodaj `tests/acceptance/run.sh` wykonujący powyższe scenariusze. Zakończ z kodem `exit 1` przy błędzie, aby przerwać pipeline.

## Przykładowe pliki testowe

- `tests/data/submitTask_payload.json` — poprawny payload (patrz wyżej)
- `tests/data/failing_task_payload.json` — payload powodujący symulowany błąd (używany w scenariuszu 3)
