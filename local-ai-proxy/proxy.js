/**
 * @file proxy.js
 * @description Lokalne proxy HTTP między przeglądarką (GitHub Pages) a serwerem
 *              llama.cpp (`llama-server`). Bez zewnętrznych zależności — używa
 *              tylko wbudowanych modułów Node 18+ (`node:http`, `node:fs`).
 *
 *              Endpointy:
 *                GET  /health    → status proxy + llama-server + nazwa modelu
 *                POST /generate  → { prompt, maxTokens?, temperature? } → { text }
 *                OPTIONS *       → CORS preflight dla dozwolonych originów
 *
 *              Konfiguracja: `local-ai-proxy/config.json`. Plik tworzy
 *              automatycznie `start.sh` / `start.bat` po wybraniu modelu.
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

// ============================================================================
// STAŁE
// ============================================================================

const DEFAULTS = {
  PROXY_PORT: 3001,
  LLAMA_URL: 'http://127.0.0.1:8080',
  MAX_TOKENS: 256,
  TEMPERATURE: 0.7,
  TIMEOUT_MS: 15000,
  ALLOWED_ORIGINS: ['https://kamciosz.github.io', 'http://localhost', 'http://127.0.0.1'],
}

const CONFIG_PATH = path.join(__dirname, 'config.json')

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

// ============================================================================
// KONFIGURACJA
// ============================================================================

/**
 * Wczytuje config.json. Brak pliku = pusty obiekt z domyślnymi wartościami.
 * @returns {{ proxyPort:number, llamaUrl:string, modelName:string, backend:string, allowedOrigins:string[], parallelSlots:number, sdEnabled:boolean, draftModelName:string, speculativeTokens:number, contextMode:string, contextSizeTokens:number, kvCacheQuantization:string, effectiveKvCacheQuantization:string, autoUpdate:boolean, optimizationMode:string }}
 */
function loadConfig() {
  let cfg = {}
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (error) {
    console.error('[proxy] Nie udało się wczytać config.json:', error.message)
  }
  const contextMode = normalizeContextMode(cfg.contextMode)
  const contextSizeTokens = contextMode === 'native' ? 0 : clampInt(cfg.contextSizeTokens, 262144, 1024, 262144)
  const kvCacheQuantization = normalizeKvCache(cfg.kvCacheQuantization)
  return {
    proxyPort: Number(cfg.proxyPort) || DEFAULTS.PROXY_PORT,
    llamaUrl: cfg.llamaUrl || DEFAULTS.LLAMA_URL,
    modelName: cfg.modelName || 'unknown',
    backend: cfg.backend || 'unknown',
    allowedOrigins: normalizeAllowedOrigins(cfg.allowedOrigins),
    parallelSlots: clampInt(cfg.parallelSlots, 1, 1, 4),
    sdEnabled: cfg.sdEnabled === true,
    draftModelName: cfg.draftModelName || '',
    speculativeTokens: clampInt(cfg.speculativeTokens, 4, 1, 16),
    contextMode,
    contextSizeTokens,
    kvCacheQuantization,
    effectiveKvCacheQuantization: normalizeKvCache(cfg.effectiveKvCacheQuantization || resolveKvCache(kvCacheQuantization, contextSizeTokens)),
    autoUpdate: cfg.autoUpdate === true,
    optimizationMode: cfg.optimizationMode || 'standard',
  }
}

/**
 * Normalizuje originy, które mogą wywoływać lokalne proxy.
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeAllowedOrigins(value) {
  const raw = Array.isArray(value) ? value : []
  const origins = new Set(DEFAULTS.ALLOWED_ORIGINS)
  for (const item of raw) {
    const origin = String(item || '').trim().replace(/\/+$/, '')
    if (origin) origins.add(origin)
  }
  return Array.from(origins)
}

/**
 * Normalizuje liczbę całkowitą do bezpiecznego zakresu.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

/**
 * Normalizuje tryb kontekstu modelu.
 * @param {unknown} value
 * @returns {'native'|'extended'}
 */
function normalizeContextMode(value) {
  return String(value || 'native').trim().toLowerCase() === 'native' ? 'native' : 'extended'
}

