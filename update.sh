#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_ZIP_URL="${AGENT_MANAGER_UPDATE_ZIP_URL:-https://github.com/Kamciosz/agent-manager/archive/refs/heads/main.zip}"

log() { printf '[update] %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
err() { printf '[err] %s\n' "$*" >&2; }

safe_git_update() {
  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi
  if ! git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 1
  fi
  if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
    warn "Aktualizacja git pominięta: są lokalne zmiany. Zrób commit/stash albo zaktualizuj ręcznie."
    return 0
  fi
  if [ "$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)" = "HEAD" ]; then
    warn "Aktualizacja git pominięta: repo jest w detached HEAD."
    return 0
  fi

  log "Wykonuję git pull --ff-only."
  if git -C "$ROOT_DIR" pull --ff-only; then
    log "Repo git zaktualizowane."
  else
    warn "git pull --ff-only nie powiódł się. Pliki lokalne nie zostały zmienione."
  fi
  return 0
}

zip_update() {
  for tool in curl unzip rsync; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      err "Brakuje narzędzia '$tool'. Zainstaluj je albo pobierz najnowszą paczkę ręcznie."
      return 1
    fi
  done

  local tmp_dir zip_file source_dir
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-manager-update.XXXXXX")"
  trap 'rm -rf "$tmp_dir"' EXIT
  zip_file="$tmp_dir/main.zip"

  log "To nie jest repo git, pobieram najnowszy kod z GitHuba."
  curl -fL "$UPDATE_ZIP_URL" -o "$zip_file"
  unzip -q "$zip_file" -d "$tmp_dir"
  source_dir="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$source_dir" ] || [ ! -d "$source_dir" ]; then
    err "Nie udało się odnaleźć rozpakowanego katalogu aktualizacji."
    return 1
  fi

  rsync -a \
    --exclude='.git/' \
    --exclude='local-ai-proxy/config.json' \
    --exclude='local-ai-proxy/bin/' \
    --exclude='local-ai-proxy/models/' \
    --exclude='local-ai-proxy/logs/' \
    "$source_dir/" "$ROOT_DIR/"

  chmod +x "$ROOT_DIR/start.sh" "$ROOT_DIR/start.command" "$ROOT_DIR/Aktualizuj.command" "$ROOT_DIR/update.sh" 2>/dev/null || true
  log "Aktualizacja ZIP zakończona. Zachowano config.json, modele, binarki i logi."
}

cd "$ROOT_DIR"
if ! safe_git_update; then
  zip_update
fi
