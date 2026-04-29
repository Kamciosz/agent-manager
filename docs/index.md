# Dokumentacja — Agent Manager

Mapa całej dokumentacji projektu. Czytaj w kolejności odpowiadającej etapowi pracy.

## Koncepcja

| Plik | Zawartość |
|------|-----------|
| [concept/vision.md](concept/vision.md) | Wizja, cel, założenia, fazy integracji, mierniki sukcesu |
| [concept/roles.md](concept/roles.md) | Role w systemie: AI kierownik, Agenty wykonawcze, Team leader, Użytkownik |

## Architektura

| Plik | Zawartość |
|------|-----------|
| [architecture/overview.md](architecture/overview.md) | Jak działa, setup Supabase, komponenty, bezpieczeństwo |
| [architecture/communication.md](architecture/communication.md) | Komunikacja AI↔AI przez Supabase Realtime; port 443; kanały pub/sub |
| [architecture/agent-profiles.md](architecture/agent-profiles.md) | Szablony profili agentów i logika przydziału |
| [architecture/repo-settings.md](architecture/repo-settings.md) | Ustawienia repozytorium, autodebugowanie |

## Produkt

| Plik | Zawartość |
|------|-----------|
| [product/mvp-scope.md](product/mvp-scope.md) | Zakres MVP 1.0.0 — funkcje obowiązkowe i kryteria akceptacji |
| [product/alpha-release.md](product/alpha-release.md) | Status alpha, zakres, ograniczenia i checklisty testów |
| [product/alpha-gap-analysis.md](product/alpha-gap-analysis.md) | Luki produktu po MVP, decyzje alpha i lista braków przed beta |
| [product/ui-spec.md](product/ui-spec.md) | Specyfikacja UI/UX — ekrany, persony, UX rules |
| [product/hermes-labyrinth.md](product/hermes-labyrinth.md) | Preset Hermes Labyrinth: role, bramy i integracja z Agent Manager |
| [product/bad-mood-qa.md](product/bad-mood-qa.md) | Krytyczny QA alpha: tester i nietechniczny użytkownik |

## Implementacja

| Plik | Zawartość |
|------|-----------|
| [dev/repo-map.md](dev/repo-map.md) | Struktura projektu — gdzie co leży |
| [dev/api-reference.md](dev/api-reference.md) | Supabase SDK — jak zapisywać, czytać, subskrybować kanały |
| [dev/testing.md](dev/testing.md) | Kryteria walidacji i scenariusze testów akceptacyjnych |

## Poza docs/

| Plik | Zawartość |
|------|-----------|
| [../README.md](../README.md) | Opis projektu + jak zacząć (dla użytkownika i właściciela) |
| [../FORK_GUIDE.md](../FORK_GUIDE.md) | Jak forknąć i uruchomić własną kopię (10 minut, klikanie) |
| [../todo.md](../todo.md) | Lista zadań i kamieni milowych |
