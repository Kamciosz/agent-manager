# Walidacja i testy akceptacyjne

Data: 2026-04-28

Kryteria walidacji i scenariusze testów dla projektu Agent Manager. Backend to Supabase — testy sprawdzają działanie przez przeglądarkę i Supabase JS SDK.

## Kryteria walidacji

| ID | Kryterium | Metoda weryfikacji | Warunek przejścia |
|----|-----------|-------------------|-------------------|
| AM-VAL-001 | Tworzenie zadania | Ręczny test w UI — formularz Submit Task | Zadanie pojawia się w tabeli Supabase; status `pending`; widoczne na liście zadań |
| AM-VAL-002 | Przydział zadania przez AI kierownika | Ręczny test — dodaj zadanie, sprawdź czy AI kierownik przydzielił je w ciągu ~5 sekund | Wpis w tabeli `assignments`; agent wykonawczy dostaje powiadomienie real-time |
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
2. Kliknij „Dodaj zadanie" → wypełnij formularz → „Wyślij".
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

---

## Gdzie sprawdzać dane podczas testów

Supabase dostarcza panel webowy do przeglądania bazy danych:

1. Zaloguj się na [supabase.com](https://supabase.com) → otwórz projekt.
2. Przejdź do **Table Editor** — widok wszystkich rekordów w tabelach.
3. Przejdź do **Realtime** → **Inspect** — podgląd live wiadomości przez kanały.
4. Przejdź do **Authentication** → **Users** — lista zarejestrowanych użytkowników i ich ról.

Żadnego curl ani terminala — wszystko przez przeglądarkę.
  -X POST "$API_URL/api/v1/tasks/$TASK_ID/assign" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -d '{"assignee":"agent-1"}' | grep -q "403"
```

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
