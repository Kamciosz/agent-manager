# Agent Manager

Status: **alpha**.

Agent Manager to panel online do zarzadzania poleceniami AI oraz stacjami roboczymi z lokalnymi modelami GGUF.

To nie jest sam chat w przegladarce. Normalny sposob pracy wyglada tak:

1. Operator otwiera panel.
2. Ma podlaczona co najmniej jedna stacje robocza.
3. Dodaje polecenie dla AI.
4. AI kierownik kieruje zadanie do odpowiedniej stacji.
5. Panel pokazuje postep, wiadomosci i wynik.

## Najwazniejsze

- Panel online jest centrum sterowania.
- Stacja robocza jest standardowym wykonawca zadan.
- Kazdy fork ma wlasny adres GitHub Pages i wlasny projekt Supabase.
- Bez aktywnej stacji panel nadal sie otworzy, a alpha moze uzyc fallbacku przegladarkowego. Traktuj to jako tryb awaryjny, nie docelowy.

## Szybki start

1. Otworz adres swojej aplikacji.
   Jesli korzystasz z czyjejs kopii, dostaniesz link od wlasciciela.
   Jesli masz wlasna kopie, adres znajdziesz w **Settings -> Pages**.
2. Zaloguj sie kontem, ktore ma role panelowa.
   Typowe role: `operator`, `teacher`, `manager`, `admin`.
3. Wejdz do widoku **Stacje robocze** i sprawdz, czy przynajmniej jedna stacja jest online.
4. Jesli nie ma aktywnej stacji, uruchom launcher na wybranym komputerze.
5. Kliknij **Dodaj polecenie** i wpisz zadanie dla AI.
6. Obserwuj wykonanie w **Monitorze** albo w szczegolach zadania.

## Czy trzeba terminala i npm

W skrocie: **npm nie jest potrzebny**.

- W tym repo nie ma `package.json`, nie robisz `npm install` i nie robisz buildu frontendu.
- Zwykly uzytkownik panelu nie potrzebuje terminala.
- Operator stacji na Windows lub macOS moze wszystko zrobic dwuklikiem przez launcher.
- Terminal przydaje sie glownie na Linuxie albo przy diagnostyce (`--doctor`, `--update`).
- Wlasciciel forka moze postawic prawie caly system bez terminala: od zera uruchamia jeden plik SQL `supabase/setup_from_zero.sql`, a terminal najczesciej przydaje sie dopiero przy wdrozeniu Edge Functions.

## Co oznacza status w panelu

- **AI lokalny**: ten komputer widzi dzialajacy lokalny runtime i moze korzystac z modelu GGUF.
- **Panel online**: panel dziala, ale ten komputer nie ma aktywnego lokalnego runtime.

Wazne:

- **Panel online** nie oznacza, ze system jest martwy.
- Jesli inna stacja jest online, zadania dalej moga wykonac sie na niej.
- Jesli nie ma zadnej stacji, alpha moze wejsc w fallback przegladarkowy.

## Uruchom stacje robocza

To jest standardowy sposob wykonywania zadan w Agent Managerze.

| System | Uruchomienie | Aktualizacja | Diagnostyka |
|--------|--------------|--------------|-------------|
| Windows 10/11 | dwuklik [start.bat](start.bat) | dwuklik [Aktualizuj.bat](Aktualizuj.bat) | `start.bat --doctor --no-pause` |
| macOS | dwuklik [start.command](start.command) | dwuklik [Aktualizuj.command](Aktualizuj.command) | `./start.sh --doctor` |
| Linux | `./start.sh` | `./update.sh` | `./start.sh --doctor` |

Po pierwszym starcie:

1. W panelu wygeneruj token instalacyjny w widoku **Stacje robocze**.
2. Wklej token przy pierwszym uruchomieniu launchera.
3. Zostaw okno launchera otwarte, kiedy komputer ma wykonywac zadania.
4. Wroc do panelu i sprawdz, czy stacja pojawila sie jako online.