/**
 * Normalizuje kompresję KV cache do wartości obsługiwanych przez launcher.
 * @param {unknown} value
 * @returns {'auto'|'f16'|'q8_0'|'q4_0'}
 */
function normalizeKvCache(value) {
  const raw = String(value || 'auto').trim().toLowerCase()
  return ['auto', 'f16', 'q8_0', 'q4_0'].includes(raw) ? raw : 'auto'
}

/**
 * Wylicza efektywną kompresję KV cache dla trybu auto.
 * @param {unknown} value
 * @param {unknown} contextSizeTokens
 * @returns {'f16'|'q8_0'|'q4_0'}
 */
function resolveKvCache(value, contextSizeTokens) {
  const normalized = normalizeKvCache(value)
  if (normalized !== 'auto') return normalized
  return Number(contextSizeTokens) > 32768 ? 'q8_0' : 'f16'
}

// ============================================================================
// HELPERY HTTP
// ============================================================================

/**
 * Sprawdza, czy request pochodzi z dozwolonego originu.
 * @param {import('node:http').IncomingMessage} req
 * @param {Object} cfg
 * @returns {boolean}
 */
function isOriginAllowed(req, cfg) {
  const origin = req.headers.origin
  if (!origin) return true
  if (origin === 'null') return true
  const normalized = String(origin).trim().replace(/\/+$/, '')
  return cfg.allowedOrigins.includes(normalized)
}

/**
 * Dopisuje nagłówki CORS do odpowiedzi.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Object} cfg
 * @returns {void}
 */
function withCors(req, res, cfg) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  const origin = req.headers.origin
  if (origin && origin !== 'null') {
    res.setHeader('Access-Control-Allow-Origin', String(origin).trim().replace(/\/+$/, ''))
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'null')
  }
}

/**
 * Odpowiada JSON-em z odpowiednim statusem.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Object} cfg
 * @param {number} status
 * @param {Object} body
 * @returns {void}
 */
function sendJson(req, res, cfg, status, body) {
  withCors(req, res, cfg)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.statusCode = status
  res.end(JSON.stringify(body))
}

/**
 * Czyta cały body requestu jako string (z limitem 1 MB).
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 1024 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// ============================================================================
// KLIENT LLAMA-SERVER
// ============================================================================

/**
 * Wysyła prompt do llama-server `/completion` i zwraca wygenerowany tekst.
 * @param {string} prompt
 * @param {{ maxTokens?:number, temperature?:number }} opts
 * @param {string} llamaUrl - bazowy URL llama-server (np. http://127.0.0.1:8080)
 * @returns {Promise<string>}
 */
