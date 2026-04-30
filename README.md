# Agent Manager

Status: **alpha**. Agent Manager to panel do dodawania poleceń dla AI, śledzenia wykonania i podłączania lokalnych stacji roboczych z modelem GGUF.

Najprościej: otwierasz aplikację, wpisujesz polecenie dla AI, a AI kierownik decyduje, czy wykona je przeglądarkowy agent, czy dostępna stacja robocza.

## Co znajdziesz w głównym katalogu

**Nie czytasz tej tabeli, jeśli używasz tylko aplikacji w przeglądarce.** Te pliki są dla operatora stacji roboczej (komputer, który ma uruchamiać AI lokalnie).

### Twój system → kliknij dwa razy ten plik

| Twój system | Uruchom stację | Zaktualizuj stację |
|-------------|----------------|--------------------|
| 🍎 macOS | dwuklik [start.command](start.command) | dwuklik [Aktualizuj.command](Aktualizuj.command) |
| 🪟 Windows 10/11 | dwuklik [start.bat](start.bat) | dwuklik [Aktualizuj.bat](Aktualizuj.bat) |
| 🐧 Linux (terminal) | `./start.sh` | `./update.sh` |

To wszystko, co operator musi wiedzieć. Pozostałe pliki są tylko silnikiem — nie klikaj ich, nie usuwaj.

### Pozostałe pliki w katalogu (do wglądu)

| Plik / folder | Co to jest |
|---------------|-----------|
| [README.md](README.md) | Ten dokument. |
| [FORK_GUIDE.md](FORK_GUIDE.md) | Instrukcja dla osoby, która zakłada własną kopię systemu. |
| [CHANGELOG.md](CHANGELOG.md) | Lista zmian w kolejnych wersjach. |
| [SECURITY.md](SECURITY.md) | Jak zgłosić problem bezpieczeństwa. |
| [ui/](ui/) | Aplikacja webowa (to, co widzisz w przeglądarce). |
| [local-ai-proxy/](local-ai-proxy/) | Lokalny program stacji roboczej. |
| [supabase/](supabase/) | Konfiguracja bazy danych (instaluje właściciel forka). |
| [docs/](docs/) | Pełna dokumentacja produktu, architektury i developera. |
| [tests/](tests/), [infra/](infra/) | Testy i notatki techniczne. |
| [launcher/](launcher/) | Silnik launchera dla Windows (używany automatycznie przez `start.bat`). |

Wewnętrzne plany rozwoju są w [docs/internal/](docs/internal/) — nie musisz tam zaglądać, żeby używać aplikacji.

## Szybki start: używam aplikacji

1. Otwórz aplikację: https://kamciosz.github.io/agent-manager/
2. Zaloguj się kontem, któremu właściciel Supabase nadał rolę panelową (`operator`, `teacher`, `manager` albo `admin`).
3. Kliknij **Dodaj polecenie**.
4. Wpisz, co AI ma zrobić, albo wybierz szablon **Hermes Labyrinth** dla pracy przez mapę ról, bram i testów.
5. Obserwuj status w czasie rzeczywistym w widoku **Monitor** albo w szczegółach polecenia.

Nie musisz instalować niczego, jeśli wystarcza tryb przeglądarkowy alpha.

## Hermes Labyrinth

Szablon **Hermes Labyrinth** prowadzi polecenie przez etapy: rozpoznanie, mapa, podział ról, wykonanie, weryfikacja i raport. AI kierownik zapisuje ten workflow w kontekście zadania i przekazuje go executorowi albo stacji roboczej.

Szczegóły: [docs/product/hermes-labyrinth.md](docs/product/hermes-labyrinth.md).

## Dodaj lokalną stację roboczą

Stacja robocza to komputer, który uruchamia lokalny model GGUF przez llama.cpp i odbiera polecenia z aplikacji.

1. Pobierz paczkę launchera z GitHub Actions albo sklonuj repo.
2. Uruchom plik dla swojego systemu:

| System | Najprostszy start | Aktualizacja | Diagnostyka |
|--------|-------------------|--------------|-------------|
| Windows 10/11 | dwuklik [start.bat](start.bat) | dwuklik [Aktualizuj.bat](Aktualizuj.bat) | `start.bat --doctor --no-pause` |
| macOS | dwuklik [start.command](start.command) | dwuklik [Aktualizuj.command](Aktualizuj.command) | `./start.sh --doctor` |
| Linux | `./start.sh` | `./Aktualizuj.command` | `./start.sh --doctor` |

