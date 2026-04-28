/**
 * @file ai-client.js
 * @description Klient lokalnego proxy AI. Sprawdza dostępność
 *              `http://127.0.0.1:3001` (proxy uruchomione przez
 *              `start.sh`/`start.bat`) i wystawia funkcję `generate(prompt)`.
 *
 *              Gdy proxy jest niedostępne, `isAvailable()` zwraca false —
 *              `manager.js` i `executor.js` używają wtedy fallbacku
 *              z hardcoded tekstami (tryb demo).
 *
 *              Health-check ponawiany jest co 10 s aby UX wykrywał
 *              uruchomienie/zatrzymanie proxy bez przeładowania strony.
 */

// ============================================================================
// STAŁE
// ============================================================================

const PROXY_BASE_URL = 'http://127.0.0.1:3001'
const HEALTH_PATH = '/health'
const GENERATE_PATH = '/generate'
const HEALTH_TIMEOUT_MS = 1500
const GENERATE_TIMEOUT_MS = 30000
const RECHECK_INTERVAL_MS = 10000

// ============================================================================
// STAN MODUŁU
// ============================================================================

const state = {
  available: false,
  modelName: '',
  backend: '',
  recheckTimer: null,
}

// ============================================================================
// ERRORY
// ============================================================================

/**
 * Rzucany gdy proxy AI jest niedostępne.
 */
class AiUnavailableError extends Error {
  constructor(message = 'AI proxy unavailable') {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Inicjalizuje klienta: pierwszy health-check + ustawia okresową weryfikację.
 * Renderuje też mały badge statusu w headerze (#ai-status-badge).
 * @returns {Promise<void>}
 */
export async function initAiClient() {
  await refreshHealth()
  if (state.recheckTimer) clearInterval(state.recheckTimer)
  state.recheckTimer = setInterval(refreshHealth, RECHECK_INTERVAL_MS)
}

/**
 * Czy proxy jest aktualnie osiągalne i raportuje że llama-server działa.
 * @returns {boolean}
 */
export function isAvailable() {
  return state.available
}

/**
 * Generuje tekst przez lokalne proxy AI.
 * @param {string} prompt
 * @param {{ maxTokens?: number, temperature?: number }} [opts]
 * @returns {Promise<string>}
 * @throws {AiUnavailableError} gdy proxy lub llama-server nie odpowiadają
 */
export async function generate(prompt, opts = {}) {
  if (!state.available) throw new AiUnavailableError()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS)
  try {
    const res = await fetch(`${PROXY_BASE_URL}${GENERATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        maxTokens: opts.maxTokens ?? 200,
        temperature: opts.temperature ?? 0.7,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Proxy mówi że llama-server padł — od razu zaktualizuj stan i fallback
      state.available = false
      renderBadge()
      throw new AiUnavailableError(`proxy HTTP ${res.status}`)
    }
    const data = await res.json()
    return (data.text || '').trim()
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error
    state.available = false
    renderBadge()
    throw new AiUnavailableError(error.message)
  } finally {
    clearTimeout(timeout)
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Pinguje proxy /health, aktualizuje stan i odświeża badge w UI.
 * @returns {Promise<void>}
 */
async function refreshHealth() {
  const previous = state.available
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const res = await fetch(`${PROXY_BASE_URL}${HEALTH_PATH}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('non-2xx')
    const data = await res.json()
    state.available = Boolean(data.ok)
    state.modelName = data.model || ''
    state.backend = data.backend || ''
  } catch {
    state.available = false
  } finally {
    clearTimeout(timeout)
  }

  if (state.available !== previous) {
    console.log('[ai-client] AI dostępne:', state.available, '|', state.modelName, state.backend)
  }
  renderBadge()
}

// ============================================================================
// UI BADGE
// ============================================================================

/**
 * Renderuje #ai-status-badge w headerze. Element musi istnieć w DOM.
 * @returns {void}
 */
function renderBadge() {
  const badge = document.getElementById('ai-status-badge')
  if (!badge) return
  if (state.available) {
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700'
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>AI lokalny: ${escapeHtml(state.modelName)}`
    badge.title = `Backend: ${state.backend}`
  } else {
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800'
    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>Tryb demo (symulacja)'
    badge.title = 'Uruchom ./start.sh aby włączyć lokalny AI'
  }
}

/**
 * Bezpieczne escapowanie HTML dla wstawek do innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export { AiUnavailableError }
