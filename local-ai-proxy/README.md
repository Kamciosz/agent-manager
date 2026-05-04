# Lokalny runtime AI

Opcjonalny moduł, który pozwala uruchomić Agent Manager z **prawdziwym, lokalnym modelem językowym** (llama.cpp + GGUF) zamiast przeglądarkowego trybu operacyjnego ze stałymi tekstami. Wszystko działa offline, bez API i bez kosztów.

Jeśli korzystasz tylko z aplikacji w przeglądarce albo nie jesteś osobą odpowiedzialną za stację roboczą, możesz ten plik pominąć.

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

## Wymagania dla stacji roboczej

- **macOS / Linux**: Node.js 20+ (zalecane 22 LTS), `bash`, `curl`, `unzip`. Apple Silicon → backend Metal, NVIDIA → CUDA, AMD → ROCm, w pozostałych przypadkach Vulkan/CPU.
- **Windows 10/11**: `cmd.exe` + PowerShell (są domyślnie). Jeśli `node` nie istnieje w PATH, `launcher\start.ps1` pobierze portable Node.js do `local-ai-proxy\bin` bez instalatora i bez uprawnień administratora. NVIDIA → CUDA, w pozostałych Vulkan/CPU.
- **Model GGUF**: dowolny plik `.gguf` z HuggingFace (np. `Qwen2.5-3B-Instruct-Q4_K_M.gguf`). Mniejsze modele (3B–7B) działają na laptopach bez GPU.

## Jak uruchomić

W katalogu głównym repo (nie tutaj) **wybierz skrypt odpowiedni dla swojego systemu operacyjnego**:

| System operacyjny | Polecenie | Plik |
|-------------------|-----------|------|
| 🍎 **macOS** — dwuklik w Finderze | dwuklik | [`start.command`](../start.command) |
| 🍎 **macOS** — z terminala | `./start.sh` | [`start.sh`](../start.sh) |
| 🐧 **Linux** (Ubuntu, Debian, Fedora, Arch…) | `./start.sh` | [`start.sh`](../start.sh) |
| 🪟 **Windows 10 / 11** — dwuklik | dwuklik | [`start.bat`](../start.bat) → [`launcher/start.ps1`](../launcher/start.ps1) |

> ⚠️ `start.sh` jest tylko dla macOS/Linux, `start.bat` tylko dla Windows. Każdy skrypt drukuje na starcie banner z nazwą systemu i odmawia startu na niewłaściwym OS.

### macOS / Linux
```bash
./start.sh
```

### Windows
```cmd
start.bat
```

Po dwukliku w Windows okno `start.bat` powinno zostać otwarte. Plik BAT nie pyta już o dane i nie uruchamia procesów przez zagnieżdżone `cmd /c`; przekazuje sterowanie do `launcher\start.ps1`. Jeśli launcher trafi na błąd, pokaże komunikat i poczeka na klawisz, żeby dało się przeczytać przyczynę. Po poprawnym starcie zostaw okno otwarte — zamknięcie konsoli może zatrzymać lokalne procesy AI.

Jeśli uruchamiasz bezpośrednio z PowerShella, użyj ścieżki względnej:

```powershell
.\launcher\start.ps1
```

Samo `launcher\start.ps1` nie działa w Windows PowerShell, bo PowerShell domyślnie nie uruchamia skryptów z bieżącego katalogu bez `./` lub `.\`.

Jeśli Windows pokazuje ostrzeżenie bezpieczeństwa dla pliku pobranego z internetu i ufasz tej kopii repo, możesz jednorazowo zdjąć blokadę:

```powershell
Unblock-File .\launcher\start.ps1
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
- macOS: dwuklik [`../Aktualizuj.command`](../Aktualizuj.command)
- Linux: `./update.sh`

Oba pliki uruchamiają bezpieczny aktualizator. W repo git robią `git pull --ff-only`, a w instalacji z ZIP-a pobierają najnowszy kod z GitHuba i zachowują `local-ai-proxy/config.json`, modele, binarki oraz logi. Jeśli repo ma lokalne zmiany, update zostanie pominięty i pokaże komunikat.

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

