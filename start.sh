#!/usr/bin/env bash
# ============================================================================
#  start.sh  —  LOKALNY RUNTIME AI dla Agent Manager
#  -------------------------------------------------------------------------
#  PLATFORMA:   macOS  +  Linux         (NIE uruchamiaj na Windows!)
#  ODPOWIEDNIK: start.bat               (← ten sam skrypt dla Windows)
#  WYMAGANIA:   bash, curl, unzip, Node.js 18+
#  -------------------------------------------------------------------------
#  Co robi:
#   1. Wykrywa OS, architekturę i GPU.
#   2. Pobiera właściwy binary llama-server z GitHub Releases llama.cpp.
#   3. Pyta o model (link HF lub ścieżka lokalna) — tylko przy pierwszym starcie.
#   4. Uruchamia llama-server na :8080 i Node proxy na :3001.
#   5. Sprząta procesy przy Ctrl+C.
#
#  Flagi:
#    --change-model   wymusza ponowne pytanie o model
#    --reset          usuwa config.json (i pyta od nowa)
#    --no-pull        pomija pobieranie binary/modelu (do testów)
# ============================================================================

set -euo pipefail

# --- Stałe ścieżek ----------------------------------------------------------
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$ROOT_DIR/local-ai-proxy"
BIN_DIR="$PROXY_DIR/bin"
MODELS_DIR="$PROXY_DIR/models"
LOGS_DIR="$PROXY_DIR/logs"
CONFIG_FILE="$PROXY_DIR/config.json"

LLAMA_PORT=8080
PROXY_PORT=3001

mkdir -p "$BIN_DIR" "$MODELS_DIR" "$LOGS_DIR"

# --- Parsowanie flag --------------------------------------------------------
CHANGE_MODEL=0
NO_PULL=0
for arg in "$@"; do
  case "$arg" in
    --change-model) CHANGE_MODEL=1 ;;
    --reset)        rm -f "$CONFIG_FILE"; echo "[start] Usunięto config.json." ;;
    --no-pull)      NO_PULL=1 ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# --- Pomocnicze logowanie ---------------------------------------------------
log()  { printf '\033[1;34m[start]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; }

# --- Banner startowy --------------------------------------------------------
# Duży, widoczny komunikat: który skrypt i dla jakiego OS.
print_banner() {
  local os_label
  case "$(uname -s)" in
    Darwin*) os_label="macOS  ($(uname -m))" ;;
    Linux*)  os_label="Linux  ($(uname -m))" ;;
    *)       os_label="$(uname -s) — NIEOBSŁUGIWANY (użyj start.bat na Windows)" ;;
  esac
  printf '\n'
  printf '\033[1;36m╔══════════════════════════════════════════════════════════╗\033[0m\n'
  printf '\033[1;36m║\033[0m  \033[1mAgent Manager — LOKALNY RUNTIME AI\033[0m                          \033[1;36m║\033[0m\n'
  printf '\033[1;36m╠══════════════════════════════════════════════════════════╣\033[0m\n'
  printf '\033[1;36m║\033[0m  Skrypt:    \033[1mstart.sh\033[0m   (na Windows użyj \033[1mstart.bat\033[0m)\n'
  printf '\033[1;36m║\033[0m  Platforma: \033[1m%s\033[0m\n' "$os_label"
  printf '\033[1;36m║\033[0m  Pomoc:     ./start.sh --help     │   Zatrzymanie: Ctrl+C\n'
  printf '\033[1;36m╚══════════════════════════════════════════════════════════╝\033[0m\n\n'

  # Twardy guard: na Windowsie użytkownik powinien użyć start.bat.
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      err "Wykryto Windows. Ten skrypt jest dla macOS/Linux. Uruchom: start.bat"
      exit 1
      ;;
  esac
}
print_banner

# --- Detekcja OS / arch / GPU ----------------------------------------------

detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)  echo "linux" ;;
    *)       echo "unknown" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64|amd64)  echo "x64" ;;
    *)             echo "unknown" ;;
  esac
}