Na Windowsie launcher moze sam pobrac portable Node.js, jesli nie ma go w PATH.

`local-ai-proxy/config.json` jest plikiem lokalnym i nie powinien trafic do gita. Przyklad bez sekretow masz w [local-ai-proxy/config.example.json](local-ai-proxy/config.example.json).

## Aktualizacja

Najprostsza sciezka:

- Windows: [Aktualizuj.bat](Aktualizuj.bat)
- macOS: [Aktualizuj.command](Aktualizuj.command)
- Linux: `./update.sh`

Aktualizator:

- w repo git robi bezpieczne `git pull --ff-only`,
- w instalacji z ZIP-a pobiera najnowszy kod z GitHuba,
- zachowuje lokalne `config.json`, modele, binarki i logi,
- nie nadpisuje lokalnych zmian po cichu.

Jesli wolisz terminal, mozesz tez uzyc:

```bash
./start.sh --update
```

```cmd
start.bat --update
```

## Hermes Labyrinth

Szablon **Hermes Labyrinth** pomaga rozbic polecenie na etapy: rozpoznanie, mapa, podzial rol, wykonanie, weryfikacja i raport.

To nie jest osobny tryb programu. To gotowy sposob przygotowania polecenia w tym samym panelu.

Szczegoly: [docs/product/hermes-labyrinth.md](docs/product/hermes-labyrinth.md).

## Dla wlasciciela wlasnej kopii

Jesli zakladasz wlasna kopie systemu, zacznij od [FORK_GUIDE.md](FORK_GUIDE.md).

W skrocie:

1. Zrob fork repozytorium.
2. Utworz projekt Supabase.
3. Dla nowego projektu od zera uruchom [supabase/setup_from_zero.sql](supabase/setup_from_zero.sql). Jesli aktualizujesz juz istniejaca kopie, uruchamiaj tylko nowe pliki z [supabase/migrations](supabase/migrations).
4. Wdroz funkcje z [supabase/functions](supabase/functions).
5. Dodaj `SUPABASE_URL` i `SUPABASE_ANON_KEY` do GitHub Secrets.
6. Wlacz GitHub Pages.
7. Uruchom deploy.

Deploy publikuje tylko panel `ui/`. Nie zmienia automatycznie bazy danych.

## Bezpieczenstwo alpha

- Publiczny `anon/publishable key` moze byc w frontendzie, ale dane chroni RLS.
- Konto bez jawnej roli panelowej nie powinno miec dostepu do danych aplikacji.
- `SUPABASE_SERVICE_ROLE_KEY` jest tylko dla Edge Functions, nigdy dla Pages, launchera ani `config.json`.
- Token instalacyjny stacji jest jednorazowy.
- `local-ai-proxy/config.json`, modele, binarki i logi sa lokalne i ignorowane przez git.

## Technologia

| Warstwa | Rozwiazanie |
|---------|-------------|
| Panel | GitHub Pages, vanilla JS, Tailwind CDN |
| Backend | Supabase Postgres + Realtime + Auth |
| Lokalny runtime | llama.cpp `llama-server` + Node proxy |
| Stacje | `workstation-agent.js` + launcher per system |

## Dokumentacja

| Sekcja | Plik |
|--------|------|
| Mapa dokumentacji | [docs/index.md](docs/index.md) |
| Architektura | [docs/architecture/overview.md](docs/architecture/overview.md) |
| Lokalny runtime | [local-ai-proxy/README.md](local-ai-proxy/README.md) |
| Specyfikacja UI | [docs/product/ui-spec.md](docs/product/ui-spec.md) |
| Hermes Labyrinth | [docs/product/hermes-labyrinth.md](docs/product/hermes-labyrinth.md) |
| Testy | [docs/dev/testing.md](docs/dev/testing.md) |
| Jak zrobic wlasna kopie | [FORK_GUIDE.md](FORK_GUIDE.md) |

Wewnetrzne plany rozwoju sa w [docs/internal/](docs/internal/) i nie sa potrzebne do codziennej pracy z systemem.
