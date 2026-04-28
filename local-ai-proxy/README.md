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

- **Node.js 18+** (proxy używa wbudowanego `fetch` i `AbortController`).
- **macOS / Linux**: `bash`, `curl`, `unzip`. Apple Silicon → backend Metal, NVIDIA → CUDA, AMD → ROCm, w pozostałych przypadkach Vulkan/CPU.
- **Windows 10/11**: `cmd.exe` + PowerShell (są domyślnie). NVIDIA → CUDA, w pozostałych Vulkan/CPU.
- **Model GGUF**: dowolny plik `.gguf` z HuggingFace (np. `Qwen2.5-3B-Instruct-Q4_K_M.gguf`). Mniejsze modele (3B–7B) działają na laptopach bez GPU.

## Jak uruchomić

W katalogu głównym repo (nie tutaj) **wybierz skrypt odpowiedni dla swojego systemu operacyjnego**:

| System operacyjny | Polecenie | Plik |
|-------------------|-----------|------|
| 🍎 **macOS** — dwuklik w Finderze | dwuklik | [`start.command`](../start.command) |
| 🍎 **macOS** — z terminala | `./start.sh` | [`start.sh`](../start.sh) |
| 🐧 **Linux** (Ubuntu, Debian, Fedora, Arch…) | `./start.sh` | [`start.sh`](../start.sh) |
| 🪟 **Windows 10 / 11** — dwuklik | dwuklik | [`start.bat`](../start.bat) |

> ⚠️ `start.sh` jest tylko dla macOS/Linux, `start.bat` tylko dla Windows. Każdy skrypt drukuje na starcie banner z nazwą systemu i odmawia startu na niewłaściwym OS.

### macOS / Linux
```bash
./start.sh
```

### Windows
```cmd
start.bat
```

Po dwukliku w Windows okno `start.bat` powinno zostać otwarte. Jeśli launcher trafi na błąd, pokaże komunikat i poczeka na klawisz, żeby dało się przeczytać przyczynę. Po poprawnym starcie zostaw okno otwarte — zamknięcie konsoli może zatrzymać lokalne procesy AI.

Skrypt **przy pierwszym uruchomieniu** zapyta o model (URL z HuggingFace lub ścieżka do lokalnego pliku `.gguf`), pobierze binary `llama-server` z [GitHub Releases llama.cpp](https://github.com/ggerganov/llama.cpp/releases/latest) i zapisze konfigurację do `local-ai-proxy/config.json`. Zapyta też jednorazowo o dane stacji roboczej dla Supabase, żeby `workstation-agent.js` mógł odbierać joby z aplikacji. Kolejne uruchomienia są bez pytań.

Po starcie otwórz aplikację (GitHub Pages albo `ui/index.html`). W headerze pojawi się badge:
- 🟢 **AI lokalny: <nazwa-modelu>** — proxy działa, manager/executor używają prawdziwego LLM.
- 🔵 **Panel online** — proxy nieosiągalne, panel nadal obsługuje kolejkę i używa tekstów operacyjnych.

Aplikacja sprawdza dostępność co 30 s — możesz włączać i wyłączać `start.sh` bez przeładowania strony.

## Flagi `start.sh` / `start.bat`

| Flaga | Działanie |
|------|-----------|
| `--change-model` | Zapomina aktualny model i pyta o nowy |
| `--advanced` | Otwiera konfigurację `parallelSlots` i eksperymentalnego SD |
| `--reset` | Usuwa `config.json` i pyta od nowa |
| `--no-pull` | Pomija pobieranie binary i modelu (offline / testy) |

## Advanced runtime

Opcje Advanced są lokalne dla konkretnej stacji roboczej i zapisują się w `local-ai-proxy/config.json`. Frontend pokazuje je w widoku **Advanced** oraz w tabeli stacji, ale nie zapisuje ich bezpośrednio do pliku na komputerze użytkownika.

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

## Pliki w tym katalogu

| Ścieżka | Co to |
|---------|------|
| `proxy.js` | HTTP proxy Node 18+ bez zależności (porty: in 3001 / out 8080) |
| `bin/`    | Pobrany binary `llama-server` (gitignored) |
| `models/` | Pobrane / podlinkowane pliki `.gguf` (gitignored) |
| `logs/`   | Logi z `llama-server`, proxy i agenta stacji + pliki PID |
| `config.json` | Wybrany model, porty, backend GPU (gitignored) |

## Endpointy proxy

```
GET  /health     →  { ok, proxy, llama, model, backend, advanced }
POST /generate   →  body: { prompt, maxTokens?, temperature? }
                    response: { text, durationMs }
OPTIONS *        →  204 + nagłówki CORS (Allow-Origin: *)
```

Proxy nasłuchuje wyłącznie na `127.0.0.1` — nie jest dostępne z sieci.

## Troubleshooting

**Port 8080 lub 3001 zajęty.** Skrypt zatrzyma się z komunikatem. Sprawdź proces: `lsof -iTCP:8080` (mac/Linux) lub `netstat -ano | findstr :8080` (Windows). Albo zmień `proxyPort` w `config.json`.

**`llama-server nie wystartowal w czasie`.** Zajrzyj do `local-ai-proxy/logs/llama-server.log` — najczęściej to za mało RAM-u na model (spróbuj mniejszego kwantyzowanego, np. `Q4_K_M` 3B), albo niezgodny binary (uruchom `./start.sh --no-pull` po ręcznym podmienieniu pliku w `bin/`).

**Brak GPU mimo karty NVIDIA / AMD.** Skrypt patrzy na obecność `nvidia-smi` / `rocm-smi` / `vulkaninfo` w PATH. Doinstaluj sterowniki + odpowiednie SDK.

**Pobieranie binary kończy się 404.** Nazwy assetów llama.cpp w GitHub Releases czasem się zmieniają. Otwórz [stronę releasów](https://github.com/ggerganov/llama.cpp/releases/latest), pobierz właściwy ZIP ręcznie, rozpakuj do `bin/` i uruchom z `--no-pull`.

**Frontend wciąż pokazuje „Panel online".** Sprawdź `curl http://127.0.0.1:3001/health` — powinno zwracać `"ok": true`. Jeśli zwraca `"llama": "down"`, to proxy działa ale `llama-server` padł — restart `./start.sh`.

**Aplikacja działa wolniej po podłączeniu lokalnego modelu.** AI generuje tekst dłużej niż tryb przeglądarkowy. To normalne — większy kontekst i większy model = wolniej. Pomiar w `logs/proxy.log` (Xms na request).

## Zatrzymywanie

- macOS / Linux: `Ctrl+C` w oknie z `start.sh` (skrypt sam ubija oba procesy).
- Windows: zamknij okno `cmd`, potem:
  ```cmd
  taskkill /F /IM llama-server.exe
  taskkill /F /IM node.exe
  ```