# Zwraca jedno z: cuda | rocm | vulkan | metal | cpu
detect_gpu() {
  local os="$1" arch="$2"
  if [ "$os" = "macos" ] && [ "$arch" = "arm64" ]; then
    echo "metal"; return
  fi
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    echo "cuda"; return
  fi
  if command -v rocm-smi >/dev/null 2>&1 && rocm-smi >/dev/null 2>&1; then
    echo "rocm"; return
  fi
  if command -v vulkaninfo >/dev/null 2>&1 && vulkaninfo >/dev/null 2>&1; then
    echo "vulkan"; return
  fi
  echo "cpu"
}

# Mapuje (os,arch,gpu) → wzorzec nazwy assetu w GitHub Releases llama.cpp.
# Nazewnictwo bywa zmienne — tabela jest celowo przybliżona; skrypt wybiera
# pierwszy asset z tagu `latest` którego nazwa zawiera wszystkie tokeny.
asset_tokens() {
  local os="$1" arch="$2" gpu="$3"
  case "$os" in
    macos)
      if [ "$arch" = "arm64" ]; then echo "macos arm64"
      else                            echo "macos x64"; fi ;;
    linux)
      case "$gpu" in
        cuda)   echo "ubuntu x64 cuda" ;;
        rocm)   echo "ubuntu x64 hip" ;;
        vulkan) echo "ubuntu x64 vulkan" ;;
        *)      if [ "$arch" = "arm64" ]; then echo "ubuntu arm64"; else echo "ubuntu x64"; fi ;;
      esac ;;
    *)
      echo "ubuntu x64" ;;
  esac
}

# --- Pobieranie binary llama-server -----------------------------------------

llama_binary_path() {
  if [ "$(detect_os)" = "macos" ] || [ "$(detect_os)" = "linux" ]; then
    echo "$BIN_DIR/llama-server"
  else
    echo "$BIN_DIR/llama-server.exe"
  fi
}

download_binary() {
  local os arch gpu
  os="$(detect_os)"; arch="$(detect_arch)"; gpu="$(detect_gpu "$os" "$arch")"
  log "Wykryto: OS=$os arch=$arch GPU=$gpu"

  local target
  target="$(llama_binary_path)"
  if [ -x "$target" ] && [ "$NO_PULL" = "0" ]; then
    log "llama-server już jest w $target — pomijam pobieranie."
    echo "$gpu"
    return
  fi
  if [ "$NO_PULL" = "1" ]; then
    log "[--no-pull] Pomijam pobieranie binary."
    echo "$gpu"
    return
  fi

  local tokens
  tokens="$(asset_tokens "$os" "$arch" "$gpu")"
  log "Szukam najnowszego releasu llama.cpp dla: $tokens"

  local api="https://api.github.com/repos/ggerganov/llama.cpp/releases/latest"
  local asset_url
  asset_url="$(curl -fsSL "$api" \
    | grep -Eo '"browser_download_url": *"[^"]+\.zip"' \
    | sed 's/.*"\(https:[^"]*\)".*/\1/' \
    | while read -r url; do
        match=1
        for t in $tokens; do
          case "$url" in *"$t"*) ;; *) match=0; break ;; esac
        done
        [ "$match" = "1" ] && echo "$url" && break
      done | head -n1)"

  if [ -z "$asset_url" ]; then
    err "Nie znalazłem assetu pasującego do tokenów: $tokens"
    err "Sprawdź ręcznie: https://github.com/ggerganov/llama.cpp/releases"
    exit 1
  fi

  log "Pobieram: $asset_url"
  local tmpzip="$BIN_DIR/_llama.zip"
  curl -fsSL --progress-bar -o "$tmpzip" "$asset_url"

  log "Rozpakowuję do $BIN_DIR"
  ( cd "$BIN_DIR" && unzip -oq "$tmpzip" )
  rm -f "$tmpzip"

  # Znajdź wykonywalny llama-server gdziekolwiek po rozpakowaniu i zlinkuj
  local found
  found="$(find "$BIN_DIR" -type f -name 'llama-server*' -perm -u+x 2>/dev/null | head -n1 || true)"
  if [ -z "$found" ]; then
    found="$(find "$BIN_DIR" -type f -name 'llama-server*' 2>/dev/null | head -n1 || true)"
    [ -n "$found" ] && chmod +x "$found"
  fi
  if [ -z "$found" ]; then
    err "Po rozpakowaniu nie znaleziono pliku llama-server* w $BIN_DIR"
    exit 1
  fi
  if [ "$found" != "$target" ]; then
    ln -sf "$found" "$target"
  fi

  log "Binary gotowy: $target"
  echo "$gpu"
}

