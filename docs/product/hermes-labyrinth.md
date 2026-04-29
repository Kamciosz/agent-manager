# Hermes Labyrinth dla Agent Manager

Hermes Labyrinth to preset orkiestracji inspirowany stylem pracy wieloagentowej: zadanie przechodzi przez kolejne bramy, a AI kierownik pilnuje mapy, wykonania, weryfikacji i raportu. To nie jest kopia zewnętrznego kodu. W tej wersji workflow jest dostosowany do obecnej architektury Agent Manager: GitHub Pages, Supabase, przeglądarkowy manager/executor i opcjonalne stacje robocze.

## Jak użyć

1. Kliknij **Dodaj polecenie**.
2. Wybierz szablon **Hermes Labyrinth**.
3. Dopisz temat po dwukropku w polu polecenia.
4. Dodaj repozytorium, wymagania i zakazy, jeśli są potrzebne.
5. Zostaw stację jako **Automatycznie** albo wybierz jedną konkretną stację.

Formularz zapisze w `tasks.context.raw.workflow` role, bramy, kontrakt wyjścia i zasady przejścia. AI kierownik używa tego kontekstu przy generowaniu instrukcji dla executora albo jobu stacji roboczej, a Task Detail pokazuje scaloną konsolę decyzji, wiadomości i dowodów.

## Role

| Rola | Znaczenie w Agent Manager |
|------|----------------------------|
| Navigator | Ustala trasę zadania, priorytety i bramy przejścia |
| Scout | Zbiera kontekst z repo, dokumentacji i danych polecenia |
| Cartographer | Zamienia rozpoznanie w mapę plików, ryzyk i punktów kontrolnych |
| Builder | Wykonuje zmianę albo przygotowuje instrukcję dla stacji |
| Verifier | Szuka błędów, regresji, brakujących testów i problemów w logach |
| Scribe | Zamyka pracę raportem z dowodami i pozostałym ryzykiem |

## Bramy workflow

| Brama | Warunek przejścia |
|-------|-------------------|
| Brama wejścia | Cel, repo, zakres, ograniczenia i kryterium sukcesu są jawne |
| Mapa labiryntu | Wskazane są pliki, zależności, ryzyka, komendy i kolejność kroków |
| Wybór ścieżki | Routing wskazuje przeglądarkę, konkretną stację lub fallback i powód wyboru |
| Przejście ścieżki | Zmiany są małe, spójne z repo i opisane w logu zadania |
| Ślad dowodowy | Konsola zawiera decyzje, wynik stacji, testy i ostrzeżenia |
| Lustro testera | Wynik przeszedł sensowną weryfikację albo ryzyko jest jawne |
| Wyjście | Człowiek dostaje zwięzły raport, dowody i następny bezpieczny krok |

## Integracja techniczna

- UI: [ui/labyrinth.js](../../ui/labyrinth.js) definiuje preset, role, bramy i funkcje budowania kontekstu.
- Wizard: [ui/index.html](../../ui/index.html) pokazuje kartę **Hermes Labyrinth** i mapę bram.
- Manager: [ui/manager.js](../../ui/manager.js) wykrywa workflow i generuje instrukcję z bramami dla executora albo stacji.
- Executor: [ui/executor.js](../../ui/executor.js) uwzględnia kontekst labiryntu w pytaniach i raporcie.
- Profile: migracja [202604291030_seed_hermes_labyrinth_profiles.sql](../../supabase/migrations/202604291030_seed_hermes_labyrinth_profiles.sql) dodaje archetypy ról do tabeli `agents`.
- Copilot: prompt [hermes-labyrinth.prompt.md](../../.github/prompts/hermes-labyrinth.prompt.md) pozwala używać tego samego workflow w VS Code.

## Ograniczenia alpha

- Role labiryntu są na razie archetypami i kontekstem decyzyjnym, nie osobnymi procesami działającymi równolegle.
- Supabase Realtime nadal obsługuje obecny przepływ `tasks -> assignments/workstation_jobs -> messages`.
- Pełny routing wielu specjalistów po osobnych assignmentach wymaga kolejnej migracji modelu danych.
