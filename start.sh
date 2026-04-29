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
#    --advanced       otwiera konfigurację opcji zaawansowanych
#    --config         otwiera terminalową konfigurację stacji/runtime
#    --schedule       otwiera konfigurację harmonogramu pracy runtime
#    --doctor         uruchamia diagnostykę bez pobierania, promptów i usług
#    --update         wykonuje bezpieczne git pull --ff-only przed startem
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
DEFAULT_SUPABASE_URL=""
DEFAULT_SUPABASE_KEY=""
DEFAULT_APP_ORIGIN="https://kamciosz.github.io"

# --- Parsowanie flag --------------------------------------------------------
CHANGE_MODEL=0
ADVANCED_CONFIG=0
CONFIG_MODE=0
SCHEDULE_CONFIG=0
DOCTOR_MODE=0
UPDATE_NOW=0
NO_PULL=0
for arg in "$@"; do
  case "$arg" in
    --change-model) CHANGE_MODEL=1 ;;
    --advanced)     ADVANCED_CONFIG=1; SCHEDULE_CONFIG=1 ;;
    --config)       CONFIG_MODE=1; ADVANCED_CONFIG=1; SCHEDULE_CONFIG=1 ;;
    --schedule)     SCHEDULE_CONFIG=1 ;;
    --doctor)       DOCTOR_MODE=1 ;;
    --update)       UPDATE_NOW=1 ;;
    --reset)        rm -f "$CONFIG_FILE"; echo "[start] Usunięto config.json." ;;
    --no-pull)      NO_PULL=1 ;;
    -h|--help)
      sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# --- Pomocnicze logowanie ---------------------------------------------------
log()  { printf '\033[1;34m[start]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[err]\033[0m %s\n' "$*" >&2; }

require_command() {
  local command_name="$1" install_hint="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    err "Brak wymaganego programu: $command_name"
    err "$install_hint"
    exit 1
  fi
}

ensure_workspace_dirs() {
  mkdir -p "$BIN_DIR" "$MODELS_DIR" "$LOGS_DIR"
}

check_base_requirements() {
  require_command curl "Zainstaluj curl i uruchom skrypt ponownie."
  require_command node "Zainstaluj Node.js 18+: https://nodejs.org"
}

run_safe_update() {
  local reason="$1" branch local_hash remote_ref remote_hash merge_base
  if ! command -v git >/dev/null 2>&1; then
    warn "Aktualizacja $reason pominięta: git nie jest dostępny w PATH."
    return 0
  fi
  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    warn "Aktualizacja $reason pominięta: katalog nie wygląda jak repo git."
    return 0
  fi
  if ! git -C "$ROOT_DIR" diff --quiet --ignore-submodules -- || ! git -C "$ROOT_DIR" diff --cached --quiet --ignore-submodules --; then
    warn "Aktualizacja $reason pominięta: są lokalne zmiany. Zrób commit/stash albo git pull ręcznie."
    return 0
  fi

  branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    warn "Aktualizacja $reason pominięta: repo nie jest na normalnej gałęzi."
    return 0
  fi

  log "Sprawdzam aktualizacje launchera ($reason)…"
  if ! git -C "$ROOT_DIR" fetch --quiet origin "$branch"; then
    warn "Nie udało się pobrać informacji o origin/$branch. Startuję z lokalną wersją."
    return 0
  fi

  local_hash="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  remote_ref="origin/$branch"
  remote_hash="$(git -C "$ROOT_DIR" rev-parse "$remote_ref" 2>/dev/null || true)"
  if [ -z "$remote_hash" ]; then
    warn "Brak zdalnej gałęzi $remote_ref. Aktualizacja pominięta."
    return 0
  fi
  if [ "$local_hash" = "$remote_hash" ]; then
    log "Launcher jest aktualny."
    return 0
  fi

  merge_base="$(git -C "$ROOT_DIR" merge-base HEAD "$remote_ref" 2>/dev/null || true)"
  if [ "$merge_base" != "$local_hash" ]; then
    warn "Aktualizacja $reason pominięta: lokalna historia różni się od $remote_ref. Użyj git pull ręcznie."
    return 0
  fi

  if git -C "$ROOT_DIR" pull --ff-only --quiet origin "$branch"; then
    log "Zaktualizowano repo do $remote_ref. Ta sesja działa dalej; pełny efekt będzie przy następnym starcie."
  else
    warn "git pull --ff-only nie powiódł się. Startuję z lokalną wersją."
  fi
}

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

# Mapuje (os,arch,gpu) na listę preferowanych grup tokenów assetu llama.cpp.
# Kolejne wiersze są fallbackami, bo upstream zmienia nazwy i dostępne backendy.
asset_token_groups() {
  local os="$1" arch="$2" gpu="$3"
  case "$os" in
    macos)
      if [ "$arch" = "arm64" ]; then
        echo "macos arm64.tar.gz"
        echo "macos arm64"
      else
        echo "macos x64"
      fi ;;
    linux)
      case "$gpu" in
        cuda)
          echo "ubuntu x64 cuda"
          echo "ubuntu x64 vulkan"
          echo "ubuntu x64" ;;
        rocm)
          echo "ubuntu rocm x64"
          echo "ubuntu x64 rocm"
          echo "ubuntu x64 vulkan"
          echo "ubuntu x64" ;;
        vulkan)
          if [ "$arch" = "arm64" ]; then echo "ubuntu vulkan arm64"; else echo "ubuntu vulkan x64"; fi
          if [ "$arch" = "arm64" ]; then echo "ubuntu arm64"; else echo "ubuntu x64"; fi ;;
        *)
          if [ "$arch" = "arm64" ]; then echo "ubuntu arm64"; else echo "ubuntu x64"; fi ;;
      esac ;;
    *)
      echo "ubuntu x64" ;;
  esac
}

extract_release_package_urls() {
  grep -Eo '"browser_download_url": *"[^"]+(\.zip|\.tar\.gz)"' \
    | sed 's/.*"\(https:[^"]*\)".*/\1/'
}

pick_matching_url() {
  local url token matched
  while IFS= read -r url; do
    matched=1
    for token in "$@"; do
      case "$url" in
        *"$token"*) ;;
        *) matched=0; break ;;
      esac
    done
    if [ "$matched" = "1" ]; then
      printf '%s\n' "$url"
      return 0
    fi
  done
  return 1
}

pick_matching_url_from_groups() {
  local urls="$1" raw_tokens asset_url
  while IFS= read -r raw_tokens; do
    [ -z "$raw_tokens" ] && continue
    IFS=' ' read -r -a tokens <<< "$raw_tokens"
    asset_url="$(printf '%s\n' "$urls" | grep -vi '/cudart-' | pick_matching_url "${tokens[@]}")" || asset_url=""
    if [ -n "$asset_url" ]; then
      printf '%s|%s\n' "$asset_url" "$raw_tokens"
      return 0
    fi
  done
  return 1
}