# --- Konfiguracja modelu ----------------------------------------------------

prompt_model() {
  echo
  echo "=========================================================="
  echo "  Wybierz model GGUF do uruchomienia"
  echo "=========================================================="
  echo "  Opcja A: wklej URL .gguf z HuggingFace"
  echo "          (np. https://huggingface.co/.../model.gguf)"
  echo "  Opcja B: wklej ścieżkę do lokalnego pliku .gguf"
  echo
  read -r -p "Twój wybór: " input
  if [ -z "$input" ]; then
    err "Pusty wybór. Anulowane."
    exit 1
  fi

  local model_path
  if [[ "$input" == http*://* ]]; then
    local filename
    filename="$(basename "${input%%\?*}")"
    model_path="$MODELS_DIR/$filename"
    if [ -f "$model_path" ] && [ "$NO_PULL" = "0" ]; then
      log "Plik $filename już istnieje — pomijam pobieranie."
    elif [ "$NO_PULL" = "1" ]; then
      log "[--no-pull] Pomijam pobieranie modelu."
    else
      log "Pobieram model do $model_path (to może chwilę potrwać)…"
      curl -L --progress-bar -o "$model_path" "$input"
    fi
  else
    if [ ! -f "$input" ]; then
      err "Plik nie istnieje: $input"
      exit 1
    fi
    if [[ "$input" != *.gguf ]]; then
      warn "Plik nie ma rozszerzenia .gguf — kontynuuję mimo to."
    fi
    model_path="$MODELS_DIR/$(basename "$input")"
    ln -sf "$input" "$model_path"
    log "Utworzono symlink: $model_path -> $input"
  fi

  echo "$model_path"
}

ensure_config() {
  local gpu="$1"
  if [ "$CHANGE_MODEL" = "1" ] || [ ! -f "$CONFIG_FILE" ]; then
    local model_path
    model_path="$(prompt_model)"
    cat > "$CONFIG_FILE" <<JSON
{
  "proxyPort": $PROXY_PORT,
  "llamaPort": $LLAMA_PORT,
  "llamaUrl": "http://127.0.0.1:$LLAMA_PORT",
  "modelPath": "$model_path",
  "modelName": "$(basename "$model_path")",
  "backend": "$gpu"
}
JSON
    log "Zapisano config.json"
  else
    log "Używam zapisanego modelu z config.json (zmień: ./start.sh --change-model)"
  fi
}

read_config_value() {
  # Bardzo prosty parser — wyciąga wartość prostego klucza string/number.
  local key="$1"
  grep -Eo "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$CONFIG_FILE" 2>/dev/null \
    | head -n1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/"
}

# --- Sprawdzenie portów -----------------------------------------------------

# Czy na danym porcie odpowiada już llama-server? (porozumienie z /health)
is_llama_server_on() {
  local port="$1"
  curl -fs --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null \
    | grep -qi 'status\|slots_idle\|ok'
}

# Co stoi na porcie? Zwraca 'free' | 'llama' | 'other'.
port_state() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1 || ! lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "free"; return
  fi
  if is_llama_server_on "$port"; then echo "llama"; else echo "other"; fi
}

# Znajdź wolny port w zakresie startując od podanego.
find_free_port() {
  local p="$1" max="$((p + 50))"
  while [ "$p" -lt "$max" ]; do
    [ "$(port_state "$p")" = "free" ] && { echo "$p"; return; }
    p=$((p + 1))
  done
  echo ""
}

# Decyzja co zrobić z portem 8080 (llama). Modyfikuje globalne LLAMA_PORT
# i ustawia REUSE_LLAMA=1 jeśli reużywamy istniejącego serwera.
resolve_llama_port() {
  REUSE_LLAMA=0
  local state
  state="$(port_state "$LLAMA_PORT")"
  case "$state" in
    free)
      log "Port $LLAMA_PORT wolny."
      ;;
    llama)
      warn "Na porcie $LLAMA_PORT już działa llama-server — reużywam go (nie startuję nowego)."
      REUSE_LLAMA=1
      ;;
    other)
      warn "Port $LLAMA_PORT zajęty przez INNY proces. Szukam wolnego portu…"
      local alt; alt="$(find_free_port 8090)"
      if [ -z "$alt" ]; then
        err "Nie znalazłem wolnego portu w zakresie 8090-8139."
        err "Sprawdź co stoi na 8080:  lsof -iTCP:$LLAMA_PORT -sTCP:LISTEN"
        exit 1
      fi
      LLAMA_PORT="$alt"
      log "Llama-server uruchomię na alternatywnym porcie: $LLAMA_PORT"
      ;;
  esac
}

