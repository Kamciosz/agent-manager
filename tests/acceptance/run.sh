#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-4173}"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"

log() {
  printf '[acceptance] %s\n' "$1"
}

check_zero_npm() {
  log 'checking zero npm project files'
  if find . -name package.json -not -path './.git/*' -print | grep -q .; then
    echo 'package.json is not allowed in this repository.' >&2
    exit 1
  fi
}

check_js() {
  log 'checking browser modules and runtime scripts'
  node --check --input-type=module < ui/app.js
  node --check --input-type=module < ui/ai-client.js
  node --check --input-type=module < ui/manager.js
  node --check --input-type=module < ui/executor.js
  node --check --input-type=module < ui/settings.js
  node --check --input-type=module < ui/task-events.js
  node --check --input-type=module < ui/labyrinth.js
  node --check local-ai-proxy/proxy.js local-ai-proxy/workstation-agent.js local-ai-proxy/runtime-schedule.js
}

check_node_tests() {
  log 'running node:test suite'
  node --test tests/*.test.js
}

wait_for_static_server() {
  for _ in {1..30}; do
    if curl -fsS "http://127.0.0.1:$PORT/" >/tmp/agent-manager-acceptance.html 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  echo "Static UI server did not respond on port $PORT." >&2
  return 1
}

check_static_ui() {
  log 'checking static UI over local HTTP'
  python3 -m http.server "$PORT" -d ui >/tmp/agent-manager-acceptance-server.log 2>&1 &
  SERVER_PID="$!"
  wait_for_static_server
  curl -fsS "http://127.0.0.1:$PORT/app.js" >/dev/null
  grep -q 'Agent Manager' /tmp/agent-manager-acceptance.html
  grep -q 'id="auth-screen"' /tmp/agent-manager-acceptance.html
  grep -q 'id="modal-submit-task"' /tmp/agent-manager-acceptance.html
  grep -q 'id="run-trace-list"' /tmp/agent-manager-acceptance.html
  grep -q 'id="task-events-list"' /tmp/agent-manager-acceptance.html
}

check_deployed_pages() {
  if [[ -z "${PAGES_URL:-}" ]]; then
    log 'skipping deployed Pages check because PAGES_URL is not set'
    return
  fi
  local base_url="${PAGES_URL%/}"
  local html_file="/tmp/agent-manager-pages.html"
  local app_file="/tmp/agent-manager-pages-app.js"

  log "checking deployed Pages at $base_url"
  curl -fsS "$base_url/" >"$html_file"
  curl -fsS "$base_url/app.js" >"$app_file"
  curl -fsS "$base_url/task-events.js" >/dev/null
  grep -q 'Agent Manager' "$html_file"
  grep -q "const SUPABASE_URL = 'https://" "$app_file"
  grep -q "const SUPABASE_ANON_KEY = '" "$app_file"
  grep -q 'APP_USER_ROLES' "$app_file"
  if grep -q '__SUPABASE_URL__\|__SUPABASE_ANON_KEY__' "$app_file"; then
    echo 'Deployed app.js still contains Supabase placeholders.' >&2
    exit 1
  fi
}

check_anon_table() {
  local table="$1"
  local body_file="/tmp/agent-manager-anon-$table.json"
  local status
  status="$(curl -sS -o "$body_file" -w '%{http_code}' \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    "$SUPABASE_URL/rest/v1/$table?select=id&limit=1")"

  if [[ "$status" != "200" ]]; then
    echo "Anon RLS check for $table returned HTTP $status." >&2
    cat "$body_file" >&2
    exit 1
  fi

  node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (!Array.isArray(data) || data.length !== 0) { console.error('Anon RLS leaked rows for ${table}:', data); process.exit(1); }" "$body_file"
}

check_supabase_anon_rls() {
  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" ]]; then
    log 'skipping anon RLS check because SUPABASE_URL/SUPABASE_ANON_KEY are not set'
    return
  fi
  log 'checking anonymous RLS visibility for core tables'
  check_anon_table tasks
  check_anon_table assignments
  check_anon_table messages
  check_anon_table agents
  check_anon_table task_events
}

check_supabase_auth_smoke() {
  if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" || -z "${SUPABASE_TEST_EMAIL:-}" || -z "${SUPABASE_TEST_PASSWORD:-}" ]]; then
    log 'skipping Supabase auth smoke because test account env is not set'
    return
  fi
  log 'checking Supabase Auth/RLS/CRUD with test account'
  node tests/acceptance/supabase-smoke.mjs
}

check_zero_npm
check_js
check_node_tests
check_static_ui
check_deployed_pages
check_supabase_anon_rls
check_supabase_auth_smoke
log 'acceptance smoke passed'