backend_for_asset_url() {
  local detected_gpu="$1" asset_url="$2"
  case "$asset_url" in
    *cuda*) echo "cuda" ;;
    *rocm*|*hip*) echo "rocm" ;;
    *vulkan*) echo "vulkan" ;;
    *macos*) echo "$detected_gpu" ;;
    *) echo "cpu" ;;
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

  local token_groups
  token_groups="$(asset_token_groups "$os" "$arch" "$gpu")"
  log "Szukam najnowszego releasu llama.cpp dla: $(printf '%s' "$token_groups" | paste -sd ' -> ' -)"

  local api="https://api.github.com/repos/ggerganov/llama.cpp/releases/latest"
  local release_urls picked asset_url matched_tokens effective_gpu
  release_urls="$(curl -fsSL "$api" | extract_release_package_urls)"
  picked="$(pick_matching_url_from_groups "$release_urls" <<< "$token_groups")" || picked=""
  asset_url="${picked%%|*}"
  matched_tokens="${picked#*|}"

  if [ -z "$asset_url" ]; then
    err "Nie znalazłem assetu pasującego do żadnego fallbacku: $(printf '%s' "$token_groups" | paste -sd ' | ' -)"
    err "Sprawdź ręcznie: https://github.com/ggerganov/llama.cpp/releases"
    exit 1
  fi

  effective_gpu="$(backend_for_asset_url "$gpu" "$asset_url")"
  if [ "$effective_gpu" != "$gpu" ]; then
    warn "Brak dokładnej paczki dla backendu $gpu — używam paczki $effective_gpu ($matched_tokens)."
  fi

  log "Pobieram: $asset_url"
  local tmp_package
  case "$asset_url" in
    *.zip) tmp_package="$BIN_DIR/_llama.zip" ;;
    *.tar.gz) tmp_package="$BIN_DIR/_llama.tar.gz" ;;
    *)
      err "Nieobsługiwany format paczki llama.cpp: $asset_url"
      exit 1
      ;;
  esac
  curl -fsSL --progress-bar -o "$tmp_package" "$asset_url"

  log "Rozpakowuję do $BIN_DIR"
  case "$tmp_package" in
    *.zip)
      require_command unzip "Zainstaluj unzip albo ręcznie rozpakuj llama.cpp do $BIN_DIR i uruchom z --no-pull."
      ( cd "$BIN_DIR" && unzip -oq "$tmp_package" ) ;;
    *.tar.gz)
      require_command tar "Zainstaluj tar albo ręcznie rozpakuj llama.cpp do $BIN_DIR i uruchom z --no-pull."
      ( cd "$BIN_DIR" && tar -xzf "$tmp_package" ) ;;
  esac
  rm -f "$tmp_package"

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
  echo "$effective_gpu"
}

# --- Konfiguracja modelu ----------------------------------------------------