# Decyzja co zrobić z portem 3001 (proxy). Aktualizuje globalne PROXY_PORT.
resolve_proxy_port() {
  if [ "$(port_state "$PROXY_PORT")" != "free" ]; then
    warn "Port $PROXY_PORT zajęty. Szukam wolnego portu dla proxy…"
    local alt; alt="$(find_free_port 3002)"
    if [ -z "$alt" ]; then
      err "Nie znalazłem wolnego portu dla proxy w zakresie 3002-3051."
      exit 1
    fi
    PROXY_PORT="$alt"
    log "Proxy uruchomię na alternatywnym porcie: $PROXY_PORT"
    warn "UWAGA: ai-client.js w przeglądarce szuka proxy pod 127.0.0.1:3001."
    warn "Jeśli badge 'AI lokalny' nie zapali się, zwolnij port 3001 i zrestartuj."
  fi
}

# --- Uruchomienie procesów --------------------------------------------------

start_llama() {
  local model_path="$1" gpu="$2"
  local bin
  bin="$(llama_binary_path)"
  local extra_args=()

  # Heurystyka: pełny GPU offload na akceleratorach, CPU dla fallbacku
  case "$gpu" in
    metal|cuda|rocm|vulkan) extra_args+=( --n-gpu-layers 999 ) ;;
  esac

  log "Uruchamiam llama-server (port $LLAMA_PORT, model $(basename "$model_path"))"
  nohup "$bin" \
    --model "$model_path" \
    --host 127.0.0.1 \
    --port "$LLAMA_PORT" \
    --ctx-size 4096 \
    "${extra_args[@]}" \
    >"$LOGS_DIR/llama-server.log" 2>&1 &
  echo $! > "$LOGS_DIR/llama.pid"
}

start_proxy() {
  if ! command -v node >/dev/null 2>&1; then
    err "Brak Node.js w PATH. Zainstaluj Node 18+: https://nodejs.org"
    exit 1
  fi
  log "Uruchamiam proxy na porcie $PROXY_PORT"
  nohup node "$PROXY_DIR/proxy.js" \
    >"$LOGS_DIR/proxy.log" 2>&1 &
  echo $! > "$LOGS_DIR/proxy.pid"
}

wait_for_health() {
  local url="$1" name="$2" max="${3:-60}"
  log "Czekam aż $name odpowie na $url (max ${max}s)…"
  for _ in $(seq 1 "$max"); do
    if curl -fs "$url" >/dev/null 2>&1; then
      log "$name gotowy."
      return 0
    fi
    sleep 1
  done
  err "$name nie odpowiedział w czasie ${max}s. Sprawdź log: $LOGS_DIR/${name}.log"
  return 1
}

