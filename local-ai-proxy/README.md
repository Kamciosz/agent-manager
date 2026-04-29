# Lokalny runtime AI

Opcjonalny moduł, który pozwala uruchomić Agent Manager z **prawdziwym, lokalnym modelem językowym** (llama.cpp + GGUF) zamiast przeglądarkowego trybu operacyjnego ze stałymi tekstami. Wszystko działa offline, bez API i bez kosztów.

```
przeglądarka (GitHub Pages)
        │  HTTP /generate
        ▼
http://127.0.0.1:3001        ← node proxy.js (ten katalog)
        │  HTTP /completion
        ▼
http://127.0.0.1:8080        ← llama-server (binary z llama.cpp)
        │  load
        ▼
plik .gguf w models/         ← model wybrany przy pierwszym starcie
```

> Przeglądarki traktują `127.0.0.1` jako **secure context** (W3C), więc strona z HTTPS może wołać HTTP localhost bez ostrzeżeń o mixed content. Dlatego nie potrzeba tu certyfikatu TLS ani service workera.

## Wymagania

- **macOS / Linux**: Node.js 18+, `bash`, `curl`, `unzip`. Apple Silicon → backend Metal, NVIDIA → CUDA, AMD → ROCm, w pozostałych przypadkach Vulkan/CPU.
- **Windows 10/11**: `cmd.exe` + PowerShell (są domyślnie). Jeśli `node` nie istnieje w PATH, `start.ps1` pobierze portable Node.js do `local-ai-proxy\bin` bez instalatora i bez uprawnień administratora. NVIDIA → CUDA, w pozostałych Vulkan/CPU.
- **Model GGUF**: dowolny plik `.gguf` z HuggingFace (np. `Qwen2.5-3B-Instruct-Q4_K_M.gguf`). Mniejsze modele (3B–7B) działają na laptopach bez GPU.

## Jak uruchomić

W katalogu głównym repo (nie tutaj) **wybierz skrypt odpowiedni dla swojego systemu operacyjnego**:

| System operacyjny | Polecenie | Plik |
|-------------------|-----------|------|
| 🍎 **macOS** — dwuklik w Finderze | dwuklik | [`start.command`](../start.command) |
| 🍎 **macOS** — z terminala | `./start.sh` | [`start.sh`](../start.sh) |
| 🐧 **Linux** (Ubuntu, Debian, Fedora, Arch…) | `./start.sh` | [`start.sh`](../start.sh) |
| 🪟 **Windows 10 / 11** — dwuklik | dwuklik | [`start.bat`](../start.bat) → [`start.ps1`](../start.ps1) |

> ⚠️ `start.sh` jest tylko dla macOS/Linux, `start.bat` tylko dla Windows. Każdy skrypt drukuje na starcie banner z nazwą systemu i odmawia startu na niewłaściwym OS.

### macOS / Linux
```bash
./start.sh
```

### Windows
```cmd
start.bat
```

Po dwukliku w Windows okno `start.bat` powinno zostać otwarte. Plik BAT nie pyta już o dane i nie uruchamia procesów przez zagnieżdżone `cmd /c`; przekazuje sterowanie do `start.ps1`. Jeśli launcher trafi na błąd, pokaże komunikat i poczeka na klawisz, żeby dało się przeczytać przyczynę. Po poprawnym starcie zostaw okno otwarte — zamknięcie konsoli może zatrzymać lokalne procesy AI.

Jeśli uruchamiasz bezpośrednio z PowerShella, użyj ścieżki względnej:

```powershell
.\start.ps1
```

