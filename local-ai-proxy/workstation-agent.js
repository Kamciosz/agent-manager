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

const SUPPORTED_KV_CACHE = ['auto', 'f32', 'f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1', 'planar3', 'iso3', 'planar4', 'iso4', 'turbo3', 'turbo4']

const DEFAULTS = {
  POLL_MS: 8000,
  HEARTBEAT_MS: 15000,
  MESSAGE_POLL_MS: 6000,
  AUTH_RETRY_MS: [3000, 7000, 15000, 30000],
  GENERATION_TIMEOUT_MS: 600000,
  CONTEXT_TOKENS: 65536,
  KV_CACHE: 'q8_0',
}

let activeJobs = 0
let shuttingDown = false
let workstationId = null
let authSession = null
let scheduleStopAnnounced = false

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
    draftModelName: raw.draftModelName || '',
    speculativeTokens: clampInt(raw.speculativeTokens, 4, 1, 16),
    contextMode,
    contextSizeTokens,
    kvCacheQuantization,
    effectiveKvCacheQuantization: normalizeKvCache(raw.effectiveKvCacheQuantization || resolveKvCache(kvCacheQuantization, contextSizeTokens)),
    generationTimeoutMs: clampInt(raw.generationTimeoutMs, DEFAULTS.GENERATION_TIMEOUT_MS, 15000, 1800000),
    autoUpdate: raw.autoUpdate === true,
    optimizationMode: raw.optimizationMode || 'standard',
  }
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

async function restPatch(cfg, session, table, filter, payload, retry = true) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify(payload),
  })
  if (response.status === 401 && retry) {
    return restPatch(cfg, await refreshSession(cfg), table, filter, payload, false)
  }
  if (!response.ok) {
    throw new Error(`${table} patch failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
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
  const metadata = [
    payload.git_repo ? `Repo: ${payload.git_repo}` : '',
    context.raw ? `Kontekst JSON: ${JSON.stringify(context.raw).slice(0, 1800)}` : '',
  ].filter(Boolean).join('\n')
  return [
    'Jestes agentem AI na szkolnej stacji roboczej. Masz wykonac zadanie i zwrocic sam wynik pracy.',
    'Nie przepisuj w odpowiedzi naglowkow ani pol technicznych takich jak Tytul, Opis, Repo, Kontekst, routing lub payload.',
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

async function callLocalProxy(cfg, prompt) {
  const response = await fetch(`http://127.0.0.1:${cfg.proxyPort}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, maxTokens: 600, temperature: 0.4 }),
  })
  if (!response.ok) {
    throw new Error(`Local proxy HTTP ${response.status} ${await responseDetail(response)}`)
  }
  const data = await response.json()
  return {
    text: (data.text || '').trim(),
    durationMs: data.durationMs || null,
  }
}

async function appendStationMessage(cfg, session, message) {
  await restInsert(cfg, session, 'workstation_messages', Array.isArray(message) ? message : [message])
}

async function updateTaskStatus(cfg, session, taskId, status) {
  if (!taskId) return
  await restPatch(cfg, session, 'tasks', `id=eq.${encodeURIComponent(taskId)}`, { status })
}

async function processJob(cfg, session, job) {
  activeJobs += 1
  try {
    await heartbeat(cfg, session)
    await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'running',
      started_at: new Date().toISOString(),
    })
    await appendProgressMessage(cfg, session, job, `Start jobu. Sloty aktywne: ${activeJobs}/${cfg.parallelSlots}.`)
      .catch((error) => log('progress message failed:', error.message))

    const result = await callLocalProxy(cfg, buildJobPrompt(job))
    const output = result.text
    await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'done',
      result_summary: output.slice(0, 500),
      result_payload: { text: output, durationMs: result.durationMs },
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
    await updateTaskStatus(cfg, session, job.task_id, 'done')
    log('Job ukonczony:', job.id)
  } catch (error) {
    await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'failed',
      error_text: error.message,
      finished_at: new Date().toISOString(),
    })
    await appendStationMessage(cfg, session, [{
      workstation_id: workstationId,
      task_id: job.task_id || null,
      sender_kind: 'workstation',
      sender_label: cfg.workstationName,
      message_type: 'error',
      content: `Job nie powiodl sie: ${error.message}`,
    }])
    await updateTaskStatus(cfg, session, job.task_id, 'failed')
    log('Job nieudany:', job.id, error.message)
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
        const command = parseCommand(message)
        const result = await handleSystemCommand(cfg, session, message, command)
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

function parseCommand(message) {
  const content = String(message.content || '').trim()
  try {
    const parsed = JSON.parse(content)
    return String(parsed.command || parsed.action || '').trim().toLowerCase()
  } catch {
    return content.replace(/^system:/i, '').trim().toLowerCase()
  }
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
    return runCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'update.ps1')], { timeout: 300000 })
  }
  return runCommand('/bin/sh', [path.join(root, 'update.sh')], { timeout: 300000 })
}

async function handleSystemCommand(cfg, session, message, parsedCommand) {
  const command = parsedCommand || parseCommand(message)
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
      `Model: ${cfg.modelName || 'domyslny'}.`,
    ].join(' ')
  }
  if (command === 'update') {
    const result = await runRepoUpdateCommand()
    const status = result.ok ? 'zakonczona' : `nieudana (kod ${result.code || result.signal || 'unknown'})`
    return `System: aktualizacja repo ${status}.\n${result.output || 'Brak wyjscia procesu.'}`
  }
  if (command === 'shutdown') {
    return 'System: odebrano polecenie wylaczenia procesu stacji.'
  }
  return `System: nieznana komenda "${command || 'pusta'}". Dostepne: update, pause, resume, refresh, status, shutdown.`
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

async function main() {
  const cfg = loadConfig()
  ensureRequiredConfig(cfg)
  authSession = await authenticate(cfg)
  log('Zalogowano do Supabase jako:', authSession.user.email || authSession.user.id)

  await upsertWorkstation(cfg, authSession)
  await syncModels(cfg, authSession)
  await heartbeat(cfg, authSession)
  log('Stacja gotowa:', workstationId, `sloty=${cfg.parallelSlots}`, `SD=${cfg.sdEnabled ? 'on' : 'off'}`)

  setInterval(() => {
    handleScheduleBoundary(cfg, authSession)
      .then((handledScheduleStop) => {
        if (!handledScheduleStop) return heartbeat(cfg, authSession)
        return null
      })
      .catch((error) => log('Heartbeat/schedule failed:', error.message))
  }, DEFAULTS.HEARTBEAT_MS)

  setInterval(() => {
    syncModels(cfg, authSession).catch((error) => log('syncModels failed:', error.message))
  }, DEFAULTS.HEARTBEAT_MS)

  setInterval(async () => {
    if (availableSlots(cfg) < 1 || shuttingDown) return
    try {
      const jobs = await fetchQueuedJobs(cfg, authSession)
      for (const job of jobs) {
        processJob(cfg, authSession, job).catch((error) => log('processJob failed:', error.message))
      }
    } catch (error) {
      log('pollJobs failed:', error.message)
    }
  }, DEFAULTS.POLL_MS)

  setInterval(() => {
    if (shuttingDown) return
    processIncomingMessages(cfg, authSession).catch((error) => log('pollMessages failed:', error.message))
  }, DEFAULTS.MESSAGE_POLL_MS)
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