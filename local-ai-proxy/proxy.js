/**
 * @file proxy.js
 * @description Lokalne proxy HTTP między przeglądarką (GitHub Pages) a serwerem
 *              llama.cpp (`llama-server`). Bez zewnętrznych zależności — używa
 *              tylko wbudowanych modułów Node 18+ (`node:http`, `node:fs`).
 *
 *              Endpointy:
 *                GET  /health    → status proxy + llama-server + nazwa modelu
 *                GET  /health/smoke → krótka generacja kontrolna modelu
 *                GET  /metrics   → metryki queue/duration/tokens/s
 *                GET  /models    → aktualny model i capabilities gatewaya
 *                POST /generate  → { prompt, maxTokens?, temperature? } → { text } *                POST /v1/chat/completions → OpenAI-compatible (bez streamingu)
 *                POST /cancel/:requestId → anuluje aktywny request *                OPTIONS *       → CORS preflight dla dozwolonych originów
 *
 *              Konfiguracja: `local-ai-proxy/config.json`. Plik tworzy
 *              automatycznie `start.sh` / `start.bat` po wybraniu modelu.
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// ============================================================================
// STAŁE
// ============================================================================

const DEFAULTS = {
  PROXY_PORT: 3001,
  LLAMA_URL: 'http://127.0.0.1:8080',
  MAX_TOKENS: 256,
  TEMPERATURE: 0.7,
  TIMEOUT_MS: 600000,
  CONTEXT_TOKENS: 65536,
  KV_CACHE: 'q8_0',
  RATE_LIMIT_PER_MINUTE: 120,
  ALLOWED_ORIGINS: ['https://kamciosz.github.io', 'http://localhost', 'http://127.0.0.1'],
}

const CONFIG_PATH = path.join(__dirname, 'config.json')

const SUPPORTED_KV_CACHE = ['auto', 'f32', 'f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1', 'planar3', 'iso3', 'planar4', 'iso4', 'turbo3', 'turbo4']

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Request-Id, X-Agent-Role, X-Workflow-Mode',
  'Access-Control-Max-Age': '86400',
}

const gatewayState = {
  activeRequests: 0,
  queuedRequests: [],
  totalRequests: 0,
  failedRequests: 0,
  totalDurationMs: 0,
  totalOutputTokens: 0,
  recent: [],
  rateLimit: new Map(),
  inflight: new Map(),
}

const LOG_DIR = path.join(__dirname, 'logs')
const LOG_PATH = path.join(LOG_DIR, 'proxy-requests.jsonl')
const LOG_MAX_BYTES = 5 * 1024 * 1024

/**
 * Dopisuje wpis JSONL do logu requestów z prostą rotacją po rozmiarze.
 * @param {Object} entry
 * @returns {void}
 */
function appendJsonl(entry) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
    try {
      const stat = fs.statSync(LOG_PATH)
      if (stat.size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_PATH, `${LOG_PATH}.${Date.now()}.bak`)
      }
    } catch {}
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n')
  } catch (error) {
    console.warn('[proxy] log append failed:', error.message)
  }
}

function parseJsonFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  if (content.startsWith('\u00ef\u00bb\u00bf')) content = content.slice(3)
  return JSON.parse(content)
}

// ============================================================================
// KONFIGURACJA
// ============================================================================

/**
 * Wczytuje config.json. Brak pliku = pusty obiekt z domyślnymi wartościami.
 * @returns {{ proxyPort:number, llamaUrl:string, modelName:string, backend:string, allowedOrigins:string[], parallelSlots:number, sdEnabled:boolean, draftModelName:string, speculativeTokens:number, contextMode:string, contextSizeTokens:number, kvCacheQuantization:string, effectiveKvCacheQuantization:string, generationTimeoutMs:number, autoUpdate:boolean, optimizationMode:string, messageBatchSize:number, offlineQueueMax:number, rateLimitPerMinute:number }}
 */