Samo `start.ps1` nie działa w Windows PowerShell, bo PowerShell domyślnie nie uruchamia skryptów z bieżącego katalogu bez `./` lub `.\`.

Jeśli Windows pokazuje ostrzeżenie bezpieczeństwa dla pliku pobranego z internetu i ufasz tej kopii repo, możesz jednorazowo zdjąć blokadę:

```powershell
Unblock-File .\start.ps1
```

Skrypt **przy pierwszym uruchomieniu** zapyta o model (URL z HuggingFace lub ścieżka do lokalnego pliku `.gguf`), pobierze binary `llama-server` z [GitHub Releases llama.cpp](https://github.com/ggerganov/llama.cpp/releases/latest) i zapisze konfigurację do `local-ai-proxy/config.json`. Na Windowsie, jeśli brakuje Node.js, najpierw pobierze portable Node do `local-ai-proxy\bin`. Launcher dobiera paczkę do backendu GPU, ale jeśli upstream nie publikuje dokładnego wariantu, używa bezpiecznego fallbacku CPU zamiast przerywać start. Zapyta też jednorazowo o token instalacyjny stacji z dashboardu oraz origin aplikacji Pages, żeby `workstation-agent.js` mógł odbierać joby, a lokalny proxy wpuszczał tylko zaufaną stronę. Kolejne uruchomienia są bez pytań.

Launcher nie ma wpisanego domyślnego projektu Supabase. Wklejasz własny Project URL, publishable/anon key i token stacji wygenerowany w dashboardzie. Hasło operatora nie jest zapisywane lokalnie. Przykład konfiguracji bez sekretów: [`config.example.json`](config.example.json).

Po starcie otwórz aplikację (GitHub Pages albo `ui/index.html`). W headerze pojawi się badge:
- 🟢 **AI lokalny: <nazwa-modelu>** — proxy działa, manager/executor używają prawdziwego LLM.
- 🔵 **Panel online** — proxy nieosiągalne, panel nadal obsługuje kolejkę i używa tekstów operacyjnych.

Aplikacja sprawdza dostępność co 30 s — możesz włączać i wyłączać `start.sh` bez przeładowania strony.

## Flagi `start.sh` / `start.bat`

| Flaga | Działanie |
|------|-----------|
| `--change-model` | Zapomina aktualny model i pyta o nowy |
| `--advanced` | Otwiera konfigurację `parallelSlots`, eksperymentalnego SD i harmonogramu |
| `--config` | Otwiera terminalową konfigurację stacji/runtime: sloty, kontekst, KV cache, auto-update, SD i harmonogram |
| `--schedule` | Otwiera tylko konfigurację harmonogramu pracy stacji |
| `--doctor` | Uruchamia diagnostykę bez pobierania, promptów i startu usług |
| `--update` | Wykonuje bezpieczne `git pull --ff-only` przed startem, jeśli repo nie ma lokalnych zmian |
| `--reset` | Usuwa `config.json` i pyta od nowa |
| `--no-pull` | Pomija pobieranie binary i modelu (offline / testy) |

No-code aktualizacja:

- Windows: dwuklik [`../Aktualizuj.bat`](../Aktualizuj.bat)
- macOS/Linux: dwuklik [`../Aktualizuj.command`](../Aktualizuj.command)

Oba pliki uruchamiają bezpieczne `--update`. Jeśli repo ma lokalne zmiany, update zostanie pominięty i pokaże komunikat.

Diagnostyka jest najbezpieczniejszą ścieżką testu po `--help`:

```powershell
.\start.bat --doctor --no-pause
```

Sprawdza m.in. Node.js, porty, config, obecność `llama-server`, blokadę PowerShell `Zone.Identifier` i to, jaką paczkę llama.cpp launcher wybrałby dla aktualnego backendu. Nie pobiera modelu, nie pyta o dane i nie startuje `llama-server` ani proxy.

## Harmonogram pracy stacji

Harmonogram jest domyślnie **wyłączony**. Launcher nie ma wpisanej na sztywno żadnej godziny typu `18:00-08:00`; to tylko przykład okna nocnego, które można ustawić przez:

```bash
./start.sh --schedule
```

albo w Windows:

```cmd
start.bat --schedule
```

Pola zapisywane w `config.json`:

| Pole | Znaczenie |
|------|-----------|
| `scheduleEnabled` | `true/false`, domyślnie `false` |
| `scheduleStart` / `scheduleEnd` | Godziny `HH:MM`; zakres może przechodzić przez północ, np. `18:00-08:00` |
| `scheduleOutsideAction` | `wait` lekko czeka bez ładowania modelu albo `exit` kończy launcher poza oknem |
| `scheduleEndAction` | `finish-current` nie przyjmuje nowych zleceń i kończy aktywne, albo `stop-now` zatrzymuje runtime natychmiast |
| `scheduleDumpOnStop` | Zapisuje zrzut diagnostyczny do `logs/schedule-dump-*.json` |

Poza harmonogramem launcher w trybie `wait` śpi krótkimi cyklami i **nie ładuje modelu**. Gdy okno pracy skończy się podczas działania, agent stacji przestaje pobierać nowe joby. Domyślne `finish-current` pozwala dokończyć aktywne zadanie i potem zamyka runtime; `stop-now` kończy od razu.

Zrzut harmonogramu jest tylko diagnostyczny: zawiera m.in. aktywną liczbę jobów, model, backend i ustawienia schedule. Nie jest checkpointem stanu modelu ani generowania, więc przy `stop-now` część pracy może zostać utracona.

## Terminalowy config stacji

Najwygodniejsza ścieżka konfiguracji stacji:

```bash
./start.sh --config
```

Windows:

```cmd
start.bat --config
```

`--config` zapisuje lokalne ustawienia do `local-ai-proxy/config.json`: URL Supabase, publishable key, token instalacyjny stacji, dozwolone originy aplikacji, `parallelSlots`, kontekst modelu, kompresję KV cache, auto-update, SD oraz harmonogram. Przy pierwszym starcie agent wymienia token instalacyjny na ograniczoną sesję stacji i usuwa token z configu. Wszystkie pola mają bezpieczne zakresy i są normalizowane przy starcie, więc literówka w liczbie tokenów albo zbyt duża wartość nie powinna wysadzić launchera bez czytelnego ostrzeżenia.

Najważniejsze pola bezpieczeństwa:

| Pole | Znaczenie |
|------|-----------|
| `supabaseUrl` | URL Twojego projektu Supabase |
| `supabaseAnonKey` | Publishable/anon key, nie service-role key |
| `enrollmentToken` | Jednorazowy token z dashboardu; po redeem jest usuwany z configu |
| `stationRefreshToken` | Ograniczona sesja techniczna stacji; nie jest hasłem operatora |
| `allowedOrigins` | Strony, które mogą wołać lokalny proxy, np. `https://twoj-login.github.io` |