prompt_model() {
  {
    echo
    echo "=========================================================="
    echo "  Wybierz model GGUF do uruchomienia"
    echo "=========================================================="
    echo "  Opcja A: wklej URL .gguf z HuggingFace"
    echo "          (np. https://huggingface.co/.../model.gguf)"
    echo "  Opcja B: wklej ścieżkę do lokalnego pliku .gguf"
    echo
  } >&2
  read -r -p "Twój wybór: " input
  if [ -z "$input" ]; then
    err "Pusty wybór. Anulowane."
    exit 1
  fi

  case "$input" in
    "ollama run "*|"ollama pull "*|"ollama "*)
      err "To wygląda jak komenda Ollama, a nie plik GGUF. Wklej bezpośredni URL do pliku .gguf albo lokalną ścieżkę do pliku .gguf."
      exit 1
      ;;
  esac

  if [[ "$input" == https://huggingface.co/*\?show_file_info=*.gguf ]]; then
    local repo_url gguf_name
    repo_url="${input%%\?*}"
    gguf_name="${input##*=}"
    input="$repo_url/resolve/main/$gguf_name"
    log "Zamieniam link Hugging Face na bezpośredni URL do pliku: $gguf_name" >&2
  fi

  local model_path
  if [[ "$input" == http*://* ]]; then
    local filename
    filename="$(basename "${input%%\?*}")"
    if [[ "$filename" != *.gguf ]]; then
      err "URL musi wskazywać bezpośrednio na plik .gguf, nie na stronę modelu."
      exit 1
    fi
    model_path="$MODELS_DIR/$filename"
    if [ -f "$model_path" ] && [ "$NO_PULL" = "0" ]; then
      log "Plik $filename już istnieje — pomijam pobieranie." >&2
    elif [ "$NO_PULL" = "1" ]; then
      log "[--no-pull] Pomijam pobieranie modelu." >&2
    else
      log "Pobieram model do $model_path (to może chwilę potrwać)…" >&2
      curl -L --progress-bar -o "$model_path" "$input"
      validate_downloaded_model "$model_path"
    fi
  else
    if [ ! -f "$input" ]; then
      err "Plik nie istnieje: $input"
      exit 1
    fi
    if [[ "$input" != *.gguf ]]; then
      warn "Plik nie ma rozszerzenia .gguf — kontynuuję mimo to." >&2
    fi
    model_path="$MODELS_DIR/$(basename "$input")"
    ln -sf "$input" "$model_path"
    log "Utworzono symlink: $model_path -> $input" >&2
  fi

  echo "$model_path"
}

validate_downloaded_model() {
  local model_path="$1" magic
  if [ ! -s "$model_path" ]; then
    err "Pobrany plik modelu jest pusty: $model_path"
    exit 1
  fi
  magic="$(head -c 4 "$model_path" 2>/dev/null || true)"
  if [ "$magic" != "GGUF" ]; then
    err "Pobrany plik nie wygląda jak GGUF. To może być strona HTML zamiast modelu."
    err "Usuń błędny plik i wklej bezpośredni URL do pliku .gguf: $model_path"
    rm -f "$model_path"
    exit 1
  fi
}

prompt_with_default() {
  local label="$1" default_value="${2:-}" input
  if [ -n "$default_value" ]; then
    read -r -p "$label [$default_value]: " input
    printf '%s\n' "${input:-$default_value}"
  else
    read -r -p "$label: " input
    printf '%s\n' "$input"
  fi
}

prompt_secret_value() {
  local label="$1" value
  read -r -s -p "$label: " value
  printf '\n' >&2
  printf '%s\n' "$value"
}

sync_runtime_config_json() {
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  LLAMA_PORT_VALUE="$LLAMA_PORT" \
  PROXY_PORT_VALUE="$PROXY_PORT" \
  node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const file = process.env.CONFIG_FILE_ENV
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  cfg = {}
}
cfg.proxyPort = Number(process.env.PROXY_PORT_VALUE || cfg.proxyPort || 3001)
cfg.llamaPort = Number(process.env.LLAMA_PORT_VALUE || cfg.llamaPort || 8080)
cfg.llamaUrl = `http://127.0.0.1:${cfg.llamaPort}`
if (cfg.modelPath && !cfg.modelName) cfg.modelName = path.basename(cfg.modelPath)
cfg.parallelSlots = clampInt(cfg.parallelSlots, 1, 1, 4)
cfg.sdEnabled = cfg.sdEnabled === true
cfg.draftModelPath = typeof cfg.draftModelPath === 'string' ? cfg.draftModelPath : ''
cfg.draftModelName = typeof cfg.draftModelName === 'string' ? cfg.draftModelName : ''
if (cfg.draftModelPath && !cfg.draftModelName) cfg.draftModelName = path.basename(cfg.draftModelPath)
cfg.speculativeTokens = clampInt(cfg.speculativeTokens, 4, 1, 16)
cfg.contextMode = normalizeContextMode(cfg.contextMode)
cfg.contextSizeTokens = cfg.contextMode === 'native'
  ? 0
  : clampInt(parseTokenCount(cfg.contextSizeTokens, 262144), 262144, 1024, 262144)
cfg.kvCacheQuantization = normalizeKvCache(cfg.kvCacheQuantization)
cfg.effectiveContextSizeTokens = cfg.contextMode === 'native' ? 0 : cfg.contextSizeTokens
cfg.effectiveKvCacheQuantization = resolveKvCache(cfg.kvCacheQuantization, cfg.effectiveContextSizeTokens)
cfg.autoUpdate = cfg.autoUpdate === true
cfg.optimizationMode = cfg.sdEnabled ? 'sd-experimental' : (cfg.parallelSlots > 1 ? 'parallel' : 'standard')
if (typeof cfg.acceptsJobs !== 'boolean') cfg.acceptsJobs = true
if (typeof cfg.scheduleEnabled !== 'boolean') cfg.scheduleEnabled = false
if (!('scheduleStart' in cfg)) cfg.scheduleStart = null
if (!('scheduleEnd' in cfg)) cfg.scheduleEnd = null
if (!['wait', 'exit'].includes(cfg.scheduleOutsideAction)) cfg.scheduleOutsideAction = 'wait'
if (!['finish-current', 'stop-now'].includes(cfg.scheduleEndAction)) cfg.scheduleEndAction = 'finish-current'
cfg.scheduleDumpOnStop = cfg.scheduleDumpOnStop === true
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function parseTokenCount(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const raw = String(value).trim().toLowerCase()
  if (raw === 'native') return 0
  const shortMatch = raw.match(/^(\d+)\s*k$/)
  if (shortMatch) return Number.parseInt(shortMatch[1], 10) * 1024
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeContextMode(value) {
  return String(value || 'native').trim().toLowerCase() === 'native' ? 'native' : 'extended'
}

function normalizeKvCache(value) {
  const raw = String(value || 'auto').trim().toLowerCase()
  return ['auto', 'f16', 'q8_0', 'q4_0'].includes(raw) ? raw : 'auto'
}

function resolveKvCache(value, contextSizeTokens) {
  const normalized = normalizeKvCache(value)
  if (normalized !== 'auto') return normalized
  return Number(contextSizeTokens) > 32768 ? 'q8_0' : 'f16'
}
NODE
}

write_advanced_config() {
  local parallel_slots="$1" sd_enabled="$2" draft_model_path="$3" speculative_tokens="$4" context_mode_input="$5" context_size_input="$6" kv_cache="$7" auto_update="$8"
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  PARALLEL_SLOTS_VALUE="$parallel_slots" \
  SD_ENABLED_VALUE="$sd_enabled" \
  DRAFT_MODEL_PATH_VALUE="$draft_model_path" \
  SPECULATIVE_TOKENS_VALUE="$speculative_tokens" \
  CONTEXT_MODE_VALUE="$context_mode_input" \
  CONTEXT_SIZE_VALUE="$context_size_input" \
  KV_CACHE_VALUE="$kv_cache" \
  AUTO_UPDATE_VALUE="$auto_update" \
  node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const file = process.env.CONFIG_FILE_ENV
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  cfg = {}
}
cfg.parallelSlots = clampInt(process.env.PARALLEL_SLOTS_VALUE, 1, 1, 4)
cfg.sdEnabled = process.env.SD_ENABLED_VALUE === 'true'
cfg.draftModelPath = cfg.sdEnabled ? (process.env.DRAFT_MODEL_PATH_VALUE || '') : ''
cfg.draftModelName = cfg.draftModelPath ? path.basename(cfg.draftModelPath) : ''
cfg.speculativeTokens = clampInt(process.env.SPECULATIVE_TOKENS_VALUE, 4, 1, 16)
cfg.contextMode = normalizeContextMode(process.env.CONTEXT_MODE_VALUE)
cfg.contextSizeTokens = cfg.contextMode === 'native'
  ? 0
  : clampInt(parseTokenCount(process.env.CONTEXT_SIZE_VALUE, 262144), 262144, 1024, 262144)
cfg.kvCacheQuantization = normalizeKvCache(process.env.KV_CACHE_VALUE)
cfg.effectiveContextSizeTokens = cfg.contextMode === 'native' ? 0 : cfg.contextSizeTokens
cfg.effectiveKvCacheQuantization = resolveKvCache(cfg.kvCacheQuantization, cfg.effectiveContextSizeTokens)
cfg.autoUpdate = process.env.AUTO_UPDATE_VALUE === 'true'
cfg.optimizationMode = cfg.sdEnabled ? 'sd-experimental' : (cfg.parallelSlots > 1 ? 'parallel' : 'standard')
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function parseTokenCount(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const raw = String(value).trim().toLowerCase()
  if (raw === 'native') return 0
  const shortMatch = raw.match(/^(\d+)\s*k$/)
  if (shortMatch) return Number.parseInt(shortMatch[1], 10) * 1024
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeContextMode(value) {
  const raw = String(value || 'native').trim().toLowerCase()
  return raw === 'native' ? 'native' : 'extended'
}

function normalizeKvCache(value) {
  const raw = String(value || 'auto').trim().toLowerCase()
  return ['auto', 'f16', 'q8_0', 'q4_0'].includes(raw) ? raw : 'auto'
}

function resolveKvCache(value, contextSizeTokens) {
  const normalized = normalizeKvCache(value)
  if (normalized !== 'auto') return normalized
  return Number(contextSizeTokens) > 32768 ? 'q8_0' : 'f16'
}
NODE
}

configure_advanced_options() {
  local answer parallel_slots context_default context_choice context_mode context_size kv_cache auto_update_answer auto_update sd_answer sd_enabled draft_model_path speculative_tokens

  echo
  echo "=========================================================="
  echo "  Advanced — opcje wydajności lokalnej stacji"
  echo "=========================================================="
  echo "  Domyślnie: parallelSlots=1, kontekst=native, KV=auto, SD=off."
  echo "  Preset 256k jest dostępny, ale może wymagać dużo RAM/VRAM."
  echo "  Zwiększaj sloty tylko gdy masz zapas RAM/VRAM."
  echo "  SD jest eksperymentalne i wymaga osobnego mniejszego modelu GGUF."
  echo

  answer="$(prompt_with_default "Konfigurować Advanced teraz? (y/N)" "N")"
  case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')" in
    y|yes|t|tak) ;;
    *)
      sync_runtime_config_json
      log "Advanced: parallelSlots=$(read_config_json_value parallelSlots 1), context=$(read_config_json_value contextMode native), KV=$(read_config_json_value kvCacheQuantization auto), SD=$(read_config_json_value sdEnabled false)."
      return
      ;;
  esac

  parallel_slots="$(prompt_with_default "parallelSlots — ile jobów stacja może robić naraz (1-4)" "$(read_config_json_value parallelSlots 1)")"
  if [ "$(read_config_json_value contextMode native)" = "native" ]; then
    context_default="native"
  else
    context_default="$(read_config_json_value contextSizeTokens 262144)"
  fi
  context_choice="$(prompt_with_default "Kontekst modelu: native, 32k, 64k, 128k, 256k albo liczba tokenów" "$context_default")"
  case "$(printf '%s' "$context_choice" | tr '[:upper:]' '[:lower:]')" in
    native|natywny) context_mode="native"; context_size="0" ;;
    32k|32768) context_mode="extended"; context_size="32768" ;;
    64k|65536) context_mode="extended"; context_size="65536" ;;
    128k|131072) context_mode="extended"; context_size="131072" ;;
    256k|262144) context_mode="extended"; context_size="262144" ;;
    *) context_mode="extended"; context_size="$context_choice" ;;
  esac
  kv_cache="$(prompt_with_default "Kompresja KV cache: auto, f16, q8_0 albo q4_0" "$(read_config_json_value kvCacheQuantization auto)")"
  auto_update_answer="$(prompt_with_default "Automatycznie aktualizować launcher przy starcie? (y/N)" "$(if [ "$(read_config_json_value autoUpdate false)" = "true" ]; then echo y; else echo N; fi)")"
  case "$(printf '%s' "$auto_update_answer" | tr '[:upper:]' '[:lower:]')" in
    y|yes|t|tak) auto_update="true" ;;
    *) auto_update="false" ;;
  esac
  sd_answer="$(prompt_with_default "Włączyć SD / speculative decoding? (y/N)" "N")"
  case "$(printf '%s' "$sd_answer" | tr '[:upper:]' '[:lower:]')" in
    y|yes|t|tak) sd_enabled="true" ;;
    *) sd_enabled="false" ;;
  esac

  draft_model_path=""
  speculative_tokens="$(read_config_json_value speculativeTokens 4)"
  if [ "$sd_enabled" = "true" ]; then
    draft_model_path="$(prompt_with_default "Ścieżka do draft modelu GGUF dla SD" "$(read_config_json_value draftModelPath '')")"
    speculative_tokens="$(prompt_with_default "Speculative tokens / draft window (1-16)" "$speculative_tokens")"
    if [ -z "$draft_model_path" ]; then
      warn "SD wymaga draft modelu. Zostawiam SD wyłączone."
      sd_enabled="false"
    elif [ ! -f "$draft_model_path" ]; then
      warn "Draft model nie istnieje: $draft_model_path. Zostawiam SD wyłączone."
      sd_enabled="false"
      draft_model_path=""
    fi
  fi

  write_advanced_config "$parallel_slots" "$sd_enabled" "$draft_model_path" "$speculative_tokens" "$context_mode" "$context_size" "$kv_cache" "$auto_update"
  sync_runtime_config_json
  log "Zapisano Advanced: parallelSlots=$(read_config_json_value parallelSlots 1), context=$(read_config_json_value contextMode native)/$(read_config_json_value effectiveContextSizeTokens 0), KV=$(read_config_json_value effectiveKvCacheQuantization f16), SD=$(read_config_json_value sdEnabled false), autoUpdate=$(read_config_json_value autoUpdate false)."
}

