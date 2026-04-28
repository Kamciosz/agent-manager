# Wizja i założenia projektu

## Co to jest Agent Manager

Agent Manager to system zarządzania agentami AI. Działa w przeglądarce — żadnej instalacji, żadnego serwera do uruchomienia.

**Prosta analogia:** wyobraź sobie firmę. Ty jesteś klientem — mówisz co chcesz zrobić. AI kierownik analizuje zadanie, rozkłada na części i przydziela pracę do agentów wykonawczych. Agenty komunikują się ze sobą i z AI kierownikiem w trakcie pracy. Ty dostajesz gotowy wynik.

## Inspiracja i kontekst

Projekt bazuje na idei systemów orkiestracji agentów AI (Hermes Agent, OpenMythos, agent-orchestrator i podobnych). Główne założenie: zbudować menedżera agentów, który przyjmuje zadania od ludzi, rozkłada je na kroki, deleguje wykonawcom i raportuje postępy w sposób przewidywalny i skalowalny.

MVP koncentruje się na wspieraniu pracy programistycznej z repozytorium Git jako głównym kontekstem zadania.

## Cel systemu

AI kierownik przyjmuje i rozdziela zadania między agenty wykonawcze, monitoruje postęp i uruchamia prostą autodiagnostykę. System działa jako platforma rozproszona — agenci na różnych komputerach, w różnych sieciach, komunikujący się przez Supabase Realtime (port 443, HTTPS).

## Główne założenia

- Człowiek przekazuje zadanie przez aplikację webową w przeglądarce.
- AI kierownik analizuje zadanie, dzieli na kroki i przydziela agentom wykonawczym.
- AI aktywnie komunikują się ze sobą — AI kierownik z agentami, agenty wykonawcze ze sobą nawzajem.
- Każde zadanie może być powiązane z jednym repozytorium Git (multi-repo poza MVP).
- AI kierownik decyduje samodzielnie, ilu agentów wykonawczych potrzeba i jakie profile ma przydzielić.
- System wspiera tryb autonomiczny i półautonomiczny (wymagające zatwierdzenia użytkownika).
- Debugowanie repozytorium jest domyślnie wyłączone; włączane ręcznie.
- Działa na szkolnym i firmowym WiFi — tylko wychodzący port 443 (HTTPS).

## Fazy integracji wykonawczej

| Faza | Zakres |
|------|--------|
| 1 | Analiza zadań, kontekst Git, przypisywanie profili agentów — **to jest MVP** |
| 2 | Uruchamianie prostych poleceń w terminalu/shellu w izolowanym środowisku |
| 3 | Wsparcie kontenerów Docker/Podman do testów i kompilacji |
| 4 | Obsługa VM dla bardziej złożonych środowisk |
| 5 | Integracja z narzędziami skill/tool/MCP |

> MVP obejmuje fazę 1 i opcjonalnie 2. Kontenery i VM planowane na pierwszą aktualizację po MVP.

## Wymagania funkcjonalne

- Przyjmowanie zleceń od użytkowników przez przeglądarkę.
- Analiza i dekompozycja zadania przez Szefa AI.
- Przydzielanie pracy do agentów wykonawczych.
- Dwukierunkowa komunikacja AI kierownik ↔ Agent wykonawczy oraz Agent ↔ Agent przez Supabase Realtime.
- Monitorowanie postępu i stanu zadań w czasie rzeczywistym.
- Raportowanie wyników i komunikacja zwrotna z użytkownikiem.
- Obsługa trybów autonomicznych i półautonomicznych.
- Dynamiczne zarządzanie agentami (dodawanie, usuwanie, skalowanie).
- Obsługa wielu użytkowników z separacją przestrzeni zadań (RLS).

## Wymagania niefunkcjonalne

- Skalowalność i elastyczność architektury.
- Niezawodność i odporność na błędy (zadania czekają w bazie gdy agent offline).
- Wydajność przy dużej liczbie równoległych agentów.
- Bezpieczeństwo i autoryzacja — Supabase Auth + Row Level Security.
- Łatwość wdrożenia — 10 minut setup, zero terminala dla właściciela; zero konfiguracji dla użytkowników.
- Działa wszędzie — szkolne WiFi, firmowa sieć, domowy internet.
- Przyjazny interfejs — tylko przeglądarka.

## Odporność i obsługa błędów

- Retry — ponowienie zadania po błędzie.
- Fallback — przekierowanie zadania do innego agenta wykonawczego.
- Zatrzymanie, wznowienie i anulowanie zadań.
- Dziennik działań i audyt decyzji w bazie Supabase.
- Utrata połączenia agenta — zadanie czeka w bazie; agent wznawia po reconnect.

## Tryby działania

- **Autonomiczny** — AI kierownik i agenty wykonawcze podejmują decyzje i realizują zadania samodzielnie.
- **Półautonomiczny** — Agenty wykonawcze wymagają zatwierdzenia kluczowych decyzji przez użytkownika.