Jeśli przenosisz stację do innego forka, uruchom `--config` i popraw `allowedOrigins`. Inaczej proxy zwróci HTTP 403 dla nieznanej strony.

## Advanced runtime

Opcje Advanced są lokalne dla konkretnej stacji roboczej i zapisują się w `local-ai-proxy/config.json`. Frontend pokazuje je w widoku **Advanced** oraz w tabeli stacji, ale nie zapisuje ich bezpośrednio do pliku na komputerze użytkownika.

### Kontekst modelu

`contextMode` określa, jak launcher przekazuje kontekst do `llama-server`:

- Domyślnie: `native`, czyli `--ctx-size 0`. To każe llama.cpp użyć natywnego kontekstu zapisanego w modelu/GGUF, zamiast hardkodować małe `4096`.
- Presety opt-in: `32k`, `64k`, `128k`, `256k` albo własna liczba tokenów.
- Zakres launchera: `1024-262144`; wartości spoza zakresu są przycinane.
- `256k` jest dostępne, ale może wymagać bardzo dużo RAM/VRAM i modelu, który realnie znosi tak długi kontekst.

### KV cache compression

`kvCacheQuantization` steruje kompresją cache K/V w `llama-server`, jeśli binary pokazuje flagi `--cache-type-k` i `--cache-type-v`:

- Domyślnie: `auto`.
- `auto` używa `f16` dla krótkiego/natywnego kontekstu i `q8_0` dla kontekstu powyżej 32k.
- Ręczne opcje: `f16`, `q8_0`, `q4_0`.
- `q8_0` zwykle jest rozsądnym kompromisem dla długiego kontekstu; `q4_0` jest bardziej agresywne i może pogorszyć jakość.

