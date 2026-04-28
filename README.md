# Agent Manager

Status: **alpha**. Agent Manager to panel do dodawania poleceń dla AI, śledzenia wykonania i podłączania lokalnych stacji roboczych z modelem GGUF.

Najprościej: otwierasz aplikację, wpisujesz polecenie dla AI, a AI kierownik decyduje, czy wykona je przeglądarkowy agent, czy dostępna stacja robocza.

## Szybki start: używam aplikacji

1. Otwórz aplikację: https://kamciosz.github.io/agent-manager/
2. Zarejestruj konto emailem i hasłem.
3. Kliknij **Dodaj polecenie**.
4. Wpisz, co AI ma zrobić, opcjonalnie dodaj repozytorium i wybierz stację.
5. Obserwuj status w czasie rzeczywistym w widoku **Monitor** albo w szczegółach polecenia.

Nie musisz instalować niczego, jeśli wystarcza tryb przeglądarkowy alpha.

## Dodaj lokalną stację roboczą

Stacja robocza to komputer, który uruchamia lokalny model GGUF przez llama.cpp i odbiera polecenia z aplikacji.

1. Pobierz paczkę launchera z GitHub Actions albo sklonuj repo.
2. Uruchom plik dla swojego systemu:

| System | Najprostszy start | Aktualizacja | Diagnostyka |
|--------|-------------------|--------------|-------------|
| Windows 10/11 | dwuklik [start.bat](start.bat) | dwuklik [Aktualizuj.bat](Aktualizuj.bat) | `start.bat --doctor --no-pause` |
| macOS | dwuklik [start.command](start.command) | dwuklik [Aktualizuj.command](Aktualizuj.command) | `./start.sh --doctor` |
| Linux | `./start.sh` | `./Aktualizuj.command` | `./start.sh --doctor` |

3. Pierwszy start zapyta o model GGUF, nazwę stacji i dane Supabase.
4. Zostaw okno launchera otwarte, kiedy komputer ma wykonywać polecenia.
5. Stacja pojawi się w aplikacji w widoku **Stacje robocze**.

Ważne: `local-ai-proxy/config.json` jest lokalny i nie powinien trafić do gita. Przykład bez sekretów jest w [local-ai-proxy/config.example.json](local-ai-proxy/config.example.json).

## Aktualizacja

Najprościej użyj:

- Windows: [Aktualizuj.bat](Aktualizuj.bat)
- macOS/Linux: [Aktualizuj.command](Aktualizuj.command)

To uruchamia bezpieczny update launchera. Jeśli repo ma lokalne zmiany, update zostanie pominięty z komunikatem zamiast nadpisywać pliki.

Możesz też użyć flagi:

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
4. Dodaj `SUPABASE_URL` i `SUPABASE_ANON_KEY` do GitHub Secrets.
5. Włącz GitHub Pages z GitHub Actions.
6. Uruchom workflow **Deploy**.

Deploy GitHub Pages publikuje UI. Migracje bazy są jawne i nie są wykonywane przez workflow Pages.

## Bezpieczeństwo alpha

- Publiczny `anon/publishable key` Supabase może być użyty w frontendzie, ale dane chroni RLS.
- Launchery nie mają już wpisanego domyślnego projektu Supabase. Każdy fork podaje własny URL i key.
- Lokalny proxy akceptuje tylko skonfigurowane originy aplikacji oraz localhost.
- `local-ai-proxy/config.json`, modele, binarki i logi są ignorowane przez git.
- CI ma guard blokujący przypadkowe dodanie lokalnego configu i oczywistych sekretów.

## Technologia

| Warstwa | Rozwiązanie |
|---------|-------------|
| UI | GitHub Pages, vanilla JS, Tailwind CDN |
| Baza i realtime | Supabase Postgres + Realtime |
| Logowanie | Supabase Auth |
| Lokalny AI | llama.cpp `llama-server` + Node 18 proxy |
| Stacje | `workstation-agent.js` + Supabase REST |

## Dokumentacja

| Sekcja | Plik |
|--------|------|
| Nawigacja po docs | [docs/index.md](docs/index.md) |
| Architektura | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Lokalny runtime | [local-ai-proxy/README.md](local-ai-proxy/README.md) |
| Specyfikacja UI | [docs/product/ui-spec.md](docs/product/ui-spec.md) |
| Testy | [docs/dev/testing.md](docs/dev/testing.md) |
| Krytyczny QA alpha | [docs/product/bad-mood-qa.md](docs/product/bad-mood-qa.md) |
| Jak forknąć | [FORK_GUIDE.md](FORK_GUIDE.md) |
