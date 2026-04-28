# Lokalny runtime AI

Opcjonalny moduł, który pozwala uruchomić Agent Manager z **prawdziwym, lokalnym modelem językowym** (llama.cpp + GGUF) zamiast trybu demo (sztywne teksty). Wszystko działa offline, bez API i bez kosztów.

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
| 🍎 **macOS** (Intel + Apple Silicon) | `./start.sh` | [`start.sh`](../start.sh) |
| 🐧 **Linux** (Ubuntu, Debian, Fedora, Arch…) | `./start.sh` | [`start.sh`](../start.sh) |
| 🪟 **Windows 10 / 11** | `start.bat` | [`start.bat`](../start.bat) |

> ⚠️ `start.sh` jest tylko dla macOS/Linux, `start.bat` tylko dla Windows. Każdy skrypt drukuje na starcie banner z nazwą systemu i odmawia startu na niewłaściwym OS.

### macOS / Linux
```bash
./start.sh
```

### Windows
```cmd
start.bat
```

Skrypt **przy pierwszym uruchomieniu** zapyta o model (URL z HuggingFace lub ścieżka do lokalnego pliku `.gguf`), pobierze binary `llama-server` z [GitHub Releases llama.cpp](https://github.com/ggerganov/llama.cpp/releases/latest) i zapisze konfigurację do `local-ai-proxy/config.json`. Kolejne uruchomienia są bez pytań.

Po starcie otwórz aplikację (GitHub Pages albo `ui/index.html`). W headerze pojawi się badge:
- 🟢 **AI lokalny: <nazwa-modelu>** — proxy działa, manager/executor używają prawdziwego LLM.
- 🟡 **Tryb demo (symulacja)** — proxy nieosiągalne, używane są sztywne odpowiedzi.

Aplikacja sprawdza dostępność co 30 s — możesz włączać i wyłączać `start.sh` bez przeładowania strony.

## Flagi `start.sh` / `start.bat`

| Flaga | Działanie |
|------|-----------|
| `--change-model` | Zapomina aktualny model i pyta o nowy |
| `--reset` | Usuwa `config.json` i pyta od nowa |
| `--no-pull` | Pomija pobieranie binary i modelu (offline / testy) |

## Pliki w tym katalogu

| Ścieżka | Co to |
|---------|------|
| `proxy.js` | HTTP proxy Node 18+ bez zależności (porty: in 3001 / out 8080) |
| `bin/`    | Pobrany binary `llama-server` (gitignored) |
| `models/` | Pobrane / podlinkowane pliki `.gguf` (gitignored) |
| `logs/`   | Logi z `llama-server` i proxy + pliki PID |
| `config.json` | Wybrany model, porty, backend GPU (gitignored) |

## Endpointy proxy

```
GET  /health     →  { ok, proxy, llama, model, backend }
POST /generate   →  body: { prompt, maxTokens?, temperature? }
                    response: { text }
OPTIONS *        →  204 + nagłówki CORS (Allow-Origin: *)
```

Proxy nasłuchuje wyłącznie na `127.0.0.1` — nie jest dostępne z sieci.

## Troubleshooting

**Port 8080 lub 3001 zajęty.** Skrypt zatrzyma się z komunikatem. Sprawdź proces: `lsof -iTCP:8080` (mac/Linux) lub `netstat -ano | findstr :8080` (Windows). Albo zmień `proxyPort` w `config.json`.

**`llama-server nie wystartowal w czasie`.** Zajrzyj do `local-ai-proxy/logs/llama-server.log` — najczęściej to za mało RAM-u na model (spróbuj mniejszego kwantyzowanego, np. `Q4_K_M` 3B), albo niezgodny binary (uruchom `./start.sh --no-pull` po ręcznym podmienieniu pliku w `bin/`).

**Brak GPU mimo karty NVIDIA / AMD.** Skrypt patrzy na obecność `nvidia-smi` / `rocm-smi` / `vulkaninfo` w PATH. Doinstaluj sterowniki + odpowiednie SDK.

**Pobieranie binary kończy się 404.** Nazwy assetów llama.cpp w GitHub Releases czasem się zmieniają. Otwórz [stronę releasów](https://github.com/ggerganov/llama.cpp/releases/latest), pobierz właściwy ZIP ręcznie, rozpakuj do `bin/` i uruchom z `--no-pull`.

**Frontend wciąż pokazuje „Tryb demo".** Sprawdź `curl http://127.0.0.1:3001/health` — powinno zwracać `"ok": true`. Jeśli zwraca `"llama": "down"`, to proxy działa ale `llama-server` padł — restart `./start.sh`.

**Aplikacja działa wolniej niż „demo".** AI generuje tekst dłużej niż sleep w symulacji. To normalne — większy kontekst i większy model = wolniej. Pomiar w `logs/proxy.log` (Xms na request).

## Zatrzymywanie

- macOS / Linux: `Ctrl+C` w oknie z `start.sh` (skrypt sam ubija oba procesy).
- Windows: zamknij okno `cmd`, potem:
  ```cmd
  taskkill /F /IM llama-server.exe
  taskkill /F /IM node.exe
  ```