Nie ma tu osobnej magicznej flagi o nazwie `rotroqwant`; launcher używa realnych opcji llama.cpp dla KV cache. Jeśli upstream zmieni nazwy flag, runtime startuje bez kompresji i pokazuje ostrzeżenie zamiast zamykać okno bez wyjaśnienia.

### `parallelSlots`

`parallelSlots` określa, ile jobów agent stacji może próbować obsłużyć naraz.

- Domyślnie: `1`.
- Zakres w launcherze: `1-4`.
- Przy `1` stacja robi jedno zadanie i dopiero potem bierze kolejne.
- Przy `2-4` agent stacji może pobrać kilka jobów równolegle, ale każdy slot zużywa RAM/VRAM i może spowolnić pojedynczą generację.

Jeśli aktywna jest jedna stacja robocza i ma wolny slot, AI kierownik może automatycznie wybrać ją jako wykonawcę. Jeśli nie ma aktywnej stacji z wolnym slotem, przeglądarkowy executor działa jako pracownik fallbackowy, więc system nie zostaje z samym kierownikiem.

### SD / speculative decoding

SD jest domyślnie **wyłączone** (`sdEnabled: false`). To opcja eksperymentalna:

- wymaga osobnego, mniejszego draft modelu GGUF,
- wymaga kompatybilnego `llama-server`, który pokazuje odpowiednie flagi w `--help`,
- może przyspieszyć generowanie, ale na złym zestawie modeli może też je spowolnić.

Launcher zapisuje konfigurację SD tylko po świadomym wejściu w `--advanced`. Jeśli binary `llama-server` nie wspiera draft modelu, runtime startuje standardowo i wypisuje ostrzeżenie.

### Auto-update

`autoUpdate` jest domyślnie wyłączone. Możesz włączyć je w `--config`; wtedy launcher przed startem spróbuje zrobić:

```bash
git pull --ff-only
```

Tylko wtedy, gdy katalog jest czystym repo git i nie ma lokalnych zmian. Jeśli są lokalne zmiany, repo jest w detached HEAD albo zdalna historia się rozjechała, aktualizacja jest pomijana z ostrzeżeniem. Jednorazowo możesz wymusić tę samą bezpieczną próbę flagą `--update`.

## Pliki w tym katalogu

| Ścieżka | Co to |
|---------|------|
| `proxy.js` | HTTP proxy Node 18+ bez zależności (porty: in 3001 / out 8080) |
| `runtime-schedule.js` | Wspólna walidacja i obliczanie okien harmonogramu dla launcherów i agenta |
| `bin/`    | Pobrany binary `llama-server` (gitignored) |
| `models/` | Pobrane / podlinkowane pliki `.gguf` (gitignored) |
| `logs/`   | Logi z `llama-server`, proxy i agenta stacji + pliki PID |
| `config.json` | Wybrany model, porty, backend GPU, token/sesja stacji, `allowedOrigins` i opcje runtime (gitignored) |
| `config.example.json` | Bezpieczny przykład konfiguracji bez prawdziwych sekretów |

## Endpointy proxy

```
GET  /health     →  { ok, proxy, llama, model, backend, advanced }
POST /generate   →  body: { prompt, maxTokens?, temperature? }
                    response: { text, durationMs }
OPTIONS *        →  204 + nagłówki CORS dla dozwolonego Origin
```

Proxy nasłuchuje wyłącznie na `127.0.0.1` — nie jest dostępne z sieci. Dodatkowo sprawdza nagłówek `Origin`: domyślnie wpuszcza oficjalne Pages i localhost, a origin Twojego forka dodajesz przez `--config`.

## Troubleshooting

**Windows: `Missing required command: node`.** Zaktualizuj launcher. Obecny `start.ps1` nie wymaga ręcznej instalacji Node.js: przy pełnym starcie pobierze portable Node lokalnie do `local-ai-proxy\bin`. Jeśli używasz `--no-pull`, zdejmij tę flagę przy pierwszym starcie albo zainstaluj Node.js 18+ ręcznie.

**Port 8080 lub 3001 zajęty.** Skrypt zatrzyma się z komunikatem. Sprawdź proces: `lsof -iTCP:8080` (mac/Linux) lub `netstat -ano | findstr :8080` (Windows). Albo zmień `proxyPort` w `config.json`.