3. W dashboardzie wygeneruj token instalacyjny w widoku **Stacje robocze** i wklej go przy pierwszym starcie. Launcher nie pyta o hasło operatora. Na Windowsie sam pobierze portable Node.js, jeśli nie ma go w PATH.
4. Zostaw okno launchera otwarte, kiedy komputer ma wykonywać polecenia.
5. Stacja pojawi się w aplikacji w widoku **Stacje robocze**.

Ważne: `local-ai-proxy/config.json` jest lokalny i nie powinien trafić do gita. Przykład bez sekretów jest w [local-ai-proxy/config.example.json](local-ai-proxy/config.example.json).

## Aktualizacja

Najprościej użyj:

- Windows: [Aktualizuj.bat](Aktualizuj.bat)
- macOS/Linux: [Aktualizuj.command](Aktualizuj.command)

To uruchamia bezpieczny update launchera. W repo git robi `git pull --ff-only`, a w instalacji z ZIP-a pobiera najnowszy kod z GitHuba i zachowuje lokalne `config.json`, modele, binarki oraz logi. Jeśli repo ma lokalne zmiany, update zostanie pominięty z komunikatem zamiast nadpisywać pliki.

W repo git możesz też użyć flagi:

```bash
./start.sh --update
```

```cmd
start.bat --update
```

## Dla właściciela forka

Zobacz [FORK_GUIDE.md](FORK_GUIDE.md). W skrócie:

1. Fork repozytorium.
2. Utwórz projekt Supabase.
3. Wklej migracje SQL z [supabase/migrations](supabase/migrations) w Supabase SQL Editor albo zastosuj je przez Supabase CLI/tools.
4. Wdróż Edge Functions z [supabase/functions](supabase/functions) i ustaw w Supabase sekret `SUPABASE_SERVICE_ROLE_KEY` tylko dla funkcji; gotowe komendy są w [FORK_GUIDE.md](FORK_GUIDE.md).
5. Dodaj `SUPABASE_URL` i `SUPABASE_ANON_KEY` do GitHub Secrets.
6. Włącz GitHub Pages z GitHub Actions.
7. Uruchom workflow **Deploy**.

Deploy GitHub Pages publikuje UI. Migracje bazy są jawne i nie są wykonywane przez workflow Pages.

## Bezpieczeństwo alpha

- Publiczny `anon/publishable key` Supabase może być użyty w frontendzie, ale dane chroni RLS.
- Konto przeglądarkowego panelu musi mieć jawne `app_metadata.role`: `admin`, `manager`, `operator`, `teacher`, `executor` albo `viewer`. Samo założenie konta nie daje dostępu do danych panelu.
- Launchery nie mają już wpisanego domyślnego projektu Supabase. Każdy fork podaje własny URL i key.
- Stacje używają jednorazowego tokenu instalacyjnego z dashboardu. Hasło operatora nie jest zapisywane lokalnie; po aktywacji stacja dostaje ograniczoną sesję techniczną.
- Supabase service-role key jest potrzebny tylko w sekretach Edge Functions i nie może trafić do GitHub Pages, launcherów ani `config.json`.
- Lokalny proxy akceptuje tylko skonfigurowane originy aplikacji oraz localhost.
- `local-ai-proxy/config.json`, modele, binarki i logi są ignorowane przez git.
- CI ma guard blokujący przypadkowe dodanie lokalnego configu i oczywistych sekretów.

## Technologia

| Warstwa | Rozwiązanie |
|---------|-------------|
| UI | GitHub Pages, vanilla JS, Tailwind CDN |
| Baza i realtime | Supabase Postgres + Realtime |
| Logowanie | Supabase Auth |
| Lokalny AI | llama.cpp `llama-server` + Node 20+ proxy |
| Stacje | `workstation-agent.js` + Supabase REST |

## Dokumentacja

| Sekcja | Plik |
|--------|------|
| Nawigacja po docs | [docs/index.md](docs/index.md) |
| Architektura | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Lokalny runtime | [local-ai-proxy/README.md](local-ai-proxy/README.md) |
| Specyfikacja UI | [docs/product/ui-spec.md](docs/product/ui-spec.md) |
| Hermes Labyrinth | [docs/product/hermes-labyrinth.md](docs/product/hermes-labyrinth.md) |
| Testy | [docs/dev/testing.md](docs/dev/testing.md) |
| Krytyczny QA alpha | [docs/product/bad-mood-qa.md](docs/product/bad-mood-qa.md) |
| Jak forknąć | [FORK_GUIDE.md](FORK_GUIDE.md) |
