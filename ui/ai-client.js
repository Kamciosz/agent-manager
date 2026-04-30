/**
 * @file ai-client.js
 * @description Klient lokalnego proxy AI. Sprawdza dostępność
 *              `http://127.0.0.1:3001` (proxy uruchomione przez
 *              `start.sh`/`start.bat`) i wystawia funkcję `generate(prompt)`.
 *
 *              Gdy proxy jest niedostępne, `isAvailable()` zwraca false —
 *              `manager.js` i `executor.js` używają wtedy przeglądarkowego
 *              fallbacku z tekstami operacyjnymi.
 *
 *              Na publicznym Pages health-check startuje dopiero po kliknięciu
 *              badge lub z parametrem `?localAi=1`, żeby brak lokalnego proxy
 *              nie generował błędów konsoli w zwykłym trybie online.
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
const LOCAL_AI_QUERY_PARAM = 'localAi'

// ============================================================================
// STAN MODUŁU
// ============================================================================

const state = {
  available: false,
  modelName: '',
  backend: '',
  advanced: null,
  recheckTimer: null,
  probeEnabled: false,
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
  state.probeEnabled = shouldProbeOnLoad()
  bindBadgeProbe()
  renderBadge()
  if (state.probeEnabled) await checkHealthOnce()
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
 * @param {{ maxTokens?: number, temperature?: number, timeoutMs?: number, workflowMode?: string, role?: string, requestId?: string }} [opts]
 * @returns {Promise<string>}
 * @throws {AiUnavailableError} gdy proxy lub llama-server nie odpowiadają
 */
export async function generate(prompt, opts = {}) {
  const result = await generateWithMetrics(prompt, opts)
  return result.text
}

/**
 * Generuje tekst i zwraca metryki runtime z proxy.
 * @param {string} prompt
 * @param {{ maxTokens?: number, temperature?: number, timeoutMs?: number, workflowMode?: string, role?: string, requestId?: string }} [opts]
 * @returns {Promise<Object>}
 */
export async function generateWithMetrics(prompt, opts = {}) {
  if (!state.available) throw new AiUnavailableError()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || GENERATE_TIMEOUT_MS)
  try {
    const requestId = opts.requestId || makeRequestId()
    const res = await fetch(`${PROXY_BASE_URL}${GENERATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId,
        prompt,
        maxTokens: opts.maxTokens ?? 200,
        temperature: opts.temperature ?? 0.7,
        timeoutMs: opts.timeoutMs || GENERATE_TIMEOUT_MS,
        workflowMode: opts.workflowMode || 'standard',
        role: opts.role || 'shared',
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
    return { ...data, requestId, text: (data.text || '').trim() }
  } catch (error) {
    if (error instanceof AiUnavailableError) throw error
    state.available = false
    renderBadge()
    throw new AiUnavailableError(error.message)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Buduje lokalny identyfikator requestu do korelacji logów.
 * @returns {string}
 */
function makeRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
    state.advanced = data.advanced || null
  } catch {
    state.available = false
    state.advanced = null
  } finally {
    clearTimeout(timeout)
  }

  if (state.available !== previous) {
    console.log('[ai-client] AI dostępne:', state.available, '|', state.modelName, state.backend)
  }
  renderBadge()
}

/**
 * Sprawdza proxy raz i utrzymuje polling tylko gdy proxy działa.
 * @returns {Promise<void>}
 */
async function checkHealthOnce() {
  await refreshHealth()
  if (state.recheckTimer) clearInterval(state.recheckTimer)
  state.recheckTimer = state.available ? setInterval(refreshHealth, RECHECK_INTERVAL_MS) : null
}

/**
 * Czy można automatycznie sondować lokalny runtime przy starcie strony.
 * @returns {boolean}
 */
function shouldProbeOnLoad() {
  const params = new URLSearchParams(window.location.search)
  if (params.get(LOCAL_AI_QUERY_PARAM) === '1') return true
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return true
  return false
}

/**
 * Podpina ręczne sprawdzenie lokalnego AI do badge w headerze.
 * @returns {void}
 */
function bindBadgeProbe() {
  const badge = document.getElementById('ai-status-badge')
  if (!badge || badge.dataset.bound === 'true') return
  badge.dataset.bound = 'true'
  badge.addEventListener('click', () => {
    state.probeEnabled = true
    checkHealthOnce()
  })
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
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 cursor-pointer'
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>AI lokalny: ${escapeHtml(state.modelName)}`
    badge.title = advancedTitle()
  } else {
    badge.className = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700 border border-sky-200 cursor-pointer hover:bg-sky-200'
    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-sky-500"></span>Panel online'
    badge.title = 'Kliknij, aby sprawdzić lokalny model po uruchomieniu ./start.sh'
  }
}

/**
 * Buduje tooltip statusu lokalnego runtime.
 * @returns {string}
 */
function advancedTitle() {
  const advanced = state.advanced || {}
  const slots = advanced.parallelSlots || 1
  const sd = advanced.sdEnabled ? 'on' : 'off'
  return `Backend: ${state.backend} | parallelSlots: ${slots} | SD: ${sd}`
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