**`llama-server nie wystartowal w czasie`.** Zajrzyj do `local-ai-proxy/logs/llama-server.log` — najczęściej to za mało RAM-u na model (spróbuj mniejszego kwantyzowanego, np. `Q4_K_M` 3B), albo niezgodny binary (uruchom `./start.sh --no-pull` po ręcznym podmienieniu pliku w `bin/`).

**Brak GPU mimo karty NVIDIA / AMD.** Skrypt patrzy na obecność `nvidia-smi` / `rocm-smi` / `vulkaninfo` w PATH. Doinstaluj sterowniki + odpowiednie SDK.

**Pobieranie binary kończy się 404 albo nie ma paczki GPU.** Nazwy assetów llama.cpp w GitHub Releases czasem się zmieniają. Launcher próbuje wariant GPU i fallback CPU. Jeśli upstream znowu zmieni nazwy, otwórz [stronę releasów](https://github.com/ggerganov/llama.cpp/releases/latest), pobierz właściwy ZIP lub `tar.gz` ręcznie, rozpakuj do `bin/` i uruchom z `--no-pull`.

**Frontend wciąż pokazuje „Panel online".** Sprawdź `curl http://127.0.0.1:3001/health` — powinno zwracać `"ok": true`. Jeśli zwraca `"llama": "down"`, to proxy działa ale `llama-server` padł — restart `./start.sh`.

**Proxy zwraca HTTP 403 `Origin not allowed`.** Uruchom `./start.sh --config` albo `start.bat --config` i wpisz origin swojej aplikacji Pages, np. `https://twoj-login.github.io`. Nie wpisuj ścieżki `/agent-manager`, bo przeglądarka wysyła origin bez ścieżki.

**Windows: okno znika od razu.** Obecny `start.bat` powinien zawsze zostać na końcu z komunikatem. Jeśli nadal znika, uruchom z `cmd.exe` ręcznie: `start.bat --no-pull`, a potem sprawdź `local-ai-proxy\logs\start-windows.log`, `llama-server.err.log`, `proxy.err.log` i `workstation-agent.err.log`.

**PowerShell mówi, że `start.ps1` nie jest rozpoznany.** To normalne zachowanie Windows PowerShell. Uruchom `.\start.ps1` albo prościej `.\start.bat` z katalogu repo.

**PowerShell pyta, czy uruchomić skrypt pobrany z internetu.** To znacznik bezpieczeństwa Windows dla plików z ZIP-a/pobrania. Jeśli ufasz repo, uruchom `Unblock-File .\start.ps1` w katalogu projektu albo używaj `start.bat`, który startuje PowerShell z właściwą polityką wykonania.

**Launcher czeka i nie ładuje modelu.** To może być poprawne, jeśli ustawiony jest harmonogram i aktualna godzina jest poza oknem. Zmień ustawienie przez `./start.sh --schedule` albo `start.bat --schedule`.

**Aplikacja działa wolniej po podłączeniu lokalnego modelu.** AI generuje tekst dłużej niż tryb przeglądarkowy. To normalne — większy kontekst i większy model = wolniej. Pomiar w `logs/proxy.log` (Xms na request).

**Po ustawieniu 128k/256k model nie startuje albo komputer mieli dyskiem.** To prawie zawsze brak RAM/VRAM albo model bez realnego wsparcia długiego kontekstu. Uruchom `./start.sh --config` albo `start.bat --config`, wybierz `native` i zostaw KV cache na `auto`.

**Czy można zrobić lokalny kontener Windows?** Kontener Windows wymaga Windows hosta z obsługą Windows Containers/Hyper-V. Na macOS/Linux nie uruchomimy prawdziwego kontenera Windows z tym launcherem. Zamiast tego repo ma smoke test GitHub Actions na `windows-latest`, który uruchamia PowerShell/BAT w izolowanym runnerze Windows.

## Zatrzymywanie

  ```cmd
  taskkill /F /IM llama-server.exe
  taskkill /F /IM node.exe
  ```
