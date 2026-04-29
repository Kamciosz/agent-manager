# Hermes Labyrinth dla Agent Manager

Hermes Labyrinth to preset orkiestracji inspirowany stylem pracy wieloagentowej: zadanie przechodzi przez kolejne bramy, a AI kierownik pilnuje mapy, wykonania, weryfikacji i raportu. To nie jest kopia zewnętrznego kodu. W tej wersji workflow jest dostosowany do obecnej architektury Agent Manager: GitHub Pages, Supabase, przeglądarkowy manager/executor i opcjonalne stacje robocze.

## Jak użyć

1. Kliknij **Dodaj polecenie**.
2. Wybierz szablon **Hermes Labyrinth**.
3. Dopisz temat po dwukropku w polu polecenia.
4. Dodaj repozytorium, wymagania i zakazy, jeśli są potrzebne.
5. Zostaw stację jako **Automatycznie** albo wybierz jedną konkretną stację.

Formularz zapisze w `tasks.context.raw.workflow` role, bramy i zasady przejścia. AI kierownik używa tego kontekstu przy generowaniu instrukcji dla executora albo jobu stacji roboczej.

## Role

| Rola | Znaczenie w Agent Manager |
|------|----------------------------|
| Navigator | Ustala trasę zadania, priorytety i bramy przejścia |
| Scout | Zbiera kontekst z repo, dokumentacji i danych polecenia |
| Builder | Wykonuje zmianę albo przygotowuje instrukcję dla stacji |
| Verifier | Szuka błędów, regresji i ryzyk bezpieczeństwa |
| Scribe | Zamyka pracę krótkim raportem dla człowieka |

## Bramy workflow

| Brama | Warunek przejścia |
|-------|-------------------|
| Brama wejścia | Cel, repo, ograniczenia i kryterium sukcesu są jasne |
| Mapa labiryntu | Wybrane są pliki, zależności, ryzyka i kolejność kroków |
| Podział ról | AI kierownik wie, czy użyć executora, specjalisty czy stacji roboczej |
| Przejście ścieżki | Zmiany są małe, odwracalne i zgodne z lokalnym stylem |
| Lustro testera | Wynik przeszedł testy albo ryzyko jest jawnie opisane |
| Wyjście | Człowiek dostaje zwięzły raport i następny bezpieczny krok |

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