function loadConfig() {
  let cfg = {}
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = parseJsonFile(CONFIG_PATH)
    }
  } catch (error) {
    console.error('[proxy] Nie udało się wczytać config.json:', error.message)
  }
  const contextMode = normalizeContextMode(cfg.contextMode)
  const contextSizeTokens = contextMode === 'native' ? 0 : clampInt(cfg.contextSizeTokens, DEFAULTS.CONTEXT_TOKENS, 65536, 262144)
  const kvCacheQuantization = normalizeKvCache(cfg.kvCacheQuantization || DEFAULTS.KV_CACHE)
  return {
    proxyPort: Number(cfg.proxyPort) || DEFAULTS.PROXY_PORT,
    llamaUrl: cfg.llamaUrl || DEFAULTS.LLAMA_URL,
    modelName: cfg.modelName || 'unknown',
    backend: cfg.backend || 'unknown',
    allowedOrigins: normalizeAllowedOrigins(cfg.allowedOrigins),
    parallelSlots: clampInt(cfg.parallelSlots, 1, 1, 4),
    sdEnabled: cfg.sdEnabled === true,
    draftModelPath: cfg.draftModelPath || '',
    draftModelName: cfg.draftModelName || (cfg.draftModelPath ? path.basename(cfg.draftModelPath) : ''),
    speculativeTokens: clampInt(cfg.speculativeTokens, 4, 1, 16),
    contextMode,
    contextSizeTokens,
    kvCacheQuantization,
    effectiveKvCacheQuantization: normalizeKvCache(cfg.effectiveKvCacheQuantization || resolveKvCache(kvCacheQuantization, contextSizeTokens)),
    generationTimeoutMs: clampInt(cfg.generationTimeoutMs, DEFAULTS.TIMEOUT_MS, 15000, 1800000),
    autoUpdate: cfg.autoUpdate === true,
    optimizationMode: cfg.optimizationMode || 'standard',
    messageBatchSize: clampInt(cfg.messageBatchSize, 10, 1, 50),
    offlineQueueMax: clampInt(cfg.offlineQueueMax, 500, 50, 5000),
    rateLimitPerMinute: clampInt(cfg.rateLimitPerMinute, DEFAULTS.RATE_LIMIT_PER_MINUTE, 10, 600),
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
 * @returns {string}
 */
function normalizeKvCache(value) {
  const raw = String(value || 'auto').trim().toLowerCase()
  if (raw.includes('/')) {
    const [keyType, valueType] = raw.split('/').map((part) => part.trim())
    return SUPPORTED_KV_CACHE.includes(keyType) && SUPPORTED_KV_CACHE.includes(valueType) ? `${keyType}/${valueType}` : 'auto'
  }
  return SUPPORTED_KV_CACHE.includes(raw) ? raw : 'auto'
}

/**
 * Wylicza efektywną kompresję KV cache dla trybu auto.
 * @param {unknown} value
 * @param {unknown} contextSizeTokens
 * @returns {string}
 */
function resolveKvCache(value, contextSizeTokens) {
  const normalized = normalizeKvCache(value)
  if (normalized !== 'auto') return normalized
  return Number(contextSizeTokens) > 32768 ? 'q8_0' : 'f16'
}

function cleanGeneratedText(value) {
  return String(value || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*\?\s*/, '')
    .trim()
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
 * Wysyła prompt do llama-server `/completion` i zwraca wygenerowany tekst oraz metryki.
 * @param {string} prompt
 * @param {{ maxTokens?:number, temperature?:number }} opts
 * @param {string} llamaUrl - bazowy URL llama-server (np. http://127.0.0.1:8080)
 * @param {number} timeoutMs
 * @returns {Promise<Object>}
 */
async function forwardToLlama(prompt, opts, llamaUrl, timeoutMs = DEFAULTS.TIMEOUT_MS, externalController = null) {
  const payload = JSON.stringify({
    prompt,
    n_predict: opts.maxTokens ?? DEFAULTS.MAX_TOKENS,
    temperature: opts.temperature ?? DEFAULTS.TEMPERATURE,
    stream: false,
  })

  const controller = externalController || new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const startedAt = Date.now()
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
    const text = cleanGeneratedText(data.content)
    const durationMs = Date.now() - startedAt
    const outputTokens = estimateTokens(text)
    return {
      text,
      durationMs,
      outputTokens,
      tokensPerSecond: durationMs > 0 ? Math.round((outputTokens / durationMs) * 100000) / 100 : null,
    }
  } catch (error) {
    if (timedOut || error?.name === 'AbortError') {
      throw new Error(`llama-server timeout after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Estymuje liczbę tokenów bez lokalnego tokenizera.
 * @param {string} value
 * @returns {number}
 */
function estimateTokens(value) {
  return Math.max(1, Math.ceil(String(value || '').length / 4))
}

/**
 * Wykonuje generację z limitem współbieżności równym parallelSlots.
 * @param {Object} cfg
 * @param {Function} work
 * @returns {Promise<Object>}
 */
function enqueueGeneration(cfg, work) {
  return new Promise((resolve, reject) => {
    const queuedAt = Date.now()
    const run = () => {
      gatewayState.activeRequests += 1
      Promise.resolve()
        .then(() => work(Date.now() - queuedAt))
        .then(resolve, reject)
        .finally(() => {
          gatewayState.activeRequests = Math.max(0, gatewayState.activeRequests - 1)
          const next = gatewayState.queuedRequests.shift()
          if (next) next()
        })
    }
    if (gatewayState.activeRequests < Math.max(1, cfg.parallelSlots || 1)) run()
    else gatewayState.queuedRequests.push(run)
  })
}

/**
 * Zapisuje metrykę requestu w pamięci procesu.
 * @param {Object} metric
 * @returns {void}
 */
function recordMetric(metric) {
  gatewayState.totalRequests += 1
  if (metric.errorCode) gatewayState.failedRequests += 1
  gatewayState.totalDurationMs += Number(metric.durationMs || 0)
  gatewayState.totalOutputTokens += Number(metric.outputTokens || 0)
  gatewayState.recent.unshift({ ...metric, at: new Date().toISOString() })
  gatewayState.recent = gatewayState.recent.slice(0, 50)
}

/**
 * Buduje snapshot metryk gatewaya.
 * @param {Object} cfg
 * @returns {Object}
 */
function metricsSnapshot(cfg) {
  return {
    ok: true,
    model: cfg.modelName,
    backend: cfg.backend,
    activeRequests: gatewayState.activeRequests,
    queuedRequests: gatewayState.queuedRequests.length,
    totalRequests: gatewayState.totalRequests,
    failedRequests: gatewayState.failedRequests,
    averageDurationMs: gatewayState.totalRequests ? Math.round(gatewayState.totalDurationMs / gatewayState.totalRequests) : 0,
    averageOutputTokens: gatewayState.totalRequests ? Math.round(gatewayState.totalOutputTokens / gatewayState.totalRequests) : 0,
    recent: gatewayState.recent,
  }
}

/**
 * Prosty lokalny rate limit per origin/IP.
 * @param {import('node:http').IncomingMessage} req
 * @param {Object} cfg
 * @returns {boolean}
 */
function consumeRateLimit(req, cfg) {
  const key = req.headers.origin || req.socket.remoteAddress || 'local'
  const now = Date.now()
  const bucket = gatewayState.rateLimit.get(key) || { count: 0, resetAt: now + 60000 }
  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + 60000
  }
  bucket.count += 1
  gatewayState.rateLimit.set(key, bucket)
  return bucket.count <= cfg.rateLimitPerMinute
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
      generationTimeoutMs: cfg.generationTimeoutMs,
      autoUpdate: cfg.autoUpdate,
      optimizationMode: cfg.optimizationMode,
      messageBatchSize: cfg.messageBatchSize,
      offlineQueueMax: cfg.offlineQueueMax,
      rateLimitPerMinute: cfg.rateLimitPerMinute,
    },
  })
}

async function handleHealthSmoke(cfg, req, res) {
  const startedAt = Date.now()
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const requestedTimeoutMs = Number(requestUrl.searchParams.get('timeoutMs')) || Math.min(cfg.generationTimeoutMs, 120000)
  const timeoutMs = Math.min(Math.max(requestedTimeoutMs, 15000), cfg.generationTimeoutMs, 1800000)
  try {
    const result = await forwardToLlama(
      'Odpowiedz dokładnie jednym słowem: OK',
      { maxTokens: 8, temperature: 0 },
      cfg.llamaUrl,
      timeoutMs,
    )
    sendJson(req, res, cfg, 200, {
      ok: true,
      proxy: 'up',
      llama: 'generated',
      model: cfg.modelName,
      text: result.text,
      timeoutMs,
      durationMs: result.durationMs || Date.now() - startedAt,
    })
  } catch (error) {
    sendJson(req, res, cfg, 502, {
      ok: false,
      proxy: 'up',
      llama: 'smoke-failed',
      model: cfg.modelName,
      detail: error.message,
      timeoutMs,
      durationMs: Date.now() - startedAt,
    })
  }
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
  if (!consumeRateLimit(req, cfg)) {
    sendJson(req, res, cfg, 429, { error: 'Rate limit exceeded', limitPerMinute: cfg.rateLimitPerMinute })
    return
  }
  const requestId = String(body.requestId || req.headers['x-request-id'] || randomUUID())
  const workflowMode = String(body.workflowMode || req.headers['x-workflow-mode'] || 'standard')
  const role = String(body.role || req.headers['x-agent-role'] || 'shared')
  const requestedTimeoutMs = Number(body.timeoutMs) || cfg.generationTimeoutMs
  const timeoutMs = role === 'station'
    ? Math.min(Math.max(requestedTimeoutMs, cfg.generationTimeoutMs, DEFAULTS.TIMEOUT_MS), 1800000)
    : Math.min(requestedTimeoutMs, cfg.generationTimeoutMs)
  const promptChars = body.prompt.length
  const estimatedInputTokens = estimateTokens(body.prompt)
  const controller = new AbortController()
  gatewayState.inflight.set(requestId, controller)
  try {
    const startedAt = Date.now()
    const result = await enqueueGeneration(
      cfg,
      async (queueWaitMs) => ({
        queueWaitMs,
        ...(await forwardToLlama(
          body.prompt,
          { maxTokens: body.maxTokens, temperature: body.temperature },
          cfg.llamaUrl,
          timeoutMs,
          controller,
        )),
      }),
    )
    const metric = {
      requestId,
      role,
      workflowMode,
      model: cfg.modelName,
      promptChars,
      estimatedInputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs || Date.now() - startedAt,
      queueWaitMs: result.queueWaitMs,
      tokensPerSecond: result.tokensPerSecond,
    }
    recordMetric(metric)
    appendJsonl({ kind: 'generate', at: new Date().toISOString(), ...metric })
    sendJson(req, res, cfg, 200, { text: result.text, ...metric })
  } catch (error) {
    const cancelled = error?.name === 'AbortError' && !String(error.message || '').includes('timeout')
    const errorCode = cancelled ? 'cancelled' : (error.message.includes('timeout') ? 'timeout' : 'llama_down')
    console.error('[proxy] forwardToLlama failed:', cfg.llamaUrl, error.message)
    const metric = { requestId, role, workflowMode, model: cfg.modelName, promptChars, estimatedInputTokens, durationMs: 0, outputTokens: 0, errorCode }
    recordMetric(metric)
    appendJsonl({ kind: 'generate', at: new Date().toISOString(), ...metric, errorMessage: error.message })
    sendJson(req, res, cfg, cancelled ? 499 : 502, { error: cancelled ? 'cancelled' : 'llama-server unreachable', detail: error.message, requestId })
  } finally {
    gatewayState.inflight.delete(requestId)
  }
}

/**
 * Anuluje aktywny request po requestId.
 * @param {string} requestId
 * @returns {boolean}
 */
function cancelInflight(requestId) {
  const controller = gatewayState.inflight.get(requestId)
  if (!controller) return false
  try {
    controller.abort()
  } catch {}
  gatewayState.inflight.delete(requestId)
  return true
}

/**
 * Obsługuje OpenAI-compatible POST /v1/chat/completions (bez streamingu).
 * @param {Object} cfg
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {Promise<void>}
 */
async function handleChatCompletions(cfg, req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (error) {
    sendJson(req, res, cfg, 400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } })
    return
  }
  const messages = Array.isArray(body?.messages) ? body.messages : []
  if (!messages.length) {
    sendJson(req, res, cfg, 400, { error: { message: 'Missing messages', type: 'invalid_request_error' } })
    return
  }
  if (!consumeRateLimit(req, cfg)) {
    sendJson(req, res, cfg, 429, { error: { message: 'Rate limit exceeded', type: 'rate_limit_exceeded' } })
    return
  }
  const prompt = messages.map((m) => `${String(m?.role || 'user').toUpperCase()}: ${String(m?.content || '').trim()}`).join('\n\n') + '\n\nASSISTANT:'
  const requestId = String(body.user || req.headers['x-request-id'] || randomUUID())
  const controller = new AbortController()
  gatewayState.inflight.set(requestId, controller)
  try {
    const result = await enqueueGeneration(cfg, async () => forwardToLlama(
      prompt,
      { maxTokens: body.max_tokens, temperature: body.temperature },
      cfg.llamaUrl,
      Math.min(Number(body.timeoutMs) || cfg.generationTimeoutMs, cfg.generationTimeoutMs),
      controller,
    ))
    const metric = { requestId, role: 'shared', workflowMode: 'openai-compat', model: cfg.modelName, promptChars: prompt.length, estimatedInputTokens: estimateTokens(prompt), outputTokens: result.outputTokens, durationMs: result.durationMs, tokensPerSecond: result.tokensPerSecond }
    recordMetric(metric)
    appendJsonl({ kind: 'chat.completions', at: new Date().toISOString(), ...metric })
    sendJson(req, res, cfg, 200, {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: cfg.modelName,
      choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: estimateTokens(prompt), completion_tokens: result.outputTokens, total_tokens: estimateTokens(prompt) + result.outputTokens },
    })
  } catch (error) {
    const cancelled = error?.name === 'AbortError' && !String(error.message || '').includes('timeout')
    sendJson(req, res, cfg, cancelled ? 499 : 502, { error: { message: error.message, type: cancelled ? 'cancelled' : 'upstream_error' } })
  } finally {
    gatewayState.inflight.delete(requestId)
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
  const requestUrl = new URL(url, 'http://127.0.0.1')
  const pathname = requestUrl.pathname
  if (req.method === 'GET' && pathname === '/health') {
    await handleHealth(cfg, req, res)
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'GET' && pathname === '/health/smoke') {
    await handleHealthSmoke(cfg, req, res)
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'GET' && pathname === '/metrics') {
    sendJson(req, res, cfg, 200, metricsSnapshot(cfg))
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'GET' && pathname === '/models') {
    sendJson(req, res, cfg, 200, {
      models: [{ name: cfg.modelName, backend: cfg.backend, contextTokens: cfg.contextSizeTokens, kvCache: cfg.effectiveKvCacheQuantization }],
      capabilities: ['generate', 'metrics', 'queue', 'rate-limit', 'cancel', 'openai-chat'],
    })
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'POST' && pathname === '/generate') {
    await handleGenerate(cfg, req, res)
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'POST' && pathname === '/v1/chat/completions') {
    await handleChatCompletions(cfg, req, res)
    logLine(req.method, url, res.statusCode, startedAt)
    return
  }
  if (req.method === 'POST' && pathname.startsWith('/cancel/')) {
    const requestId = decodeURIComponent(pathname.slice('/cancel/'.length))
    const ok = cancelInflight(requestId)
    sendJson(req, res, cfg, ok ? 200 : 404, { ok, requestId })
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