write_schedule_config() {
  local enabled="$1" start_time="$2" end_time="$3" outside_action="$4" end_action="$5" dump_on_stop="$6"
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  SCHEDULE_ENABLED_VALUE="$enabled" \
  SCHEDULE_START_VALUE="$start_time" \
  SCHEDULE_END_VALUE="$end_time" \
  SCHEDULE_OUTSIDE_ACTION_VALUE="$outside_action" \
  SCHEDULE_END_ACTION_VALUE="$end_action" \
  SCHEDULE_DUMP_ON_STOP_VALUE="$dump_on_stop" \
  node <<'NODE'
const fs = require('node:fs')
const file = process.env.CONFIG_FILE_ENV
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  cfg = {}
}
cfg.scheduleEnabled = process.env.SCHEDULE_ENABLED_VALUE === 'true'
cfg.scheduleStart = cfg.scheduleEnabled ? process.env.SCHEDULE_START_VALUE : null
cfg.scheduleEnd = cfg.scheduleEnabled ? process.env.SCHEDULE_END_VALUE : null
cfg.scheduleOutsideAction = ['wait', 'exit'].includes(process.env.SCHEDULE_OUTSIDE_ACTION_VALUE)
  ? process.env.SCHEDULE_OUTSIDE_ACTION_VALUE
  : 'wait'
cfg.scheduleEndAction = ['finish-current', 'stop-now'].includes(process.env.SCHEDULE_END_ACTION_VALUE)
  ? process.env.SCHEDULE_END_ACTION_VALUE
  : 'finish-current'
cfg.scheduleDumpOnStop = process.env.SCHEDULE_DUMP_ON_STOP_VALUE === 'true'
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
NODE
}

is_time_value() {
  [[ "$1" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]
}

configure_schedule_options() {
  local answer start_time end_time outside_action end_action dump_answer dump_on_stop

  echo
  echo "=========================================================="
  echo "  Harmonogram — kiedy stacja może przyjmować pracę"
  echo "=========================================================="
  echo "  Domyślnie harmonogram jest wyłączony."
  echo "  Przykład okna: 18:00-08:00, ale żadna godzina nie jest hardkodowana."
  echo

  answer="$(prompt_with_default "Konfigurować harmonogram teraz? (y/N)" "N")"
  case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')" in
    y|yes|t|tak) ;;
    *)
      write_schedule_config "false" "" "" "wait" "finish-current" "false"
      log "Harmonogram wyłączony."
      return
      ;;
  esac

  start_time="$(prompt_with_default "Start HH:MM (np. 18:00)" "$(read_config_json_value scheduleStart '')")"
  end_time="$(prompt_with_default "Koniec HH:MM (np. 08:00)" "$(read_config_json_value scheduleEnd '')")"
  if ! is_time_value "$start_time" || ! is_time_value "$end_time"; then
    err "Niepoprawny czas harmonogramu. Użyj HH:MM, np. 18:00 albo 08:00."
    exit 1
  fi

  outside_action="$(prompt_with_default "Poza harmonogramem przed startem: wait czy exit" "$(read_config_json_value scheduleOutsideAction wait)")"
  case "$outside_action" in wait|exit) ;; *) outside_action="wait" ;; esac

  end_action="$(prompt_with_default "Na końcu okna: finish-current czy stop-now" "$(read_config_json_value scheduleEndAction finish-current)")"
  case "$end_action" in finish-current|stop-now) ;; *) end_action="finish-current" ;; esac

  dump_answer="$(prompt_with_default "Zapisac zrzut diagnostyczny przy stopie? (y/N)" "N")"
  case "$(printf '%s' "$dump_answer" | tr '[:upper:]' '[:lower:]')" in
    y|yes|t|tak) dump_on_stop="true" ;;
    *) dump_on_stop="false" ;;
  esac

  write_schedule_config "true" "$start_time" "$end_time" "$outside_action" "$end_action" "$dump_on_stop"
  log "Zapisano harmonogram: $start_time-$end_time, outside=$outside_action, end=$end_action, dump=$dump_on_stop."
  if [ "$dump_on_stop" = "true" ]; then
    warn "Zrzut jest diagnostyczny, nie jest checkpointem generowania; stop-now może utracić aktywną pracę."
  fi
}