`--config` zapisuje lokalne ustawienia do `local-ai-proxy/config.json`: URL Supabase, publishable key, token instalacyjny stacji, dozwolone originy aplikacji, `parallelSlots`, kontekst modelu, kompresję KV cache, auto-update, SD, batching wiadomości, limit kolejki offline oraz harmonogram. Przy pierwszym starcie agent wymienia token instalacyjny na ograniczoną sesję stacji i usuwa token z configu. Wszystkie pola mają bezpieczne zakresy i są normalizowane przy starcie, więc literówka w liczbie tokenów albo zbyt duża wartość nie powinna wysadzić launchera bez czytelnego ostrzeżenia.

`generationTimeoutMs` kontroluje, jak długo lokalny proxy czeka na odpowiedź `llama-server` dla pojedynczego jobu. Domyślnie to `600000` ms, czyli 10 minut; duże modele na CPU, szczególnie 27B+, często potrzebują więcej niż kilkanaście sekund na pierwszy wynik.

Najważniejsze pola bezpieczeństwa:

| Pole | Znaczenie |
|------|-----------|
| `supabaseUrl` | URL Twojego projektu Supabase |
| `supabaseAnonKey` | Publishable/anon key, nie service-role key |
| `enrollmentToken` | Jednorazowy token z dashboardu; po redeem jest usuwany z configu |
| `stationRefreshToken` | Ograniczona sesja techniczna stacji; nie jest hasłem operatora |
| `stationMode` | `operator` dla MacBooka/panelu nauczyciela albo `classroom` dla szkolnej stacji wykonawczej |
| `allowedOrigins` | Strony, które mogą wołać lokalny proxy, np. `https://twoj-login.github.io` |

Jeśli przenosisz stację do innego forka, uruchom `--config` i popraw `allowedOrigins`. Inaczej proxy zwróci HTTP 403 dla nieznanej strony.

## Advanced runtime

Opcje Advanced są lokalne dla konkretnej stacji roboczej i zapisują się w `local-ai-proxy/config.json`. Frontend pokazuje je w widoku **Advanced** oraz w tabeli stacji, ale nie zapisuje ich bezpośrednio do pliku na komputerze użytkownika.

### Kontekst modelu

`contextMode` określa, jak launcher przekazuje kontekst do `llama-server`:

- Domyślnie: `extended` z `contextSizeTokens=65536`, czyli 64k jako minimum sensownej pracy agentowej.
- Domyślna kompresja KV cache to `q8_0`, czyli około 50% pamięci KV względem `f16`.
- Opcjonalnie: `native`, czyli `--ctx-size 0`. To każe llama.cpp użyć natywnego kontekstu zapisanego w modelu/GGUF; przy modelach 128k/256k może to wymagać ogromnej ilości RAM/VRAM i powodować `Compute error`.
- Presety opt-in: `64k`, `128k`, `256k` albo własna liczba tokenów. Wartości poniżej `64k` są podnoszone do minimum `64k`.
- Zakres launchera: `65536-262144`; wartości spoza zakresu są przycinane.
- `256k` jest dostępne, ale może wymagać bardzo dużo RAM/VRAM i modelu, który realnie znosi tak długi kontekst.

### KV cache compression

`kvCacheQuantization` steruje kompresją cache K/V w `llama-server`, jeśli binary pokazuje flagi `--cache-type-k` i `--cache-type-v`:

- Domyślnie: `q8_0`.
- `q8_0` to domyślny wybór dla 64k/128k/256k i zwykle daje około 50% zużycia pamięci KV względem `f16`.
- `auto` używa `f16` dla krótkiego/natywnego kontekstu i `q8_0` dla kontekstu powyżej 32k.
- Ręczne opcje stock llama.cpp: `f32`, `f16`, `bf16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`, `q5_0`, `q5_1`.
- Opcje RotorQuant/Planar/Iso/Turbo, tylko z kompatybilnym forkiem/binarką: `planar3`, `iso3`, `planar4`, `iso4`, `turbo3`, `turbo4`.
- Launcher przyjmuje też pary K/V: `iso3/iso3` dla mocnej kompresji symetrycznej oraz `planar3/f16` dla K-only, czyli wariantu z bardzo niskim ryzykiem jakościowym.
- `q8_0` zwykle jest rozsądnym kompromisem dla długiego kontekstu; `q4_0` jest bardziej agresywne i może pogorszyć jakość.

Dlaczego domyślnie `q8_0`, a nie RotorQuant: `q8_0` działa w stock llama.cpp, więc launcher może go bezpiecznie pakować dla Windows/macOS/Linux. RotorQuant jest lepszym kierunkiem dla mocnej kompresji długiego KV, ale wymaga zgodnej binarki; jeśli wybierzesz `iso3/iso3`, `planar3/f16`, `planar3`, `iso3`, `planar4`, `iso4`, `turbo3` albo `turbo4`, launcher sprawdzi `llama-server --help` i spadnie do `q8_0/q8_0`, gdy typ nie jest obsługiwany.