async function forwardToLlama(prompt, opts, llamaUrl) {
  const payload = JSON.stringify({
    prompt,
    n_predict: opts.maxTokens ?? DEFAULTS.MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULTS.TEMPERATURE,
    stream: false,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULTS.TIMEOUT_MS)

  try {
    const response = await fetch(`${llamaUrl}/completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: controller.signal,
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`llama-server HTTP ${response.status} ${detail.slice(0, 300)}`)
    }
    const data = await response.json()
    return (data.content ?? '').trim()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Sprawdza dostępność llama-server.
 * @param {string} llamaUrl
 * @returns {Promise<boolean>}
 */
async function pingLlama(llamaUrl) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(`${llamaUrl}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

// ============================================================================
// HANDLERY ENDPOINTÓW
// ============================================================================

/**
 * Obsługuje GET /health.
 * @param {Object} cfg
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleHealth(cfg, req, res) {
  const llamaOk = await pingLlama(cfg.llamaUrl)
  sendJson(req, res, cfg, 200, {
    ok: llamaOk,
    proxy: 'up',
    llama: llamaOk ? 'up' : 'down',
    llamaUrl: cfg.llamaUrl,
    model: cfg.modelName,
    backend: cfg.backend,
    advanced: {
      parallelSlots: cfg.parallelSlots,
      sdEnabled: cfg.sdEnabled,
      draftModelName: cfg.draftModelName,
      speculativeTokens: cfg.speculativeTokens,
      contextMode: cfg.contextMode,
      contextSizeTokens: cfg.contextSizeTokens,
      kvCacheQuantization: cfg.kvCacheQuantization,
      effectiveKvCacheQuantization: cfg.effectiveKvCacheQuantization,
      autoUpdate: cfg.autoUpdate,
      optimizationMode: cfg.optimizationMode,
    },
  })
}

/**
 * Obsługuje POST /generate.
 * @param {Object} cfg
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleGenerate(cfg, req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (error) {
    console.warn('[proxy] Invalid JSON body:', error.message)
    sendJson(req, res, cfg, 400, { error: 'Invalid JSON body' })
    return
  }
  if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
    sendJson(req, res, cfg, 400, { error: 'Missing prompt' })
    return
  }
  try {
    const startedAt = Date.now()
    const text = await forwardToLlama(
      body.prompt,
      { maxTokens: body.maxTokens, temperature: body.temperature },
      cfg.llamaUrl,
    )
    sendJson(req, res, cfg, 200, { text, durationMs: Date.now() - startedAt })
  } catch (error) {
    console.error('[proxy] forwardToLlama failed:', cfg.llamaUrl, error.message)
    sendJson(req, res, cfg, 502, { error: 'llama-server unreachable', detail: error.message })
  }
}

// ============================================================================
// SERVER
// ============================================================================

/**
 * Loguje request w formacie [ISO] METHOD path → status (Xms).
 * @param {string} method
 * @param {string} url
 * @param {number} status
 * @param {number} startedAt
 * @returns {void}
 */
function logLine(method, url, status, startedAt) {
  const ms = Date.now() - startedAt
  console.log(`[${new Date().toISOString()}] ${method} ${url} → ${status} (${ms}ms)`)
}

/**
 * Routuje żądania do odpowiednich handlerów.
 * @param {Object} cfg
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function route(cfg, req, res) {
  const startedAt = Date.now()

  if (!isOriginAllowed(req, cfg)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Vary', 'Origin')
    res.statusCode = 403
    res.end(JSON.stringify({ error: 'Origin not allowed', allowedOrigins: cfg.allowedOrigins }))
    logLine(req.method || '', req.url || '/', 403, startedAt)
    return
  }

  // CORS preflight — zawsze 204 dla OPTIONS, niezależnie od ścieżki
  if (req.method === 'OPTIONS') {
    withCors(req, res, cfg)
    res.statusCode = 204
    res.end()
    logLine(req.method, req.url, 204, startedAt)
    return
  }

  const url = req.url || '/'
  if (req.method === 'GET' && url === '/health') {
    await handleHealth(cfg, req, res)
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'POST' && url === '/generate') {
    await handleGenerate(cfg, req, res)
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }

  sendJson(req, res, cfg, 404, { error: 'Not found' })
  logLine(req.method, url, 404, startedAt)
}

/**
 * Uruchamia serwer HTTP na zadanym porcie.
 * @returns {void}
 */
function startServer() {
  const cfg = loadConfig()
  const server = http.createServer((req, res) => {
    route(cfg, req, res).catch((error) => {
      console.error('[proxy] Unhandled error:', error)
      sendJson(req, res, cfg, 500, { error: 'Internal proxy error' })
    })
  })

  server.listen(cfg.proxyPort, '127.0.0.1', () => {
    console.log('[proxy] Local AI proxy listening on http://127.0.0.1:' + cfg.proxyPort)
    console.log('[proxy] Forwarding to llama-server at ' + cfg.llamaUrl)
    console.log('[proxy] Model: ' + cfg.modelName + ' | Backend: ' + cfg.backend)
    console.log('[proxy] Allowed origins: ' + cfg.allowedOrigins.join(', '))
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[proxy] Port ${cfg.proxyPort} jest już zajęty. Zatrzymaj inny proces lub zmień proxyPort w config.json.`)
      process.exit(1)
    }
    throw err
  })

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`\n[proxy] Otrzymano ${sig}, zamykam serwer.`)
      server.close(() => process.exit(0))
    })
  }
}

startServer()