upsert_workstation_config() {
  local workstation_name="$1" supabase_url="$2" supabase_key="$3" enrollment_token="$4" app_origin="$5"
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  WORKSTATION_NAME_VALUE="$workstation_name" \
  SUPABASE_URL_VALUE="$supabase_url" \
  SUPABASE_KEY_VALUE="$supabase_key" \
  ENROLLMENT_TOKEN_VALUE="$enrollment_token" \
  APP_ORIGIN_VALUE="$app_origin" \
  node <<'NODE'
const fs = require('node:fs')
const file = process.env.CONFIG_FILE_ENV
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  cfg = {}
}
cfg.workstationName = process.env.WORKSTATION_NAME_VALUE || cfg.workstationName || ''
cfg.supabaseUrl = process.env.SUPABASE_URL_VALUE || cfg.supabaseUrl || ''
cfg.supabaseAnonKey = process.env.SUPABASE_KEY_VALUE || cfg.supabaseAnonKey || ''
cfg.enrollmentToken = process.env.ENROLLMENT_TOKEN_VALUE || cfg.enrollmentToken || ''
if (cfg.enrollmentToken) {
  delete cfg.workstationEmail
  delete cfg.workstationPassword
}
const origins = new Set(Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [])
for (const origin of ['http://localhost', 'http://127.0.0.1']) origins.add(origin)
const appOrigin = (process.env.APP_ORIGIN_VALUE || '').trim().replace(/\/+$/, '')
if (appOrigin) origins.add(appOrigin)
cfg.appOrigin = appOrigin || cfg.appOrigin || ''
cfg.allowedOrigins = Array.from(origins).filter(Boolean)
if (typeof cfg.acceptsJobs !== 'boolean') cfg.acceptsJobs = true
if (typeof cfg.scheduleEnabled !== 'boolean') cfg.scheduleEnabled = false
if (!('scheduleStart' in cfg)) cfg.scheduleStart = null
if (!('scheduleEnd' in cfg)) cfg.scheduleEnd = null
if (!['wait', 'exit'].includes(cfg.scheduleOutsideAction)) cfg.scheduleOutsideAction = 'wait'
if (!['finish-current', 'stop-now'].includes(cfg.scheduleEndAction)) cfg.scheduleEndAction = 'finish-current'
cfg.scheduleDumpOnStop = cfg.scheduleDumpOnStop === true
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
NODE
}

write_model_config() {
  local model_path="$1" gpu="$2"
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  MODEL_PATH_VALUE="$model_path" \
  MODEL_NAME_VALUE="$(basename "$model_path")" \
  BACKEND_VALUE="$gpu" \
  LLAMA_PORT_VALUE="$LLAMA_PORT" \
  PROXY_PORT_VALUE="$PROXY_PORT" \
  node <<'NODE'
const fs = require('node:fs')
const file = process.env.CONFIG_FILE_ENV
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  cfg = {}
}
cfg.proxyPort = Number(process.env.PROXY_PORT_VALUE || 3001)
cfg.llamaPort = Number(process.env.LLAMA_PORT_VALUE || 8080)
cfg.llamaUrl = `http://127.0.0.1:${cfg.llamaPort}`
cfg.modelPath = process.env.MODEL_PATH_VALUE || ''
cfg.modelName = process.env.MODEL_NAME_VALUE || ''
cfg.backend = process.env.BACKEND_VALUE || cfg.backend || 'cpu'
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
NODE
}

ensure_workstation_config() {
  local workstation_name supabase_url supabase_key enrollment_token station_refresh_token station_access_token workstation_email workstation_password app_origin
  workstation_name="$(read_config_value workstationName)"
  supabase_url="$(read_config_value supabaseUrl)"
  supabase_key="$(read_config_value supabaseAnonKey)"
  enrollment_token="$(read_config_value enrollmentToken)"
  station_refresh_token="$(read_config_value stationRefreshToken)"
  station_access_token="$(read_config_value stationAccessToken)"
  workstation_email="$(read_config_value workstationEmail)"
  workstation_password="$(read_config_value workstationPassword)"
  app_origin="$(read_config_value appOrigin)"

  if [ -n "$workstation_name" ] && [ -n "$supabase_url" ] && [ -n "$supabase_key" ] && { [ -n "$station_refresh_token" ] || [ -n "$station_access_token" ] || [ -n "$enrollment_token" ]; }; then
    log "Używam zapisanej konfiguracji stacji roboczej/tokenu stacji."
    return
  fi

  if [ -n "$workstation_name" ] && [ -n "$supabase_url" ] && [ -n "$supabase_key" ] && [ -n "$workstation_email" ] && [ -n "$workstation_password" ]; then
    warn "Używam legacy konfiguracji z hasłem operatora. Wygeneruj token stacji w dashboardzie i uruchom ./start.sh --config, żeby usunąć hasło z config.json."
    return
  fi

  echo
  echo "=========================================================="
  echo "  Konfiguracja stacji roboczej (jednorazowo)"
  echo "=========================================================="
  echo "  Ta stacja użyje tokenu instalacyjnego z dashboardu."
  echo "  Nie wpisuj tu hasła operatora — launcher go nie zapisuje."
  echo

  workstation_name="$(prompt_with_default "Nazwa stacji" "${workstation_name:-$(hostname)}")"
  echo "  Supabase URL i publishable key skopiujesz z własnego projektu Supabase."
  echo "  Token stacji wygenerujesz w dashboardzie: Stacje robocze → Tokeny instalacyjne."
  supabase_url="$(prompt_with_default "Supabase URL" "${supabase_url:-$DEFAULT_SUPABASE_URL}")"
  supabase_key="$(prompt_with_default "Supabase publishable key" "${supabase_key:-$DEFAULT_SUPABASE_KEY}")"
  enrollment_token="$(prompt_with_default "Token instalacyjny stacji" "$enrollment_token")"
  if [ -z "$enrollment_token" ]; then
    err "Brak tokenu instalacyjnego. Wygeneruj token w dashboardzie: Stacje robocze → Tokeny instalacyjne."
    exit 1
  fi
  app_origin="$(prompt_with_default "Adres aplikacji GitHub Pages (origin, bez ścieżki)" "${app_origin:-$DEFAULT_APP_ORIGIN}")"

  upsert_workstation_config "$workstation_name" "$supabase_url" "$supabase_key" "$enrollment_token" "$app_origin"
  log "Zapisano konfigurację stacji roboczej w config.json. Token zostanie wymieniony na ograniczoną sesję stacji przy starcie."
}

