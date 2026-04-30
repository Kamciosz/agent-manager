/**
 * @file workstation-agent.js
 * @description Lekki agent lokalny dla szkolnej stacji roboczej. Loguje sie do
 *              Supabase ograniczona tozsamoscia stacji, rejestruje komputer, publikuje liste
 *              modeli GGUF, odbiera wiadomosci i kolejke jobow oraz wykonuje je
 *              przez lokalny proxy AI dzialajacy na 127.0.0.1.
 *
 *              Brak zewnetrznych zaleznosci - tylko Node 18+ i fetch.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { getScheduleState, normalizeSchedule } = require('./runtime-schedule')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const LOGS_DIR = path.join(__dirname, 'logs')
const OFFLINE_QUEUE_PATH = path.join(LOGS_DIR, 'workstation-offline-queue.json')

const SUPPORTED_KV_CACHE = ['auto', 'f32', 'f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1', 'planar3', 'iso3', 'planar4', 'iso4', 'turbo3', 'turbo4']

const DEFAULTS = {
  POLL_MS: 8000,
  POLL_JITTER_MS: 2000,
  HEARTBEAT_MS: 15000,
  MESSAGE_POLL_MS: 6000,
  LEASE_SECONDS: 900,
  AUTH_RETRY_MS: [3000, 7000, 15000, 30000],
  GENERATION_TIMEOUT_MS: 600000,
  CONTEXT_TOKENS: 65536,
  KV_CACHE: 'q8_0',
  MESSAGE_BATCH_SIZE: 10,
  OFFLINE_QUEUE_MAX: 500,
}

let activeJobs = 0
let shuttingDown = false
let workstationId = null
let authSession = null
let scheduleStopAnnounced = false
let recentJobMetrics = []

function log(...args) {
  console.log('[workstation-agent]', ...args)
}

function parseJsonFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1)
  if (content.startsWith('\u00ef\u00bb\u00bf')) content = content.slice(3)
  return JSON.parse(content)
}

function loadConfig() {
  let raw
  try {
    raw = parseJsonFile(CONFIG_PATH)
  } catch (error) {
    throw new Error(`Nie moge wczytac local-ai-proxy/config.json (${error.message}). Uruchom start.bat --config albo ./start.sh --config i przejdz konfiguracje stacji jeszcze raz.`)
  }
  const schedule = normalizeSchedule(raw)
  const contextMode = normalizeContextMode(raw.contextMode)
  const contextSizeTokens = contextMode === 'native' ? 0 : clampInt(raw.contextSizeTokens, DEFAULTS.CONTEXT_TOKENS, 65536, 262144)
  const kvCacheQuantization = normalizeKvCache(raw.kvCacheQuantization || DEFAULTS.KV_CACHE)
  const stationMode = String(raw.stationMode || raw.stationKind || 'classroom').trim().toLowerCase() === 'operator' ? 'operator' : 'classroom'
  if (raw.scheduleEnabled === true && !schedule.valid) {
    log('Niepoprawny harmonogram w config.json - wylaczam schedule dla tej sesji.', raw.scheduleStart, raw.scheduleEnd)
  }
  return {
    supabaseUrl: raw.supabaseUrl,
    supabaseAnonKey: raw.supabaseAnonKey,
    enrollmentToken: raw.enrollmentToken,
    stationAccessToken: raw.stationAccessToken,
    stationRefreshToken: raw.stationRefreshToken,
    stationTokenExpiresAt: Number(raw.stationTokenExpiresAt) || 0,
    stationUserId: raw.stationUserId,
    stationUserEmail: raw.stationUserEmail,
    stationOwnerUserId: raw.stationOwnerUserId,
    stationEnrollmentTokenId: raw.stationEnrollmentTokenId,
    workstationEmail: raw.workstationEmail,
    workstationPassword: raw.workstationPassword,
    workstationName: raw.workstationName || os.hostname(),
    modelPath: raw.modelPath || '',
    modelName: raw.modelName || '',
    backend: raw.backend || 'cpu',
    proxyPort: Number(raw.proxyPort) || 3001,
    llamaPort: Number(raw.llamaPort) || 8080,
    stationMode,
    acceptsJobs: stationMode === 'classroom' && raw.acceptsJobs !== false,
    scheduleEnabled: schedule.enabled,
    scheduleStart: schedule.start,
    scheduleEnd: schedule.end,
    scheduleOutsideAction: schedule.outsideAction,
    scheduleEndAction: schedule.endAction,
    scheduleDumpOnStop: schedule.dumpOnStop,
    parallelSlots: clampInt(raw.parallelSlots, 1, 1, 4),
    sdEnabled: raw.sdEnabled === true,
    draftModelPath: raw.draftModelPath || '',
    draftModelName: raw.draftModelName || (raw.draftModelPath ? path.basename(raw.draftModelPath) : ''),
    speculativeTokens: clampInt(raw.speculativeTokens, 4, 1, 16),
    contextMode,
    contextSizeTokens,
    kvCacheQuantization,
    effectiveKvCacheQuantization: normalizeKvCache(raw.effectiveKvCacheQuantization || resolveKvCache(kvCacheQuantization, contextSizeTokens)),
    generationTimeoutMs: clampInt(raw.generationTimeoutMs, DEFAULTS.GENERATION_TIMEOUT_MS, 15000, 1800000),
    pollMs: clampInt(raw.pollMs, DEFAULTS.POLL_MS, 3000, 60000),
    pollJitterMs: clampInt(raw.pollJitterMs, DEFAULTS.POLL_JITTER_MS, 0, 30000),
    leaseSeconds: clampInt(raw.leaseSeconds, DEFAULTS.LEASE_SECONDS, 60, 3600),
    autoUpdate: raw.autoUpdate === true,
    optimizationMode: raw.optimizationMode || 'standard',
    messageBatchSize: clampInt(raw.messageBatchSize, DEFAULTS.MESSAGE_BATCH_SIZE, 1, 50),
    offlineQueueMax: clampInt(raw.offlineQueueMax, DEFAULTS.OFFLINE_QUEUE_MAX, 50, 5000),
  }
}

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function jobMetricsSummary() {
  const speeds = recentJobMetrics.map((item) => item.tokensPerSecond).filter((value) => Number.isFinite(value))
  const failures = recentJobMetrics.filter((item) => item.ok === false).length
  return {
    tokensPerSecondP50: percentile(speeds, 50),
    tokensPerSecondP95: percentile(speeds, 95),
    failureRate24h: recentJobMetrics.length ? Math.round((failures / recentJobMetrics.length) * 10000) / 10000 : 0,
    sampleSize: recentJobMetrics.length,
  }
}

function recordJobMetric(metric) {
  recentJobMetrics.unshift({ ...metric, at: Date.now() })
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  recentJobMetrics = recentJobMetrics.filter((item) => item.at >= cutoff).slice(0, 100)
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizeContextMode(value) {
  return String(value || 'native').trim().toLowerCase() === 'native' ? 'native' : 'extended'
}

function normalizeKvCache(value) {
  const raw = String(value || 'auto').trim().toLowerCase()
  if (raw.includes('/')) {
    const [keyType, valueType] = raw.split('/').map((part) => part.trim())
    return SUPPORTED_KV_CACHE.includes(keyType) && SUPPORTED_KV_CACHE.includes(valueType) ? `${keyType}/${valueType}` : 'auto'
  }
  return SUPPORTED_KV_CACHE.includes(raw) ? raw : 'auto'
}

function resolveKvCache(value, contextSizeTokens) {
  const normalized = normalizeKvCache(value)
  if (normalized !== 'auto') return normalized
  return Number(contextSizeTokens) > 32768 ? 'q8_0' : 'f16'
}

function ensureRequiredConfig(cfg) {
  const required = ['supabaseUrl', 'supabaseAnonKey']
  const missing = required.filter((key) => !cfg[key])
  if (missing.length) {
    throw new Error(`Brak wymaganych pol w config.json: ${missing.join(', ')}. Uruchom start.bat --config albo ./start.sh --config i uzupelnij konfiguracje stacji.`)
  }
  const hasStationSession = Boolean(cfg.stationRefreshToken || cfg.stationAccessToken)
  const hasEnrollmentToken = Boolean(cfg.enrollmentToken)
  const hasLegacyPassword = Boolean(cfg.workstationEmail && cfg.workstationPassword)
  if (!hasStationSession && !hasEnrollmentToken && !hasLegacyPassword) {
    throw new Error('Brak tokenu stacji. Wygeneruj token instalacyjny w dashboardzie i uruchom start.bat --config albo ./start.sh --config.')
  }
  if (hasLegacyPassword && !hasStationSession && !hasEnrollmentToken) {
    log('Uwaga: uzywam legacy loginu operatora z config.json. Wygeneruj token stacji w dashboardzie, zeby nie trzymac hasla operatora lokalnie.')
  }
}

function currentStatus(cfg) {
  if (!cfg.acceptsJobs) return 'offline'
  if (!isWithinSchedule(cfg)) return 'offline'
  return activeJobs >= cfg.parallelSlots ? 'busy' : 'online'
}

function availableSlots(cfg) {
  return Math.max(0, cfg.parallelSlots - activeJobs)
}

function resourceSnapshot() {
  const memory = process.memoryUsage()
  return {
    freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
    loadavg: os.loadavg().map((value) => Math.round(value * 100) / 100),
    uptimeSec: Math.round(os.uptime()),
    processRssMb: Math.round(memory.rss / 1024 / 1024),
  }
}

function ensureLogsDir() {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
}

function isWithinSchedule(cfg) {
  return getScheduleState(cfg).inside
}

function buildHeaders(token, apikey, extra = {}) {
  return {
    apikey,
    Authorization: `Bearer ${token}`,
    ...extra,
  }
}

async function signIn(cfg) {
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: cfg.workstationEmail,
      password: cfg.workstationPassword,
    }),
  })
  if (!response.ok) {
    throw new Error(`Supabase auth failed: HTTP ${response.status}`)
  }
  return response.json()
}

async function signInWithRetry(cfg, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await signIn(cfg)
    } catch (error) {
      if (attempt === attempts) throw error
      const waitMs = DEFAULTS.AUTH_RETRY_MS[Math.min(attempt - 1, DEFAULTS.AUTH_RETRY_MS.length - 1)]
      log(`Logowanie do Supabase nieudane (${attempt}/${attempts}): ${error.message}. Ponawiam za ${waitMs}ms.`)
      await sleep(waitMs)
    }
  }
  throw new Error('Supabase auth retry exhausted')
}

function readLocalConfig() {
  try {
    return parseJsonFile(CONFIG_PATH)
  } catch {
    return {}
  }
}

function saveLocalConfigPatch(cfg, patch, deleteKeys = []) {
  const raw = readLocalConfig()
  for (const key of deleteKeys) delete raw[key]
  Object.assign(raw, patch)
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n')
  for (const key of deleteKeys) delete cfg[key]
  Object.assign(cfg, patch)
}

function stationSessionFromConfig(cfg) {
  return {
    access_token: cfg.stationAccessToken,
    refresh_token: cfg.stationRefreshToken,
    expires_at: cfg.stationTokenExpiresAt || null,
    user: {
      id: cfg.stationUserId,
      email: cfg.stationUserEmail || 'workstation@local',
      user_metadata: {
        role: 'workstation',
        owner_user_id: cfg.stationOwnerUserId || null,
        enrollment_token_id: cfg.stationEnrollmentTokenId || null,
      },
      app_metadata: {
        role: 'workstation',
        owner_user_id: cfg.stationOwnerUserId || null,
        enrollment_token_id: cfg.stationEnrollmentTokenId || null,
      },
    },
  }
}

function hasFreshStationAccessToken(cfg) {
  if (!cfg.stationAccessToken || !cfg.stationTokenExpiresAt) return false
  return Number(cfg.stationTokenExpiresAt) > Math.floor(Date.now() / 1000) + 60
}

function saveStationSession(cfg, data) {
  const session = data.session || data
  const station = data.station || {}
  if (!session.access_token || !session.refresh_token || !session.user?.id) {
    throw new Error('Enrollment endpoint did not return a complete station session')
  }
  saveLocalConfigPatch(cfg, {
    stationAccessToken: session.access_token,
    stationRefreshToken: session.refresh_token,
    stationTokenExpiresAt: Number(session.expires_at) || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
    stationUserId: session.user.id,
    stationUserEmail: station.email || session.user.email || '',
    stationOwnerUserId: station.owner_user_id || session.user.app_metadata?.owner_user_id || session.user.user_metadata?.owner_user_id || cfg.stationOwnerUserId || '',
    stationEnrollmentTokenId: station.enrollment_token_id || session.user.app_metadata?.enrollment_token_id || session.user.user_metadata?.enrollment_token_id || cfg.stationEnrollmentTokenId || '',
  }, ['enrollmentToken', 'workstationEmail', 'workstationPassword'])
  log('Zapisano ograniczona sesje stacji. Haslo operatora nie jest przechowywane lokalnie.')
  return stationSessionFromConfig(cfg)
}

async function redeemEnrollmentToken(cfg) {
  if (!cfg.enrollmentToken) throw new Error('Missing enrollment token')
  const response = await fetch(`${cfg.supabaseUrl}/functions/v1/redeem-workstation-enrollment`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      Authorization: `Bearer ${cfg.supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      token: cfg.enrollmentToken,
      workstationName: cfg.workstationName || os.hostname(),
      hostname: os.hostname(),
      os: os.platform(),
      arch: os.arch(),
    }),
  })
  if (!response.ok) {
    throw new Error(`Enrollment token redeem failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return saveStationSession(cfg, await response.json())
}

async function refreshStationSession(cfg) {
  if (!cfg.stationRefreshToken) {
    if (hasFreshStationAccessToken(cfg)) return stationSessionFromConfig(cfg)
    throw new Error('Brak refresh tokenu stacji. Wygeneruj nowy token instalacyjny w dashboardzie.')
  }
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: cfg.supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: cfg.stationRefreshToken }),
  })
  if (!response.ok) {
    throw new Error(`Station session refresh failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return saveStationSession(cfg, await response.json())
}

async function authenticate(cfg) {
  if (hasFreshStationAccessToken(cfg)) return stationSessionFromConfig(cfg)
  if (cfg.stationRefreshToken) return refreshStationSession(cfg)
  if (cfg.enrollmentToken) return redeemEnrollmentToken(cfg)
  return signInWithRetry(cfg)
}

async function refreshSession(cfg) {
  log('Odswiezam sesje Supabase po bledzie 401.')
  authSession = cfg.stationRefreshToken || cfg.stationAccessToken
    ? await refreshStationSession(cfg)
    : await signInWithRetry(cfg, 2)
  return authSession
}

async function restUpsert(cfg, session, table, rows, onConflict, retry = true) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  })
  if (response.status === 401 && retry) {
    return restUpsert(cfg, await refreshSession(cfg), table, rows, onConflict, false)
  }
  if (!response.ok) {
    throw new Error(`${table} upsert failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return response.json()
}

async function restInsert(cfg, session, table, rows, retry = true) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify(rows),
  })
  if (response.status === 401 && retry) {
    return restInsert(cfg, await refreshSession(cfg), table, rows, false)
  }
  if (!response.ok) {
    throw new Error(`${table} insert failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return []
}

async function restPatch(cfg, session, table, filter, payload, retry = true, returnRepresentation = false) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: returnRepresentation ? 'return=representation' : 'return=minimal',
    }),
    body: JSON.stringify(payload),
  })
  if (response.status === 401 && retry) {
    return restPatch(cfg, await refreshSession(cfg), table, filter, payload, false, returnRepresentation)
  }
  if (!response.ok) {
    throw new Error(`${table} patch failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  if (returnRepresentation) return response.json()
  return []
}

async function restSelect(cfg, session, table, query, retry = true) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey),
  })
  if (response.status === 401 && retry) {
    return restSelect(cfg, await refreshSession(cfg), table, query, false)
  }
  if (!response.ok) {
    throw new Error(`${table} select failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return response.json()
}

async function restRpc(cfg, session, fnName, payload, retry = true) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload || {}),
  })
  if (response.status === 401 && retry) {
    return restRpc(cfg, await refreshSession(cfg), fnName, payload, false)
  }
  if (!response.ok) {
    throw new Error(`${fnName} rpc failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return response.json()
}

async function responseDetail(response) {
  try {
    const text = await response.text()
    return text ? text.slice(0, 300) : ''
  } catch {
    return ''
  }
}

function scanModels(cfg) {
  const modelsDir = cfg.modelPath ? path.dirname(cfg.modelPath) : path.join(__dirname, 'models')
  const entries = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir) : []
  const models = entries
    .filter((name) => name.endsWith('.gguf'))
    .map((name) => ({
      model_label: name,
      model_path: path.join(modelsDir, name),
      is_loaded: name === cfg.modelName,
      is_default: name === cfg.modelName,
      last_seen_at: new Date().toISOString(),
    }))

  if (!models.length && cfg.modelName) {
    models.push({
      model_label: cfg.modelName,
      model_path: cfg.modelPath || null,
      is_loaded: true,
      is_default: true,
      last_seen_at: new Date().toISOString(),
    })
  }

  return models
}

function workstationPayload(cfg, userId, statusOverride) {
  const ownerUserId = cfg.stationOwnerUserId || userId
  const stationUserId = cfg.stationUserId || userId
  const metrics = jobMetricsSummary()
  return {
    display_name: cfg.workstationName,
    hostname: os.hostname(),
    operator_user_id: ownerUserId,
    owner_user_id: ownerUserId,
    station_user_id: stationUserId,
    enrollment_token_id: cfg.stationEnrollmentTokenId || null,
    os: os.platform(),
    arch: os.arch(),
    gpu_backend: cfg.backend,
    status: statusOverride || currentStatus(cfg),
    current_model_name: cfg.modelName || null,
    accepts_jobs: cfg.acceptsJobs,
    schedule_enabled: cfg.scheduleEnabled,
    schedule_start: cfg.scheduleStart,
    schedule_end: cfg.scheduleEnd,
    last_seen_at: new Date().toISOString(),
    metadata: {
      proxyPort: cfg.proxyPort,
      llamaPort: cfg.llamaPort,
      modelPath: cfg.modelPath || null,
      parallelSlots: cfg.parallelSlots,
      activeJobs,
      availableSlots: availableSlots(cfg),
      stationKind: cfg.stationMode,
      sdEnabled: cfg.sdEnabled,
      draftModelName: cfg.draftModelName || null,
      speculativeTokens: cfg.speculativeTokens,
      contextMode: cfg.contextMode,
      contextSizeTokens: cfg.contextSizeTokens,
      kvCacheQuantization: cfg.kvCacheQuantization,
      effectiveKvCacheQuantization: cfg.effectiveKvCacheQuantization,
      generationTimeoutMs: cfg.generationTimeoutMs,
      autoUpdate: cfg.autoUpdate,
      optimizationMode: cfg.optimizationMode,
      messageBatchSize: cfg.messageBatchSize,
      offlineQueueDepth: offlineQueueDepth(),
      pollMs: cfg.pollMs,
      pollJitterMs: cfg.pollJitterMs,
      leaseSeconds: cfg.leaseSeconds,
      tokensPerSecondP50: metrics.tokensPerSecondP50,
      tokensPerSecondP95: metrics.tokensPerSecondP95,
      failureRate24h: metrics.failureRate24h,
      metricsSampleSize: metrics.sampleSize,
      resources: resourceSnapshot(),
      authMode: cfg.stationUserId ? 'station-token' : 'legacy-operator-password',
      scheduleOutsideAction: cfg.scheduleOutsideAction,
      scheduleEndAction: cfg.scheduleEndAction,
      scheduleDumpOnStop: cfg.scheduleDumpOnStop,
      scheduleInside: isWithinSchedule(cfg),
    },
  }
}

async function upsertWorkstation(cfg, session) {
  const rows = await restUpsert(cfg, session, 'workstations', [workstationPayload(cfg, session.user.id)], 'hostname')
  workstationId = rows[0]?.id || workstationId
  return workstationId
}

async function syncModels(cfg, session) {
  if (!workstationId) return
  const models = scanModels(cfg).map((model) => ({
    workstation_id: workstationId,
    ...model,
  }))
  if (!models.length) return
  await restUpsert(cfg, session, 'workstation_models', models, 'workstation_id,model_label')
}

async function heartbeat(cfg, session, statusOverride) {
  if (!workstationId) return
  await restPatch(cfg, session, 'workstations', `id=eq.${encodeURIComponent(workstationId)}`, workstationPayload(cfg, session.user.id, statusOverride))
}

async function fetchQueuedJobs(cfg, session) {
  const limit = availableSlots(cfg)
  if (!workstationId || !cfg.acceptsJobs || !isWithinSchedule(cfg) || limit < 1) return []
  try {
    await restRpc(cfg, session, 'release_expired_workstation_jobs', { p_workstation_id: workstationId })
  } catch (error) {
    log('RPC release_expired_workstation_jobs niedostepne:', error.message)
  }
  try {
    const rows = await restRpc(cfg, session, 'claim_workstation_jobs', {
      p_workstation_id: workstationId,
      p_limit: limit,
      p_lease_seconds: cfg.leaseSeconds,
    })
    if (Array.isArray(rows)) return rows
  } catch (error) {
    log('RPC claim_workstation_jobs niedostepne, uzywam fallback select:', error.message)
  }
  const rows = await restSelect(
    cfg,
    session,
    'workstation_jobs',
    `select=*&workstation_id=eq.${encodeURIComponent(workstationId)}&status=eq.queued&order=created_at.asc&limit=${limit}`,
  )
  return rows || []
}

async function fetchUnreadMessages(cfg, session) {
  if (!workstationId) return []
  return restSelect(
    cfg,
    session,
    'workstation_messages',
    `select=*&workstation_id=eq.${encodeURIComponent(workstationId)}&sender_kind=eq.user&read_at=is.null&order=created_at.asc&limit=20`,
  )
}

function buildJobPrompt(job) {
  const payload = job.payload || {}
  const context = payload.context || {}
  const routing = payload.routing || context.raw?.routing || {}
  const route = String(routing.route || 'standard')
  const contextLimit = route === 'instant' ? 0 : route === 'fast' ? 600 : route === 'standard' ? 1200 : 2400
  const metadata = [
    payload.git_repo ? `Repo: ${payload.git_repo}` : '',
    contextLimit && context.raw ? `Kontekst JSON: ${JSON.stringify(context.raw).slice(0, contextLimit)}` : '',
  ].filter(Boolean).join('\n')
  return [
    'Jestes agentem AI na szkolnej stacji roboczej. Masz wykonac zadanie i zwrocic sam wynik pracy.',
    'Nie przepisuj w odpowiedzi naglowkow ani pol technicznych takich jak Tytul, Opis, Repo, Kontekst, routing lub payload.',
    `Tryb zadania: ${route}. ${payload.generation?.workflowMode ? `Workflow: ${payload.generation.workflowMode}.` : ''}`,
    payload.generation?.outputContract ? `Kontrakt odpowiedzi: ${payload.generation.outputContract}` : '',
    'Jesli zadanie jest prostym pytaniem albo obliczeniem, odpowiedz bezposrednio jednym zdaniem z wynikiem.',
    payload.instructions || 'Wykonaj zadanie mozliwie konkretnie.',
    `Zadanie: ${payload.title || ''}`,
    `Szczegoly: ${payload.description || ''}`,
    metadata ? `Dane pomocnicze do wykorzystania wewnetrznie:\n${metadata}` : '',
    context?.raw?.workflow?.id === 'hermes-labyrinth'
      ? 'Dla Hermes Labyrinth odpowiedz sekcjami: Mapa, Sciezka, Dowody, Weryfikacja, Raport koncowy.'
      : '',
    'Odpowiedz po polsku. Jesli generujesz kod, dolacz go w jednej odpowiedzi i napisz, jak go sprawdzic.',
  ].filter(Boolean).join('\n')
}

async function callLocalProxy(cfg, prompt, generation = {}) {
  const response = await fetch(`http://127.0.0.1:${cfg.proxyPort}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Role': generation.role || 'station',
      'X-Workflow-Mode': generation.workflowMode || 'standard',
    },
    body: JSON.stringify({
      requestId: generation.requestId,
      prompt,
      maxTokens: generation.maxTokens || 600,
      temperature: generation.temperature ?? 0.4,
      timeoutMs: generation.timeoutMs || cfg.generationTimeoutMs,
      workflowMode: generation.workflowMode || 'standard',
      role: generation.role || 'station',
    }),
  })
  if (!response.ok) {
    throw new Error(`Local proxy HTTP ${response.status} ${await responseDetail(response)}`)
  }
  const data = await response.json()
  return {
    text: (data.text || '').trim(),
    durationMs: data.durationMs || null,
    requestId: data.requestId || generation.requestId || null,
    outputTokens: data.outputTokens || null,
    estimatedInputTokens: data.estimatedInputTokens || null,
    tokensPerSecond: data.tokensPerSecond || null,
    workflowMode: data.workflowMode || generation.workflowMode || null,
    model: data.model || null,
  }
}

function readOfflineQueue() {
  try {
    if (!fs.existsSync(OFFLINE_QUEUE_PATH)) return []
    const parsed = parseJsonFile(OFFLINE_QUEUE_PATH)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    log('Nie moge wczytac offline queue:', error.message)
    return []
  }
}

function writeOfflineQueue(items) {
  ensureLogsDir()
  fs.writeFileSync(OFFLINE_QUEUE_PATH, JSON.stringify(items, null, 2) + '\n')
}

function offlineQueueDepth() {
  return readOfflineQueue().length
}

function queueStationMessages(cfg, messages, reason) {
  const current = readOfflineQueue()
  const now = new Date().toISOString()
  const next = [
    ...current,
    ...messages.map((message) => ({
      ...message,
      queued_at: message.queued_at || now,
      queue_reason: reason || message.queue_reason || 'offline',
    })),
  ].slice(-cfg.offlineQueueMax)
  writeOfflineQueue(next)
  log(`Zapisano ${messages.length} wiadomosci do offline queue (${next.length}/${cfg.offlineQueueMax}).`)
}

function chunkArray(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

async function appendStationMessageDirect(cfg, session, messages) {
  for (const batch of chunkArray(messages, cfg.messageBatchSize)) {
    await restInsert(cfg, session, 'workstation_messages', batch)
  }
}

async function appendStationMessage(cfg, session, message) {
  const messages = Array.isArray(message) ? message : [message]
  try {
    await appendStationMessageDirect(cfg, session, messages)
    return true
  } catch (error) {
    queueStationMessages(cfg, messages, error.message)
    return false
  }
}

async function flushOfflineQueue(cfg, session) {
  const queued = readOfflineQueue()
  if (!queued.length) return
  let remaining = queued
  let sent = 0
  for (const batch of chunkArray(queued, cfg.messageBatchSize)) {
    try {
      await appendStationMessageDirect(cfg, session, batch)
      sent += batch.length
      remaining = remaining.slice(batch.length)
      writeOfflineQueue(remaining)
    } catch (error) {
      writeOfflineQueue(remaining)
      log('Offline queue nadal czeka:', error.message)
      return
    }
  }
  if (sent > 0) log(`Wyslano offline queue: ${sent} wiadomosci.`)
}

async function updateTaskStatus(cfg, session, taskId, status) {
  if (!taskId) return
  const filter = status === 'cancelled'
    ? `id=eq.${encodeURIComponent(taskId)}`
    : `id=eq.${encodeURIComponent(taskId)}&status=neq.cancelled`
  await restPatch(cfg, session, 'tasks', filter, { status })
}

async function updateTaskLifecycle(cfg, session, taskId, payload) {
  if (!taskId) return
  const status = payload.status || ''
  const filter = status === 'cancelled'
    ? `id=eq.${encodeURIComponent(taskId)}`
    : `id=eq.${encodeURIComponent(taskId)}&status=neq.cancelled`
  await restPatch(cfg, session, 'tasks', filter, payload)
}

async function claimQueuedJob(cfg, session, job) {
  const rows = await restPatch(
    cfg,
    session,
    'workstation_jobs',
    `id=eq.${encodeURIComponent(job.id)}&status=in.(queued,retrying,leased)&cancel_requested_at=is.null`,
    {
      status: 'running',
      lease_owner: workstationId,
      lease_expires_at: new Date(Date.now() + cfg.leaseSeconds * 1000).toISOString(),
      started_at: new Date().toISOString(),
      finished_at: null,
      error_text: null,
    },
    true,
    true,
  )
  return rows?.[0] || null
}

async function fetchJobStatus(cfg, session, jobId) {
  const rows = await restSelect(
    cfg,
    session,
    'workstation_jobs',
    `select=id,status,cancel_requested_at&id=eq.${encodeURIComponent(jobId)}`,
  )
  return rows?.[0] || null
}

function retryBackoffMs(job) {
  const retryCount = Number(job.retry_count || 0)
  return Math.min(5 * 60 * 1000, 5000 * Math.max(1, retryCount + 1))
}

async function markJobFailure(cfg, session, job, error) {
  const retryCount = Number(job.retry_count || 0)
  const maxAttempts = Number(job.max_attempts || 3)
  const nextRetryCount = retryCount + 1
  const canRetry = nextRetryCount < maxAttempts
  const now = new Date().toISOString()
  const nextStatus = canRetry ? 'retrying' : 'dead_letter'
  await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
    status: nextStatus,
    retry_count: nextRetryCount,
    lease_owner: null,
    lease_expires_at: canRetry ? new Date(Date.now() + retryBackoffMs(job)).toISOString() : null,
    error_text: error.message,
    last_error_code: error.message.includes('timeout') ? 'timeout' : 'proxy_or_model_error',
    last_error_at: now,
    finished_at: canRetry ? null : now,
  })
  return { canRetry, nextStatus, nextRetryCount, maxAttempts }
}

function isCancelledJob(job) {
  return job?.status === 'cancelled' || Boolean(job?.cancel_requested_at)
}

async function processJob(cfg, session, job) {
  activeJobs += 1
  try {
    await heartbeat(cfg, session)
    const claimedJob = await claimQueuedJob(cfg, session, job)
    if (!claimedJob) {
      log('Pominieto job, bo nie jest juz w kolejce:', job.id)
      return
    }
    job = { ...job, ...claimedJob }
    await appendProgressMessage(cfg, session, job, `Start jobu. Sloty aktywne: ${activeJobs}/${cfg.parallelSlots}.`)
      .catch((error) => log('progress message failed:', error.message))

    const generation = job.payload?.generation || {}
    const result = await callLocalProxy(cfg, buildJobPrompt(job), {
      ...generation,
      requestId: `job:${job.id}:attempt:${Number(job.retry_count || 0) + 1}`,
      role: 'station',
    })
    const output = result.text
    recordJobMetric({ ok: true, tokensPerSecond: result.tokensPerSecond || null })
    const latestJob = await fetchJobStatus(cfg, session, job.id).catch((statusError) => {
      log('fetchJobStatus failed:', statusError.message)
      return null
    })
    if (isCancelledJob(latestJob)) {
      await appendProgressMessage(cfg, session, job, 'Job anulowany przed zapisem wyniku.')
        .catch((error) => log('progress message failed:', error.message))
      log('Job anulowany po pracy modelu:', job.id)
      return
    }
    await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'done',
      result_summary: output.slice(0, 500),
      result_payload: {
        text: output,
        durationMs: result.durationMs,
        requestId: result.requestId,
        outputTokens: result.outputTokens,
        estimatedInputTokens: result.estimatedInputTokens,
        tokensPerSecond: result.tokensPerSecond,
        workflowMode: result.workflowMode,
        model: result.model || cfg.modelName,
      },
      lease_owner: null,
      lease_expires_at: null,
      finished_at: new Date().toISOString(),
      error_text: null,
    })
    await appendStationMessage(cfg, session, [{
      workstation_id: workstationId,
      task_id: job.task_id || null,
      sender_kind: 'workstation',
      sender_label: cfg.workstationName,
      message_type: 'result',
      content: output,
    }])
    await appendProgressMessage(cfg, session, job, `Job ukonczony${result.durationMs ? ` w ${result.durationMs}ms` : ''}.`)
      .catch((error) => log('progress message failed:', error.message))
    await updateTaskLifecycle(cfg, session, job.task_id, { status: 'done', last_error: null })
    log('Job ukonczony:', job.id)
  } catch (error) {
    const latestJob = await fetchJobStatus(cfg, session, job.id).catch(() => null)
    if (isCancelledJob(latestJob)) {
      await appendProgressMessage(cfg, session, job, 'Job anulowany; pomijam zapis błędu po przerwaniu pracy.')
        .catch((progressError) => log('progress message failed:', progressError.message))
      log('Job anulowany podczas obslugi bledu:', job.id)
      return
    }
    recordJobMetric({ ok: false, tokensPerSecond: null })
    const failure = await markJobFailure(cfg, session, job, error)
    await appendStationMessage(cfg, session, [{
      workstation_id: workstationId,
      task_id: job.task_id || null,
      sender_kind: 'workstation',
      sender_label: cfg.workstationName,
      message_type: 'error',
      content: failure.canRetry
        ? `Job nie powiodl sie: ${error.message}. Proba ${failure.nextRetryCount}/${failure.maxAttempts}, wraca do kolejki z backoffem.`
        : `Job trafil do dead-letter po ${failure.nextRetryCount}/${failure.maxAttempts} probach: ${error.message}`,
    }])
    if (!failure.canRetry) await updateTaskLifecycle(cfg, session, job.task_id, { status: 'failed', last_error: error.message })
    log('Job nieudany:', job.id, failure.nextStatus, error.message)
  } finally {
    activeJobs = Math.max(0, activeJobs - 1)
    await heartbeat(cfg, session)
  }
}

async function appendProgressMessage(cfg, session, job, content) {
  await appendStationMessage(cfg, session, [{
    workstation_id: workstationId,
    task_id: job.task_id || null,
    sender_kind: 'workstation',
    sender_label: cfg.workstationName,
    message_type: 'progress',
    content,
  }])
}

async function processIncomingMessages(cfg, session) {
  const messages = await fetchUnreadMessages(cfg, session)
  for (const message of messages) {
    try {
      if (message.message_type === 'command') {
        const commandPayload = parseCommandPayload(message)
        const command = String(commandPayload.command || commandPayload.action || '').trim().toLowerCase()
        const result = await handleSystemCommand(cfg, session, message, commandPayload)
        await appendSystemCommandResult(cfg, session, message, result)
        await markMessageRead(cfg, session, message.id)
        if (command === 'shutdown') await shutdown(cfg, session)
        continue
      }
      const result = await callLocalProxy(cfg, [
        'Uzytkownik wyslal wiadomosc do stacji roboczej.',
        'Odpowiedz krotko po polsku i potwierdz, co zrobisz albo co juz zrobiles.',
        'Tresc wiadomosci: ' + (message.content || ''),
      ].join('\n'))
      await appendStationMessage(cfg, session, [{
        workstation_id: workstationId,
        task_id: message.task_id || null,
        sender_kind: 'workstation',
        sender_label: cfg.workstationName,
        message_type: 'reply',
        content: result.text || 'Potwierdzam odbior wiadomosci.',
      }])
      await markMessageRead(cfg, session, message.id)
    } catch (error) {
      log('Nie udalo sie obsluzyc wiadomosci:', error.message)
      await appendStationMessage(cfg, session, [{
        workstation_id: workstationId,
        task_id: message.task_id || null,
        sender_kind: 'workstation',
        sender_label: cfg.workstationName,
        message_type: 'error',
        content: `Nie udalo sie obsluzyc wiadomosci: ${error.message}`,
      }]).catch((appendError) => log('message error report failed:', appendError.message))
      await markMessageRead(cfg, session, message.id).catch((patchError) => log('mark failed message read failed:', patchError.message))
    }
  }
}

async function markMessageRead(cfg, session, messageId) {
  await restPatch(cfg, session, 'workstation_messages', `id=eq.${encodeURIComponent(messageId)}`, {
    read_at: new Date().toISOString(),
  })
}

function parseCommandPayload(message) {
  const content = String(message.content || '').trim()
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    return { command: content.replace(/^system:/i, '').trim().toLowerCase() }
  }
  return { command: content.replace(/^system:/i, '').trim().toLowerCase() }
}

function parseCommand(message) {
  const payload = parseCommandPayload(message)
  return String(payload.command || payload.action || '').trim().toLowerCase()
}

function updateRuntimeConfig(patch) {
  const raw = parseJsonFile(CONFIG_PATH)
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...raw, ...patch }, null, 2) + '\n')
}

function commandOutput(stdout, stderr) {
  return [stdout, stderr].filter(Boolean).join('\n').trim().slice(-4000)
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: path.join(__dirname, '..'),
      timeout: options.timeout || 180000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        signal: error?.signal || null,
        output: commandOutput(stdout, stderr),
      })
    })
  })
}

async function runRepoUpdateCommand() {
  const root = path.join(__dirname, '..')
  if (process.platform === 'win32') {
    return runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'launcher', 'update.ps1')], { timeout: 300000 })
  }
  return runCommand('/bin/sh', [path.join(root, 'update.sh')], { timeout: 300000 })
}

async function smokeLocalProxy(cfg) {
  const startedAt = Date.now()
  const response = await fetch(`http://127.0.0.1:${cfg.proxyPort}/health/smoke`)
  const body = await response.json().catch(() => ({}))
  return {
    ok: response.ok && body.ok !== false,
    status: response.status,
    durationMs: body.durationMs || Date.now() - startedAt,
    text: body.text || '',
    detail: body.detail || '',
  }
}

function sanitizeRuntimePatch(cfg, patch = {}) {
  const next = {}
  if (Object.hasOwn(patch, 'stationMode')) {
    next.stationMode = String(patch.stationMode).trim().toLowerCase() === 'operator' ? 'operator' : 'classroom'
  }
  if (Object.hasOwn(patch, 'acceptsJobs')) next.acceptsJobs = patch.acceptsJobs !== false
  if (Object.hasOwn(patch, 'parallelSlots')) next.parallelSlots = clampInt(patch.parallelSlots, cfg.parallelSlots, 1, 4)
  if (Object.hasOwn(patch, 'contextMode') || Object.hasOwn(patch, 'contextSizeTokens')) {
    next.contextMode = normalizeContextMode(patch.contextMode || cfg.contextMode)
    next.contextSizeTokens = next.contextMode === 'native'
      ? 0
      : clampInt(patch.contextSizeTokens, cfg.contextSizeTokens || DEFAULTS.CONTEXT_TOKENS, 65536, 262144)
  }
  if (Object.hasOwn(patch, 'kvCacheQuantization')) {
    next.kvCacheQuantization = normalizeKvCache(patch.kvCacheQuantization)
    next.effectiveKvCacheQuantization = resolveKvCache(next.kvCacheQuantization, next.contextSizeTokens ?? cfg.contextSizeTokens)
  }
  if (Object.hasOwn(patch, 'sdEnabled')) next.sdEnabled = patch.sdEnabled === true
  if (Object.hasOwn(patch, 'draftModelPath')) {
    next.draftModelPath = String(patch.draftModelPath || '').trim()
    next.draftModelName = next.draftModelPath ? path.basename(next.draftModelPath) : ''
  }
  if (Object.hasOwn(patch, 'speculativeTokens')) next.speculativeTokens = clampInt(patch.speculativeTokens, cfg.speculativeTokens, 1, 16)
  if (Object.hasOwn(patch, 'generationTimeoutMs')) next.generationTimeoutMs = clampInt(patch.generationTimeoutMs, cfg.generationTimeoutMs, 15000, 1800000)
  if (Object.hasOwn(patch, 'autoUpdate')) next.autoUpdate = patch.autoUpdate === true
  if (Object.hasOwn(patch, 'messageBatchSize')) next.messageBatchSize = clampInt(patch.messageBatchSize, cfg.messageBatchSize, 1, 50)
  if (Object.hasOwn(patch, 'offlineQueueMax')) next.offlineQueueMax = clampInt(patch.offlineQueueMax, cfg.offlineQueueMax, 50, 5000)

  const schedulePatch = {
    scheduleEnabled: Object.hasOwn(patch, 'scheduleEnabled') ? patch.scheduleEnabled === true : cfg.scheduleEnabled,
    scheduleStart: Object.hasOwn(patch, 'scheduleStart') ? patch.scheduleStart : cfg.scheduleStart,
    scheduleEnd: Object.hasOwn(patch, 'scheduleEnd') ? patch.scheduleEnd : cfg.scheduleEnd,
    scheduleOutsideAction: Object.hasOwn(patch, 'scheduleOutsideAction') ? patch.scheduleOutsideAction : cfg.scheduleOutsideAction,
    scheduleEndAction: Object.hasOwn(patch, 'scheduleEndAction') ? patch.scheduleEndAction : cfg.scheduleEndAction,
    scheduleDumpOnStop: Object.hasOwn(patch, 'scheduleDumpOnStop') ? patch.scheduleDumpOnStop === true : cfg.scheduleDumpOnStop,
  }
  const schedule = normalizeSchedule(schedulePatch)
  next.scheduleEnabled = schedule.enabled
  next.scheduleStart = schedule.start
  next.scheduleEnd = schedule.end
  next.scheduleOutsideAction = schedule.outsideAction
  next.scheduleEndAction = schedule.endAction
  next.scheduleDumpOnStop = schedule.dumpOnStop

  next.optimizationMode = next.sdEnabled ? 'sd-experimental' : (Number(next.parallelSlots ?? cfg.parallelSlots) > 1 ? 'parallel' : 'standard')
  if (next.stationMode === 'operator') next.acceptsJobs = false
  if (next.stationMode === 'classroom' && Object.hasOwn(patch, 'acceptsJobs')) next.acceptsJobs = patch.acceptsJobs !== false
  return next
}

function applyRuntimeReconfigure(cfg, patch) {
  const safePatch = sanitizeRuntimePatch(cfg, patch)
  saveLocalConfigPatch(cfg, safePatch)
  return safePatch
}

async function handleSystemCommand(cfg, session, message, parsedCommand) {
  const payload = typeof parsedCommand === 'string' ? { command: parsedCommand } : (parsedCommand || parseCommandPayload(message))
  const command = String(payload.command || payload.action || '').trim().toLowerCase()
  if (command === 'pause') {
    cfg.acceptsJobs = false
    updateRuntimeConfig({ stationMode: cfg.stationMode, acceptsJobs: false })
    await heartbeat(cfg, session, 'offline')
    return 'System: stacja wstrzymana. Nowe joby nie beda pobierane do czasu wznowienia.'
  }
  if (command === 'resume') {
    cfg.acceptsJobs = cfg.stationMode === 'classroom'
    updateRuntimeConfig({ stationMode: cfg.stationMode, acceptsJobs: cfg.acceptsJobs })
    await heartbeat(cfg, session)
    return cfg.acceptsJobs ? 'System: stacja wznowiona i moze pobierac joby.' : 'System: tryb operatora nie pobiera jobow.'
  }
  if (command === 'refresh' || command === 'status') {
    await heartbeat(cfg, session)
    return [
      `System: status ${currentStatus(cfg)}.`,
      `Tryb: ${cfg.stationMode}.`,
      `Sloty: ${activeJobs}/${cfg.parallelSlots}.`,
      `Kontekst: ${cfg.contextMode === 'native' ? 'native' : cfg.contextSizeTokens}.`,
      `KV: ${cfg.effectiveKvCacheQuantization}.`,
      `Offline queue: ${offlineQueueDepth()}.`,
      `Model: ${cfg.modelName || 'domyslny'}.`,
    ].join(' ')
  }
  if (command === 'health' || command === 'smoke') {
    const result = await smokeLocalProxy(cfg)
    await heartbeat(cfg, session, result.ok ? undefined : 'error')
    return result.ok
      ? `System: smoke OK (${result.durationMs}ms). Odpowiedz modelu: ${result.text || 'pusta'}.`
      : `System: smoke FAIL HTTP ${result.status}: ${result.detail || 'brak szczegolow'}.`
  }
  if (command === 'reconfigure') {
    const safePatch = applyRuntimeReconfigure(cfg, payload.patch || payload.config || {})
    await heartbeat(cfg, session)
    return `System: zapisano bezpieczna rekonfiguracje: ${JSON.stringify(safePatch)}. Zmiany portu/modelu wymagaja restartu launchera.`
  }
  if (command === 'update') {
    const result = await runRepoUpdateCommand()
    const status = result.ok ? 'zakonczona' : `nieudana (kod ${result.code || result.signal || 'unknown'})`
    return `System: aktualizacja repo ${status}.\n${result.output || 'Brak wyjscia procesu.'}`
  }
  if (command === 'shutdown') {
    return 'System: odebrano polecenie wylaczenia procesu stacji.'
  }
  return `System: nieznana komenda "${command || 'pusta'}". Dostepne: update, pause, resume, refresh, status, health, reconfigure, shutdown.`
}

async function appendSystemCommandResult(cfg, session, message, content) {
  await appendStationMessage(cfg, session, [{
    workstation_id: workstationId,
    task_id: message.task_id || null,
    sender_kind: 'system',
    sender_label: 'system',
    message_type: 'command-result',
    content,
  }])
}

async function handleScheduleBoundary(cfg, session) {
  if (!cfg.scheduleEnabled || shuttingDown) return false
  if (isWithinSchedule(cfg)) {
    scheduleStopAnnounced = false
    return false
  }

  if (cfg.scheduleEndAction === 'stop-now') {
    log('Harmonogram poza oknem pracy - zatrzymuje runtime natychmiast zgodnie z scheduleEndAction=stop-now.')
    await writeScheduleDumpIfNeeded(cfg, 'stop-now')
    await shutdown(cfg, session)
    return true
  }

  if (activeJobs > 0) {
    if (!scheduleStopAnnounced) {
      scheduleStopAnnounced = true
      log(`Harmonogram poza oknem pracy - nie przyjmuje nowych zlecen, czekam na zakonczenie aktywnych jobow (${activeJobs}).`)
    }
    await heartbeat(cfg, session, 'busy')
    return true
  }

  log('Harmonogram poza oknem pracy - brak aktywnych jobow, zatrzymuje runtime.')
  await writeScheduleDumpIfNeeded(cfg, 'finish-current')
  await shutdown(cfg, session)
  return true
}

async function writeScheduleDumpIfNeeded(cfg, reason) {
  if (!cfg.scheduleDumpOnStop) return
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = path.join(LOGS_DIR, `schedule-dump-${stamp}.json`)
    const dump = {
      reason,
      note: 'Zrzut diagnostyczny nie zapisuje stanu generowania modelu. Przy naglym stop-now czesc pracy moze przepasc.',
      workstationId,
      activeJobs,
      schedule: {
        enabled: cfg.scheduleEnabled,
        start: cfg.scheduleStart,
        end: cfg.scheduleEnd,
        outsideAction: cfg.scheduleOutsideAction,
        endAction: cfg.scheduleEndAction,
      },
      modelName: cfg.modelName,
      backend: cfg.backend,
      writtenAt: new Date().toISOString(),
    }
    fs.writeFileSync(file, JSON.stringify(dump, null, 2) + '\n')
    log('Zapisano zrzut diagnostyczny harmonogramu:', file)
  } catch (error) {
    log('Nie udalo sie zapisac zrzutu diagnostycznego harmonogramu:', error.message)
  }
}

async function shutdown(cfg, session) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    if (cfg && session && workstationId) {
      await heartbeat(cfg, session, 'offline')
    }
  } catch (error) {
    log('Blad podczas zamykania:', error.message)
  } finally {
    process.exit(0)
  }
}

function nextPollDelay(baseMs, jitterMs) {
  return baseMs + Math.floor(Math.random() * Math.max(0, jitterMs || 0))
}

function startJobPollLoop(cfg) {
  const tick = async () => {
    if (availableSlots(cfg) >= 1 && !shuttingDown) {
      try {
        const jobs = await fetchQueuedJobs(cfg, authSession)
        for (const job of jobs) {
          processJob(cfg, authSession, job).catch((error) => log('processJob failed:', error.message))
        }
      } catch (error) {
        log('pollJobs failed:', error.message)
      }
    }
    if (!shuttingDown) setTimeout(tick, nextPollDelay(cfg.pollMs, cfg.pollJitterMs))
  }
  setTimeout(tick, nextPollDelay(cfg.pollMs, cfg.pollJitterMs))
}

function startMessagePollLoop(cfg) {
  const tick = async () => {
    if (!shuttingDown) {
      try {
        await processIncomingMessages(cfg, authSession)
        await flushOfflineQueue(cfg, authSession)
      } catch (error) {
        log('pollMessages failed:', error.message)
      }
    }
    if (!shuttingDown) setTimeout(tick, nextPollDelay(DEFAULTS.MESSAGE_POLL_MS, cfg.pollJitterMs))
  }
  setTimeout(tick, nextPollDelay(DEFAULTS.MESSAGE_POLL_MS, cfg.pollJitterMs))
}

async function main() {
  const cfg = loadConfig()
  ensureRequiredConfig(cfg)
  authSession = await authenticate(cfg)
  log('Zalogowano do Supabase jako:', authSession.user.email || authSession.user.id)

  await upsertWorkstation(cfg, authSession)
  await syncModels(cfg, authSession)
  await heartbeat(cfg, authSession)
  await flushOfflineQueue(cfg, authSession).catch((error) => log('flushOfflineQueue failed:', error.message))
  log('Stacja gotowa:', workstationId, `sloty=${cfg.parallelSlots}`, `SD=${cfg.sdEnabled ? 'on' : 'off'}`)

  setInterval(() => {
    handleScheduleBoundary(cfg, authSession)
      .then((handledScheduleStop) => {
        if (!handledScheduleStop) return heartbeat(cfg, authSession)
        return null
      })
      .then(() => flushOfflineQueue(cfg, authSession))
      .catch((error) => log('Heartbeat/schedule failed:', error.message))
  }, DEFAULTS.HEARTBEAT_MS)

  setInterval(() => {
    syncModels(cfg, authSession).catch((error) => log('syncModels failed:', error.message))
  }, DEFAULTS.HEARTBEAT_MS)

  startJobPollLoop(cfg)
  startMessagePollLoop(cfg)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

process.on('SIGINT', () => {
  let cfg = null
  try { cfg = authSession ? loadConfig() : null } catch { cfg = null }
  shutdown(cfg, authSession)
})
process.on('SIGTERM', () => {
  let cfg = null
  try { cfg = authSession ? loadConfig() : null } catch { cfg = null }
  shutdown(cfg, authSession)
})

main().catch((error) => {
  console.error('[workstation-agent] Fatal:', error.message)
  process.exit(1)
})