cleanup() {
  log "Sprzątam procesy…"
  for pidfile in "$LOGS_DIR/llama.pid" "$LOGS_DIR/proxy.pid"; do
    if [ -f "$pidfile" ]; then
      local pid; pid="$(cat "$pidfile")"
      kill "$pid" 2>/dev/null || true
      rm -f "$pidfile"
    fi
  done
}
trap cleanup EXIT INT TERM

REUSE_LLAMA=0

# --- Main -------------------------------------------------------------------

resolve_llama_port    # może zmienić LLAMA_PORT i ustawić REUSE_LLAMA
resolve_proxy_port    # może zmienić PROXY_PORT

GPU_DETECTED="$(download_binary)"
ensure_config "$GPU_DETECTED"

MODEL_PATH="$(read_config_value modelPath)"
[ -z "$MODEL_PATH" ] && { err "Brak modelPath w config.json"; exit 1; }

# Zsynchronizuj porty w config.json z aktualnymi (mogły się zmienić od ostatniego startu).
if [ -f "$CONFIG_FILE" ]; then
  # macOS sed wymaga -i ''
  sed -i '' -E "s|\"llamaPort\"[[:space:]]*:[[:space:]]*[0-9]+|\"llamaPort\": $LLAMA_PORT|" "$CONFIG_FILE" 2>/dev/null || \
    sed -i -E "s|\"llamaPort\"[[:space:]]*:[[:space:]]*[0-9]+|\"llamaPort\": $LLAMA_PORT|" "$CONFIG_FILE"
  sed -i '' -E "s|\"llamaUrl\"[[:space:]]*:[[:space:]]*\"[^\"]+\"|\"llamaUrl\": \"http://127.0.0.1:$LLAMA_PORT\"|" "$CONFIG_FILE" 2>/dev/null || \
    sed -i -E "s|\"llamaUrl\"[[:space:]]*:[[:space:]]*\"[^\"]+\"|\"llamaUrl\": \"http://127.0.0.1:$LLAMA_PORT\"|" "$CONFIG_FILE"
  sed -i '' -E "s|\"proxyPort\"[[:space:]]*:[[:space:]]*[0-9]+|\"proxyPort\": $PROXY_PORT|" "$CONFIG_FILE" 2>/dev/null || \
    sed -i -E "s|\"proxyPort\"[[:space:]]*:[[:space:]]*[0-9]+|\"proxyPort\": $PROXY_PORT|" "$CONFIG_FILE"
fi

if [ "$REUSE_LLAMA" = "1" ]; then
  log "Pomijam start llama-server (używam istniejącego na :$LLAMA_PORT)."
else
  start_llama "$MODEL_PATH" "$GPU_DETECTED"
  wait_for_health "http://127.0.0.1:$LLAMA_PORT/health" "llama-server" 90 || exit 1
fi

start_proxy
wait_for_health "http://127.0.0.1:$PROXY_PORT/health" "proxy" 15 || exit 1

cat <<EOF

============================================================
  Lokalny runtime AI uruchomiony.

  llama-server   http://127.0.0.1:$LLAMA_PORT
  proxy          http://127.0.0.1:$PROXY_PORT
  model          $(basename "$MODEL_PATH")
  backend        $GPU_DETECTED

  Otwórz aplikację (GitHub Pages lub ui/index.html) — frontend
  automatycznie wykryje proxy i przełączy się w tryb AI.

  Wciśnij Ctrl+C aby zatrzymać oba procesy.
============================================================

EOF

# Trzymaj skrypt aktywny — wait blokuje aż dziecko się zakończy / Ctrl+C.
if [ "$REUSE_LLAMA" = "1" ]; then
  PROXY_PID="$(cat "$LOGS_DIR/proxy.pid")"
  wait "$PROXY_PID"
else
  LLAMA_PID="$(cat "$LOGS_DIR/llama.pid")"
  PROXY_PID="$(cat "$LOGS_DIR/proxy.pid")"
  wait "$LLAMA_PID" "$PROXY_PID"
fi