ensure_config() {
  local gpu="$1"
  local saved_model_path=""
  local asked_model_config=0
  if [ -f "$CONFIG_FILE" ]; then
    saved_model_path="$(read_config_value modelPath)"
  fi

  if [ "$CHANGE_MODEL" = "1" ] || [ ! -f "$CONFIG_FILE" ] || [ -z "$saved_model_path" ]; then
    if [ -f "$CONFIG_FILE" ] && [ -z "$saved_model_path" ]; then
      warn "config.json nie zawiera modelPath — wybierz model ponownie."
    fi
    local model_path
    model_path="$(prompt_model)"
    write_model_config "$model_path" "$gpu"
    asked_model_config=1
    log "Zapisano config.json"
  else
    log "Używam zapisanego modelu z config.json (zmień: ./start.sh --change-model)"
  fi

  sync_runtime_config_json
  ensure_workstation_config
  if [ "$ADVANCED_CONFIG" = "1" ] || [ "$asked_model_config" = "1" ]; then
    configure_advanced_options
  fi
  if [ "$SCHEDULE_CONFIG" = "1" ]; then
    configure_schedule_options
  else
    sync_runtime_config_json
  fi
}

read_config_value() {
  # Bardzo prosty parser — wyciąga wartość prostego klucza string/number.
  local key="$1"
  grep -Eo "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$CONFIG_FILE" 2>/dev/null \
    | head -n1 | sed -E "s/.*:[[:space:]]*\"([^\"]*)\"/\1/" || true
}

read_config_scalar_value() {
  local key="$1" default_value="${2:-}" raw
  raw="$(grep -Eo "\"$key\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+|true|false|null)" "$CONFIG_FILE" 2>/dev/null | head -n1 || true)"
  if [ -z "$raw" ]; then
    printf '%s\n' "$default_value"
    return
  fi
  raw="${raw#*:}"
  raw="$(printf '%s' "$raw" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^"//; s/"$//')"
  if [ "$raw" = "null" ] || [ -z "$raw" ]; then
    printf '%s\n' "$default_value"
  else
    printf '%s\n' "$raw"
  fi
}

read_config_json_value() {
  local key="$1" default_value="${2:-}"
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  CONFIG_KEY_VALUE="$key" \
  CONFIG_DEFAULT_VALUE="$default_value" \
  node <<'NODE'
const fs = require('node:fs')
const file = process.env.CONFIG_FILE_ENV
const key = process.env.CONFIG_KEY_VALUE
const fallback = process.env.CONFIG_DEFAULT_VALUE || ''
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch {
  cfg = {}
}
const value = cfg[key]
if (value === undefined || value === null || value === '') {
  console.log(fallback)
} else if (typeof value === 'object') {
  console.log(JSON.stringify(value))
} else {
  console.log(String(value))
}
NODE
}

schedule_state_line() {
  CONFIG_FILE_ENV="$CONFIG_FILE" \
  PROXY_DIR_ENV="$PROXY_DIR" \
  node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const { getScheduleState, formatDuration } = require(path.join(process.env.PROXY_DIR_ENV, 'runtime-schedule'))
let cfg = {}
try {
  cfg = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE_ENV, 'utf8'))
} catch {
  cfg = {}
}
const state = getScheduleState(cfg)
console.log([
  state.enabled ? '1' : '0',
  state.inside ? '1' : '0',
  state.outsideAction || 'wait',
  state.windowLabel || 'disabled',
  String(state.secondsUntilStart || 0),
  formatDuration(state.secondsUntilStart || 0),
].join('|'))
NODE
}

wait_for_schedule_window() {
  local enabled inside outside_action window_label seconds duration sleep_seconds state
  while :; do
    state="$(schedule_state_line)"
    IFS='|' read -r enabled inside outside_action window_label seconds duration <<< "$state"
    if [ "$enabled" != "1" ] || [ "$inside" = "1" ]; then
      return
    fi
    if [ "$outside_action" = "exit" ]; then
      warn "Poza harmonogramem ($window_label). Launcher kończy bez ładowania modelu."
      exit 0
    fi
    warn "Poza harmonogramem ($window_label). Lekko czekam $duration; model nie jest jeszcze ładowany."
    sleep_seconds="$seconds"
    if ! [[ "$sleep_seconds" =~ ^[0-9]+$ ]]; then sleep_seconds=60; fi
    if [ "$sleep_seconds" -gt 60 ]; then sleep_seconds=60; fi
    if [ "$sleep_seconds" -lt 10 ]; then sleep_seconds=10; fi
    sleep "$sleep_seconds"
  done
}

normalize_parallel_slots() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then value=1; fi
  if [ "$value" -lt 1 ]; then value=1; fi
  if [ "$value" -gt 4 ]; then value=4; fi
  printf '%s\n' "$value"
}

normalize_speculative_tokens() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then value=4; fi
  if [ "$value" -lt 1 ]; then value=1; fi
  if [ "$value" -gt 16 ]; then value=16; fi
  printf '%s\n' "$value"
}

ensure_runtime_files() {
  local model_path="$1" bin
  bin="$(llama_binary_path)"

  if [ ! -f "$model_path" ]; then
    err "Brak pliku modelu: $model_path"
    if [ "$NO_PULL" = "1" ]; then
      err "Uruchom bez --no-pull albo wskaż istniejący plik GGUF przez ./start.sh --change-model."
    else
      err "Uruchom ./start.sh --change-model i wybierz istniejący plik GGUF."
    fi
    exit 1
  fi

  if [ ! -x "$bin" ]; then
    if [ -f "$bin" ]; then
      chmod +x "$bin"
    else
      err "Brak llama-server: $bin"
      err "Uruchom bez --no-pull albo pobierz llama.cpp ręcznie do local-ai-proxy/bin."
      exit 1
    fi
  fi
}

llama_supports_flag() {
  local bin="$1" flag="$2"
  "$bin" --help 2>&1 | grep -q -- "$flag"
}

# --- Sprawdzenie portów -----------------------------------------------------

# Czy na danym porcie odpowiada już llama-server? (porozumienie z /health)
is_llama_server_on() {
  local port="$1"
  curl -fs --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null \
    | grep -Eqi '"status"[[:space:]]*:[[:space:]]*"ok"|slots_idle|llama-server|llama\.cpp'
}

http_health_on() {
  local port="$1"
  curl -fs --max-time 1 "http://127.0.0.1:$port/health" >/dev/null 2>&1
}

# Co stoi na porcie? Zwraca 'free' | 'llama' | 'other'.
port_state() {
  local port="$1"
  if is_llama_server_on "$port"; then echo "llama"; return; fi
  if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "other"; return
  fi
  if http_health_on "$port"; then echo "other"; return; fi
  if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
    echo "other"; return
  fi
  echo "free"
}