### Operator i stacje szkolne

MacBook nauczyciela powinien działać jako `stationMode=operator`. Wtedy launcher uruchamia lokalny `llama-server` i `proxy.js`, ale nie startuje `workstation-agent.js`, nie wymaga tokenu stacji i nie rejestruje MacBooka jako szkolnego komputera. Komputery uczniów/labu działają jako `stationMode=classroom`, używają tokenu z dashboardu i mogą przyjmować joby.

Panel operatora może wysyłać do stacji komendy systemowe przez `workstation_messages`: `update`, `pause`, `resume`, `refresh`, `status`, `shutdown`, `health`, `reconfigure`. Wynik wraca jako wiadomość podpisana `system`, więc w konsoli zadania i logach widać, że to odpowiedź runtime, a nie zwykły tekst modelu.

Dodatkowe komendy operacyjne:

- `health` uruchamia lokalny smoke test przez `/health/smoke` i zwraca status proxy, modelu oraz kolejki offline.
- `reconfigure` zapisuje bezpieczny, whitelisted patch runtime do lokalnego `config.json`: tryb stacji, przyjmowanie jobów, sloty, timeout, kontekst, KV cache, SD, draft model, harmonogram, porty, batching i limit kolejki offline.

Dashboard nie wysyła dowolnej komendy shell. Patch reconfigure jest ograniczony do znanych pól konfiguracyjnych i normalizowany po stronie stacji.

### Offline queue i batching

Agent stacji zapisuje wiadomości, których nie da się wysłać do Supabase, do `local-ai-proxy/logs/workstation-offline-queue.json`. Przy kolejnym heartbeat, pollingu lub starcie próbuje je wysłać ponownie paczkami.

| Pole | Znaczenie |
|------|-----------|
| `messageBatchSize` | Ile wiadomości stacja zapisuje jednym requestem do Supabase; domyślnie `10`, zakres `1-50` |
| `offlineQueueMax` | Maksymalna liczba wiadomości trzymanych lokalnie przy braku sieci; domyślnie `500`, zakres `50-5000` |

Kolejka offline nie jest miejscem na sekrety. Zawiera tylko treści wiadomości operacyjnych stacji, typ wiadomości, kierunek i znaczniki czasu. Dashboard pokazuje głębokość kolejki oraz podstawowe metryki zasobów w tabeli Advanced i monitorze stacji.

### Harmonogram pracy runtime

Dashboard pokazuje wszystkie pola harmonogramu, które zapisuje launcher:

- `scheduleEnabled`, `scheduleStart`, `scheduleEnd` określają okno, w którym model może być załadowany.
- `scheduleOutsideAction=wait` utrzymuje lekki launcher przed oknem pracy i nie ładuje modelu; `exit` kończy proces bez startu runtime.
- `scheduleEndAction=finish-current` pozwala dokończyć aktywny job i zatrzymać runtime; `stop-now` zatrzymuje od razu.
- `scheduleDumpOnStop` zapisuje diagnostyczny dump JSON w `local-ai-proxy/logs` przy stopie z harmonogramu.

To jest tryb spokojnej pracy w tle i kontroli zużycia zasobów. Proces nie jest ukrywany przed systemem operacyjnym ani administratorem urządzenia.

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

Launcher zapisuje konfigurację SD tylko po świadomym wejściu w `--advanced`. Aktualne buildy llama.cpp używają `--spec-draft-model` i `--spec-draft-n-max`; starsze buildy mogą nadal akceptować alias `--model-draft`. Jeśli binary `llama-server` nie wspiera draft modelu, runtime startuje standardowo i wypisuje ostrzeżenie.

### Auto-update

`autoUpdate` jest domyślnie wyłączone. Możesz włączyć je w `--config`; wtedy launcher przed startem spróbuje zrobić:

```bash
git pull --ff-only
```

Tylko wtedy, gdy katalog jest czystym repo git i nie ma lokalnych zmian. Jeśli są lokalne zmiany, repo jest w detached HEAD albo zdalna historia się rozjechała, aktualizacja jest pomijana z ostrzeżeniem. Jednorazowo możesz wymusić tę samą bezpieczną próbę flagą `--update`. Instalacje z ZIP-a aktualizuj plikiem `Aktualizuj`, bo on ma ścieżkę pobierania paczki z GitHuba.

