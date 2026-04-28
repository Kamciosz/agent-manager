# Zakres MVP 1.0.0

Data: 2026-04-28

Minimalny weryfikowalny zakres funkcji i kryteria akceptacji dla wersji MVP 1.0.0.

## Zakres MVP

**Obejmuje:**
- Przyjmowanie zadań przez UI (formularz w przeglądarce)
- Automatyczny przydział zadań przez AI kierownika do agentów wykonawczych
- Komunikacja AI↔AI przez Supabase Realtime (kanały pub/sub)
- Raportowanie statusu w czasie rzeczywistym (bez odświeżania strony)
- Zarządzanie profilami agentów (CRUD w UI)
- Prosty workflow autodebug (diagnostyka i raport)
- Kontrola dostępu — role manager/executor/viewer przez Supabase Auth + RLS

**Nie obejmuje:** zaawansowanego planowania zadań, SSO, pełnej wielo-tenantowości, zaawansowanych dashboardów analitycznych, dynamicznego ładowania modeli AI.

## Funkcje obowiązkowe

| ID | Funkcja | Opis | Priorytet | Kryterium akceptacji |
|----|---------|------|-----------|---------------------|
| MVP-01 | Tworzenie zadań | Formularz w UI → zapis w tabeli Supabase `tasks` | Krytyczny | Zadanie pojawia się w bazie z unikalnym `id`; status `pending`; widoczne na liście |
| MVP-02 | Przydział zadań przez AI kierownika | AI kierownik subskrybuje kanał `tasks` i automatycznie przydziela agenty wykonawcze przez tabelę `assignments` | Krytyczny | Przydział pojawia się w < 3 sek.; agent wykonawczy dostaje powiadomienie Realtime |
| MVP-03 | Statusy zadań live | Agenty wykonawcze aktualizują status w Supabase; UI pokazuje zmianę bez odświeżania | Wysoki | Historia statusów przechowywana; bieżący status poprawny; RLS chroni przed nieautoryzowaną zmianą |
| MVP-04 | Profile agentów | CRUD profili w UI (name, role, skills, concurrencyLimit); AI kierownik uwzględnia je przy przydziale | Wysoki | Profile zapisywane w Supabase; AI kierownik respektuje skills i limity |
| MVP-05 | Autodebug | Po `status=failed` lub na żądanie: zebranie logów, analiza, raport z sugestią naprawy | Średni | Raport z polami: opis błędu, logi, sugestia naprawy |
| MVP-06 | Kontrola dostępu | Supabase Auth (email/hasło) + RLS; role manager/executor/viewer | Krytyczny | Executor widzi tylko swoje zadania; viewer tylko do odczytu; Supabase blokuje nieautoryzowany dostęp |
| MVP-07 | Komunikacja AI↔AI | AI kierownik i agenty wykonawcze wymieniają wiadomości przez kanały Realtime (pytania, odpowiedzi, sync, raporty) | Krytyczny | Kanały aktywne; wiadomości dostarczane < 1s; agenty wykonawcze mogą się synchronizować wzajemnie |

## Checklist akceptacyjna

- [ ] MVP-01: Formularz działa, zadanie pojawia się w Supabase Table Editor
- [ ] MVP-02: AI kierownik przydziela w < 3 sekundy; agent wykonawczy widzi przydział w Realtime
- [ ] MVP-03: Status zmienia się na żywo w UI; historia zapisana
- [ ] MVP-04: CRUD profili działa; AI kierownik uwzględnia skills przy przydziale
- [ ] MVP-05: Raport autodebug zawiera opis błędu i sugestię
- [ ] MVP-06: Executor nie widzi zadań innych; viewer nie może edytować
- [ ] MVP-07: Konsola przeglądarki pokazuje aktywność na kanałach Realtime

## Schemat danych

Tabela `tasks` w Supabase przechowuje: unikalny identyfikator (UUID generowany automatycznie), tytuł, opis, priorytet, status, ID użytkownika który zgłosił, opcjonalne repozytorium Git, dodatkowy kontekst i datę utworzenia. Pełny opis wszystkich tabel: [docs/dev/api-reference.md](../dev/api-reference.md)