# Znajdź wolny port w zakresie startując od podanego.
find_free_port() {
  local p="$1" max
  max="$((p + 50))"
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
  local parallel_slots sd_enabled draft_model_path speculative_tokens context_size kv_requested kv_effective

  context_size="$(read_config_json_value effectiveContextSizeTokens 0)"
  if ! [[ "$context_size" =~ ^[0-9]+$ ]]; then context_size=0; fi
  if [ "$context_size" -gt 262144 ]; then context_size=262144; fi
  extra_args+=( --ctx-size "$context_size" )
  if [ "$context_size" = "0" ]; then
    log "Kontekst modelu: native (llama.cpp --ctx-size 0)."
  elif [ "$context_size" -ge 131072 ]; then
    warn "Kontekst ${context_size} tokenów może wymagać bardzo dużo RAM/VRAM. Jeśli start będzie wolny albo padnie, wróć do native przez ./start.sh --config."
  else
    log "Kontekst modelu: ${context_size} tokenów."
  fi

  kv_requested="$(read_config_json_value kvCacheQuantization auto)"
  kv_effective="$(read_config_json_value effectiveKvCacheQuantization f16)"
  case "$kv_effective" in f16|q8_0|q4_0) ;; *) kv_effective="f16" ;; esac
  if [ "$kv_effective" != "f16" ]; then
    if llama_supports_flag "$bin" "--cache-type-k" && llama_supports_flag "$bin" "--cache-type-v"; then
      extra_args+=( --cache-type-k "$kv_effective" --cache-type-v "$kv_effective" )
      log "KV cache compression: $kv_effective (requested=$kv_requested)."
    else
      warn "config.json chce KV=$kv_effective, ale ten llama-server nie pokazuje --cache-type-k/--cache-type-v. Startuję bez kompresji KV."
    fi
  fi

  # Heurystyka: pełny GPU offload na akceleratorach, CPU dla fallbacku
  case "$gpu" in
    metal|cuda|rocm|vulkan) extra_args+=( --n-gpu-layers 999 ) ;;
  esac

  parallel_slots="$(normalize_parallel_slots "$(read_config_json_value parallelSlots 1)")"
  if [ "$parallel_slots" -gt 1 ]; then
    if llama_supports_flag "$bin" "--parallel"; then
      extra_args+=( --parallel "$parallel_slots" )
      log "Advanced parallelSlots=$parallel_slots aktywne w llama-server."
    else
      warn "Ten llama-server nie pokazuje flagi --parallel w --help. Stacja nadal zgłosi parallelSlots=$parallel_slots, ale serwer modelu zostaje bez tej flagi."
    fi
  fi

  sd_enabled="$(read_config_json_value sdEnabled false)"
  if [ "$sd_enabled" = "true" ]; then
    draft_model_path="$(read_config_json_value draftModelPath '')"
    speculative_tokens="$(normalize_speculative_tokens "$(read_config_json_value speculativeTokens 4)")"
    if [ -z "$draft_model_path" ] || [ ! -f "$draft_model_path" ]; then
      warn "SD włączone w config.json, ale draft model nie istnieje. Startuję bez SD."
    elif llama_supports_flag "$bin" "--model-draft"; then
      extra_args+=( --model-draft "$draft_model_path" )
      if llama_supports_flag "$bin" "--draft-max"; then
        extra_args+=( --draft-max "$speculative_tokens" )
      fi
      log "Advanced SD eksperymentalne aktywne: draft=$(basename "$draft_model_path")."
    else
      warn "SD zapisane w config.json, ale ten llama-server nie pokazuje --model-draft w --help. Startuję bez SD."
    fi
  fi

  log "Uruchamiam llama-server (port $LLAMA_PORT, model $(basename "$model_path"))"
  nohup "$bin" \
    --model "$model_path" \
    --host 127.0.0.1 \
    --port "$LLAMA_PORT" \
    "${extra_args[@]}" \
    >"$LOGS_DIR/llama-server.log" 2>&1 &
  echo $! > "$LOGS_DIR/llama.pid"
  STARTED_LLAMA=1
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
  STARTED_PROXY=1
}

start_workstation_agent() {
  if ! command -v node >/dev/null 2>&1; then
    err "Brak Node.js w PATH. Zainstaluj Node 18+: https://nodejs.org"
    exit 1
  fi
  log "Uruchamiam agenta stacji roboczej"
  nohup node "$PROXY_DIR/workstation-agent.js" \
    >"$LOGS_DIR/workstation-agent.log" 2>&1 &
  echo $! > "$LOGS_DIR/workstation-agent.pid"
  STARTED_WORKSTATION_AGENT=1
}