## Pliki w tym katalogu

| Ścieżka | Co to |
|---------|------|
| `proxy.js` | HTTP proxy Node 20+ bez zależności (porty: in 3001 / out 8080) |
| `runtime-schedule.js` | Wspólna walidacja i obliczanie okien harmonogramu dla launcherów i agenta |
| `bin/`    | Pobrany binary `llama-server` (gitignored) |
| `models/` | Pobrane / podlinkowane pliki `.gguf` (gitignored) |
| `logs/`   | Logi z `llama-server`, proxy i agenta stacji + pliki PID |
| `config.json` | Wybrany model, porty, backend GPU, token/sesja stacji, `allowedOrigins` i opcje runtime (gitignored) |
| `config.example.json` | Bezpieczny przykład konfiguracji bez prawdziwych sekretów |

## Endpointy proxy

```
GET  /health       →  { ok, proxy, llama, model, backend, advanced }
GET  /health/smoke →  { ok, text, durationMs, model, backend }
GET  /metrics      →  { activeRequests, queuedRequests, totalRequests, failedRequests, recent }
GET  /models       →  { models, capabilities }
POST /generate     →  body: { prompt, maxTokens?, temperature? }
                      response: { text, requestId, workflowMode, durationMs, queueWaitMs, outputTokens, tokensPerSecond }
POST /v1/chat/completions → OpenAI-compatible (bez streamingu); body: { model?, messages, max_tokens?, temperature? }
POST /cancel/:requestId   → 200 { ok:true } gdy aktywny request został przerwany przez AbortController
OPTIONS *          →  204 + nagłówki CORS dla dozwolonego Origin
```

Proxy nasłuchuje wyłącznie na `127.0.0.1` — nie jest dostępne z sieci. Dodatkowo sprawdza nagłówek `Origin`: domyślnie wpuszcza oficjalne Pages i localhost, a origin Twojego forka dodajesz przez `--config`.

`/health/smoke` wysyła do lokalnego modelu bardzo krótki prompt z oczekiwaną odpowiedzią `OK`. Służy do szybkiego sprawdzenia, czy proxy nie tylko działa, ale potrafi faktycznie wygenerować odpowiedź przez `llama-server`.

`/generate` przechodzi przez lokalną kolejkę ograniczoną przez `parallelSlots`. Proxy zapisuje w pamięci procesu ostatnie metryki: `requestId`, tryb routingu (`workflowMode`), czas w kolejce, przybliżone tokeny wejścia/wyjścia i tok/s. To nie jest płatny monitoring ani zewnętrzny serwer; dane żyją lokalnie i znikają po restarcie procesu.

Agent stacji pobiera joby przez Supabase RPC `claim_workstation_jobs`, które robi atomowy claim z `FOR UPDATE SKIP LOCKED`. Job przechodzi przez statusy `queued` → `leased` → `running` → `done`; błędy zadania trafiają w `retrying` z backoffem albo `dead_letter`, gdy skończą się próby. Awarie lokalnego runtime (`Local proxy HTTP 502`, `llama-server timeout`, niedostępny proxy/model) są traktowane jako problem stacji, nie zadania: baza cofa taki job do `retrying`, nie zwiększa `retry_count`, oznacza stację offline i blokuje claim na czas backoffu. Lease wygasa domyślnie po `900` sekundach i może zostać odzyskany po crashu procesu bez spalania prób.

Każdy `POST /generate` i `POST /v1/chat/completions` rejestruje się w mapie aktywnych requestów po `requestId`; `POST /cancel/<id>` przerywa go przez `AbortController` i zwraca 499 do oryginalnego klienta. Pełne metryki request-po-request lądują w `local-ai-proxy/logs/proxy-requests.jsonl`; plik rotuje się automatycznie po przekroczeniu 5 MB do `proxy-requests.jsonl.<timestamp>.bak` w tym samym katalogu.

## Troubleshooting

**Windows: `Missing required command: node`.** Zaktualizuj launcher. Obecny `launcher\start.ps1` nie wymaga ręcznej instalacji Node.js: przy pełnym starcie pobierze portable Node lokalnie do `local-ai-proxy\bin`. Jeśli używasz `--no-pull`, zdejmij tę flagę przy pierwszym starcie albo zainstaluj Node.js 20+ ręcznie.