## Mierniki sukcesu MVP

- Zadanie można utworzyć przez przeglądarkę i powiązać z repozytorium Git.
- AI kierownik wybiera liczbę agentów wykonawczych i odpowiednie profile do zadania bez interwencji użytkownika.
- AI kierownik i agenty wykonawcze komunikują się przez Supabase Realtime — wiadomości dostarczane < 1 sekundy.
- System generuje działający plan działania do realnej funkcji.
- Autodebugowanie uruchamia analizę i raportuje wynik.
- Debugowanie repo jest domyślnie wyłączone.

## Przykładowy scenariusz

1. Użytkownik w przeglądarce wpisuje: „Stwórz prostą aplikację webową do zarządzania zadaniami".
2. AI kierownik analizuje → dzieli: UI, backend (Supabase), integracja.
3. Przydziela agenty wykonawcze: Agent-UI, Agent-Backend, Agent-Integracyjny.
4. Agenty pracują równolegle, synchronizując się przez kanał `sync`.
5. AI kierownik monitoruje i koryguje w razie potrzeby.
6. Użytkownik widzi postęp na żywo i odbiera gotowy wynik.

## Główne założenia

- Człowiek przekazuje zadanie przez aplikację webową lub terminal.
- AI kierownik analizuje zadanie, dzieli na kroki i przydziela agentom wykonawczym.
- Każde zadanie jest powiązane z jednym repozytorium Git (multi-repo poza MVP).
- AI kierownik decyduje samodzielnie, ilu agentów potrzeba i jakie profile ma przydzielić.
- System wspiera tryb autonomiczny i półautonomiczny (wymagające zatwierdzenia użytkownika).
- Rotorquant jest domyślnym mechanizmem optymalizacji kontekstu dla agentów (konfigurowalny).
- Debugowanie repozytorium jest domyślnie wyłączone; włączane ręcznie.

## Fazy integracji wykonawczej

| Faza | Zakres |
|------|--------|
| 1 | Analiza zadań, kontekst Git, przypisywanie profili agentów |
| 2 | Uruchamianie prostych poleceń w terminalu/shellu w izolowanym środowisku |
| 3 | Wsparcie kontenerów Docker/Podman do testów i kompilacji |
| 4 | Obsługa VM dla bardziej złożonych środowisk |
| 5 | Integracja z narzędziami skill/tool/MCP |

> MVP obejmuje fazę 1 i opcjonalnie 2. Kontenery i VM planowane na pierwszą aktualizację po MVP.

## Wymagania funkcjonalne

- Przyjmowanie zleceń od użytkowników.
- Analiza i dekompozycja zadania.
- Przydzielanie pracy do agentów wykonawczych.
- Monitorowanie postępu i stanu zadań.
- Raportowanie wyników i komunikacja zwrotna.
- Obsługa trybów autonomicznych i półautonomicznych.
- Dynamiczne zarządzanie agentami (dodawanie, usuwanie, skalowanie).
- Obsługa wielu użytkowników z separacją przestrzeni zadań.

## Wymagania niefunkcjonalne

- Skalowalność i elastyczność architektury.
- Niezawodność i odporność na błędy.
- Wydajność przy dużej liczbie równoległych agentów.
- Bezpieczeństwo i autoryzacja (bezpieczne wykonanie kodu zarezerwowane na kolejne fazy).
- Łatwość wdrożenia i utrzymania.
- Wsparcie otwartych standardów i protokołów.
- Przyjazny interfejs (web / terminal / API).

## Odporność i obsługa błędów

- Retry — ponowienie zadania po błędzie.
- Fallback — przekierowanie zadania do innego agenta.
- Zatrzymanie, wznowienie i anulowanie zadań.
- Dziennik działań i audyt decyzji.

## Tryby działania

- **Autonomiczny** — agenci podejmują decyzje i realizują zadania samodzielnie.
- **Półautonomiczny** — agenci wymagają zatwierdzenia kluczowych decyzji przez użytkownika.

## Mierniki sukcesu MVP

- Zadanie można utworzyć i powiązać z repozytorium Git.
- AI kierownik wybiera liczbę agentów i odpowiednie profile do zadania.
- System generuje działający plan działania do realnej funkcji.
- Autodebugowanie uruchamia analizę testów i raportuje wynik.
- Debugowanie repo jest domyślnie wyłączone.

## Przykładowy scenariusz

1. Użytkownik zleca: „Stwórz prostą aplikację webową do zarządzania zadaniami".
2. AI kierownik dzieli zadanie na kroki: UI, backend, integracja.
3. Przydziela agentów: Agent UI, Agent Backend, Agent Integracyjny.
4. Agenci pracują równolegle, raportują postęp.
5. AI kierownik agreguje wyniki i raportuje użytkownikowi.