print_log_tail() {
  local label="$1" file="$2" lines="${3:-25}"
  [ -f "$file" ] || return 0
  [ -s "$file" ] || return 0
  echo
  warn "$label ($file)"
  tail -n "$lines" "$file" | sed 's/^/  /'
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

wait_for_runtime_processes() {
  local pids=() labels=() index pid label
  if [ "$REUSE_LLAMA" != "1" ] && [ -f "$LOGS_DIR/llama.pid" ]; then
    pids+=("$(cat "$LOGS_DIR/llama.pid")"); labels+=("llama-server")
  fi
  if [ -f "$LOGS_DIR/proxy.pid" ]; then
    pids+=("$(cat "$LOGS_DIR/proxy.pid")"); labels+=("proxy")
  fi
  if [ -f "$LOGS_DIR/workstation-agent.pid" ]; then
    pids+=("$(cat "$LOGS_DIR/workstation-agent.pid")"); labels+=("workstation-agent")
  fi

  while :; do
    index=0
    for pid in "${pids[@]}"; do
      label="${labels[$index]}"
      if ! kill -0 "$pid" 2>/dev/null; then
        warn "$label zakończył proces (pid $pid). Sprzątam pozostałe procesy runtime."
        print_log_tail "$label log tail" "$LOGS_DIR/$label.log"
        return
      fi
      index=$((index + 1))
    done
    sleep 5
  done
}

cleanup() {
  log "Sprzątam procesy…"
  [ "$STARTED_LLAMA" = "1" ] && cleanup_pidfile "$LOGS_DIR/llama.pid"
  [ "$STARTED_PROXY" = "1" ] && cleanup_pidfile "$LOGS_DIR/proxy.pid"
  [ "$STARTED_WORKSTATION_AGENT" = "1" ] && cleanup_pidfile "$LOGS_DIR/workstation-agent.pid"
}

cleanup_pidfile() {
  local pidfile="$1"
  if [ -f "$pidfile" ]; then
    local pid; pid="$(cat "$pidfile")"
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
  fi
}

doctor_line() {
  local status="$1" name="$2" message="$3"
  printf '[%s] %s: %s\n' "$status" "$name" "$message"
}

run_doctor() {
  local backend token_groups release_urls picked asset_url bin model_path workstation_email
  echo "Safe diagnostics only: no downloads, prompts or runtime services are started."
  echo

  doctor_line "OK" "Repository" "$ROOT_DIR"
  [ -f "$PROXY_DIR/proxy.js" ] && doctor_line "OK" "proxy.js" "found" || doctor_line "WARN" "proxy.js" "missing local-ai-proxy/proxy.js"
  [ -f "$PROXY_DIR/workstation-agent.js" ] && doctor_line "OK" "workstation-agent.js" "found" || doctor_line "WARN" "workstation-agent.js" "missing local-ai-proxy/workstation-agent.js"

  if command -v node >/dev/null 2>&1; then
    doctor_line "OK" "Node.js" "$(node --version 2>/dev/null) at $(command -v node)"
  else
    doctor_line "WARN" "Node.js" "not found; full runtime requires Node.js 18+"
  fi

  if command -v curl >/dev/null 2>&1; then
    doctor_line "OK" "curl" "$(command -v curl)"
  else
    doctor_line "WARN" "curl" "not found; binary/model downloads require curl"
  fi

  doctor_line "INFO" "Port 8080" "$(port_state 8080)"
  doctor_line "INFO" "Port 3001" "$(port_state 3001)"

  backend="$(detect_gpu "$(detect_os)" "$(detect_arch)")"
  doctor_line "INFO" "Detected backend" "$backend"
  if command -v curl >/dev/null 2>&1; then
    token_groups="$(asset_token_groups "$(detect_os)" "$(detect_arch)" "$backend")"
    release_urls="$(curl -fsSL "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest" | extract_release_package_urls)" || release_urls=""
    picked="$(pick_matching_url_from_groups "$release_urls" <<< "$token_groups")" || picked=""
    asset_url="${picked%%|*}"
    if [ -n "$asset_url" ]; then
      doctor_line "OK" "llama.cpp asset" "$(basename "$asset_url")"
    else
      doctor_line "WARN" "llama.cpp asset" "no matching asset for current backend/fallbacks"
    fi
  fi

  bin="$(llama_binary_path)"
  if [ -f "$bin" ]; then
    doctor_line "OK" "llama-server" "$bin"
  else
    doctor_line "INFO" "llama-server" "not downloaded yet; full start will download it"
  fi

  if [ -f "$CONFIG_FILE" ]; then
    model_path="$(read_config_value modelPath)"
    enrollment_token="$(read_config_value enrollmentToken)"
    station_refresh_token="$(read_config_value stationRefreshToken)"
    station_access_token="$(read_config_value stationAccessToken)"
    workstation_email="$(read_config_value workstationEmail)"
    if [ -n "$model_path" ] && [ -f "$model_path" ]; then
      doctor_line "OK" "config.json modelPath" "$model_path"
    elif [ -n "$model_path" ]; then
      doctor_line "WARN" "config.json modelPath" "configured path does not exist: $model_path"
    else
      doctor_line "INFO" "config.json modelPath" "missing; full start will ask for a GGUF model"
    fi
    if [ -n "$station_refresh_token" ] || [ -n "$station_access_token" ]; then
      doctor_line "OK" "station auth" "restricted station session configured"
    elif [ -n "$enrollment_token" ]; then
      doctor_line "INFO" "station auth" "enrollment token saved; full start will redeem it"
    elif [ -n "$workstation_email" ]; then
      doctor_line "WARN" "station auth" "legacy operator password config: $workstation_email"
    else
      doctor_line "INFO" "station auth" "missing; full start will ask for dashboard enrollment token"
    fi
    doctor_line "INFO" "context" "mode=$(read_config_scalar_value contextMode native), tokens=$(read_config_scalar_value contextSizeTokens 0), KV=$(read_config_scalar_value kvCacheQuantization auto)"
    doctor_line "INFO" "autoUpdate" "$(read_config_scalar_value autoUpdate false)"
  else
    doctor_line "INFO" "config.json" "missing; full start will enter first-run configuration"
  fi

  echo
  doctor_line "OK" "Doctor" "finished without starting services"
}

print_banner
if [ "$DOCTOR_MODE" = "1" ]; then
  run_doctor
  exit 0
fi

if [ "$UPDATE_NOW" = "1" ]; then
  run_safe_update "--update"
elif [ "$(read_config_scalar_value autoUpdate false)" = "true" ]; then
  run_safe_update "autoUpdate"
fi
check_base_requirements
ensure_workspace_dirs
trap cleanup EXIT INT TERM

REUSE_LLAMA=0
STARTED_LLAMA=0
STARTED_PROXY=0
STARTED_WORKSTATION_AGENT=0

# --- Main -------------------------------------------------------------------

resolve_llama_port    # może zmienić LLAMA_PORT i ustawić REUSE_LLAMA
resolve_proxy_port    # może zmienić PROXY_PORT

if [ "$REUSE_LLAMA" = "1" ]; then
  GPU_DETECTED="$(detect_gpu "$(detect_os)" "$(detect_arch)")"
else
  GPU_DETECTED="$(download_binary)"
fi
ensure_config "$GPU_DETECTED"

MODEL_PATH="$(read_config_value modelPath)"
[ -z "$MODEL_PATH" ] && { err "Brak modelPath w config.json"; exit 1; }

wait_for_schedule_window

if [ "$REUSE_LLAMA" = "1" ]; then
  if [ ! -f "$MODEL_PATH" ]; then
    warn "Model zapisany w config.json nie istnieje lokalnie: $MODEL_PATH"
    warn "Reużywam działający llama-server na :$LLAMA_PORT, ale przy kolejnym starcie wybierz model ponownie."
  fi
  log "Pomijam start llama-server (używam istniejącego na :$LLAMA_PORT)."
else
  ensure_runtime_files "$MODEL_PATH"
  start_llama "$MODEL_PATH" "$GPU_DETECTED"
  wait_for_health "http://127.0.0.1:$LLAMA_PORT/health" "llama-server" 90 || exit 1
fi

start_proxy
wait_for_health "http://127.0.0.1:$PROXY_PORT/health" "proxy" 15 || exit 1
start_workstation_agent

cat <<EOF

============================================================
  Lokalny runtime AI uruchomiony.

  llama-server   http://127.0.0.1:$LLAMA_PORT
  proxy          http://127.0.0.1:$PROXY_PORT
  station agent  $LOGS_DIR/workstation-agent.log
  model          $(basename "$MODEL_PATH")
  backend        $GPU_DETECTED
  parallelSlots  $(read_config_json_value parallelSlots 1)
  context        $(read_config_json_value contextMode native) / $(read_config_json_value effectiveContextSizeTokens 0) tokens
  KV cache       $(read_config_json_value effectiveKvCacheQuantization f16)
  SD             $(read_config_json_value sdEnabled false)
  autoUpdate     $(read_config_json_value autoUpdate false)

  Otwórz aplikację (GitHub Pages lub ui/index.html) — frontend
  automatycznie wykryje proxy i przełączy się w tryb AI.

  Wciśnij Ctrl+C aby zatrzymać oba procesy.
============================================================

EOF

# Trzymaj skrypt aktywny. Gdy agent zakończy pracę po harmonogramie,
# monitor wraca, a trap cleanup zatrzymuje resztę runtime.
wait_for_runtime_processes