**Port 8080 lub 3001 zajęty.** Skrypt zatrzyma się z komunikatem. Sprawdź proces: `lsof -iTCP:8080` (mac/Linux) lub `netstat -ano | findstr :8080` (Windows). Albo zmień `proxyPort` w `config.json`.

**`llama-server nie wystartowal w czasie`.** Zajrzyj do `local-ai-proxy/logs/llama-server.log` — najczęściej to za mało RAM-u na model (spróbuj mniejszego kwantyzowanego, np. `Q4_K_M` 3B), albo niezgodny binary (uruchom `./start.sh --no-pull` po ręcznym podmienieniu pliku w `bin/`).

**Brak GPU mimo karty NVIDIA / AMD.** Skrypt patrzy na obecność `nvidia-smi` / `rocm-smi` / `vulkaninfo` w PATH. Doinstaluj sterowniki + odpowiednie SDK.

**Pobieranie binary kończy się 404 albo nie ma paczki GPU.** Nazwy assetów llama.cpp w GitHub Releases czasem się zmieniają. Launcher próbuje wariant GPU i fallback CPU. Jeśli upstream znowu zmieni nazwy, otwórz [stronę releasów](https://github.com/ggerganov/llama.cpp/releases/latest), pobierz właściwy ZIP lub `tar.gz` ręcznie, rozpakuj do `bin/` i uruchom z `--no-pull`.

**Frontend wciąż pokazuje „Panel online".** Sprawdź `curl http://127.0.0.1:3001/health` — powinno zwracać `"ok": true`. Jeśli zwraca `"llama": "down"`, to proxy działa ale `llama-server` padł — restart `./start.sh`.

**Proxy zwraca HTTP 403 `Origin not allowed`.** Uruchom `./start.sh --config` albo `start.bat --config` i wpisz origin swojej aplikacji Pages, np. `https://twoj-login.github.io`. Nie wpisuj ścieżki `/agent-manager`, bo przeglądarka wysyła origin bez ścieżki.

**Windows: okno znika od razu.** Obecny `start.bat` powinien zawsze zostać na końcu z komunikatem. Jeśli nadal znika, uruchom z `cmd.exe` ręcznie: `start.bat --no-pull`, a potem sprawdź `local-ai-proxy\logs\start-windows.log`, `llama-server.err.log`, `proxy.err.log` i `workstation-agent.err.log`.

**PowerShell mówi, że `launcher\start.ps1` nie jest rozpoznany.** To normalne zachowanie Windows PowerShell. Uruchom `.\launcher\start.ps1` albo prościej `.\start.bat` z katalogu repo.

**PowerShell pyta, czy uruchomić skrypt pobrany z internetu.** To znacznik bezpieczeństwa Windows dla plików z ZIP-a/pobrania. Jeśli ufasz repo, uruchom `Unblock-File .\launcher\start.ps1` w katalogu projektu albo używaj `start.bat`, który startuje PowerShell z właściwą polityką wykonania.

**Launcher czeka i nie ładuje modelu.** To może być poprawne, jeśli ustawiony jest harmonogram i aktualna godzina jest poza oknem. Zmień ustawienie przez `./start.sh --schedule` albo `start.bat --schedule`.

**Aplikacja działa wolniej po podłączeniu lokalnego modelu.** AI generuje tekst dłużej niż tryb przeglądarkowy. To normalne — większy kontekst i większy model = wolniej. Pomiar w `logs/proxy.log` (Xms na request).

**Po ustawieniu native/128k/256k model nie startuje, zwraca `Compute error` albo komputer mieli dyskiem.** To prawie zawsze brak RAM/VRAM albo model bez realnego wsparcia długiego kontekstu. Uruchom `./start.sh --config` albo `start.bat --config`, wybierz `64k` i zostaw KV cache na `q8_0`.

**Czy można zrobić lokalny kontener Windows?** Kontener Windows wymaga Windows hosta z obsługą Windows Containers/Hyper-V. Na macOS/Linux nie uruchomimy prawdziwego kontenera Windows z tym launcherem. Zamiast tego repo ma smoke test GitHub Actions na `windows-latest`, który uruchamia PowerShell/BAT w izolowanym runnerze Windows.

## Zatrzymywanie

  ```cmd
  taskkill /F /IM llama-server.exe
  taskkill /F /IM node.exe
  ```
