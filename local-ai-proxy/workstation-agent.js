/**
 * @file workstation-agent.js
 * @description Lekki agent lokalny dla szkolnej stacji roboczej. Loguje się do
 *              Supabase kontem operatora, rejestruje komputer, publikuje listę
 *              modeli GGUF, odbiera wiadomości i kolejkę jobów oraz wykonuje je
 *              przez lokalny proxy AI działający na 127.0.0.1.
 *
 *              Brak zewnętrznych zależności — tylko Node 18+ i fetch.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const CONFIG_PATH = path.join(__dirname, 'config.json')
const DEFAULTS = {
  POLL_MS: 8000,
  HEARTBEAT_MS: 15000,
  MESSAGE_POLL_MS: 6000,
  AUTH_RETRY_MS: [3000, 7000, 15000, 30000],
}

let activeJobs = 0
let shuttingDown = false
let workstationId = null
let authSession = null

function log(...args) {
  console.log('[workstation-agent]', ...args)
}

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  const schedule = normalizeSchedule(raw.scheduleEnabled, raw.scheduleStart, raw.scheduleEnd)
  return {
    supabaseUrl: raw.supabaseUrl,
    supabaseAnonKey: raw.supabaseAnonKey,
    workstationEmail: raw.workstationEmail,
    workstationPassword: raw.workstationPassword,
    workstationName: raw.workstationName || os.hostname(),
    modelPath: raw.modelPath || '',
    modelName: raw.modelName || '',
    backend: raw.backend || 'cpu',
    proxyPort: Number(raw.proxyPort) || 3001,
    llamaPort: Number(raw.llamaPort) || 8080,
    acceptsJobs: raw.acceptsJobs !== false,
    scheduleEnabled: schedule.enabled,
    scheduleStart: schedule.start,
    scheduleEnd: schedule.end,
    parallelSlots: clampInt(raw.parallelSlots, 1, 1, 4),
    sdEnabled: raw.sdEnabled === true,
    draftModelName: raw.draftModelName || '',
    speculativeTokens: clampInt(raw.speculativeTokens, 4, 1, 16),
    optimizationMode: raw.optimizationMode || 'standard',
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizeSchedule(enabled, start, end) {
  if (enabled !== true) return { enabled: false, start: null, end: null }
  if (!isTimeValue(start) || !isTimeValue(end)) {
    log('Niepoprawny harmonogram w config.json — wyłączam schedule dla tej sesji.', start, end)
    return { enabled: false, start: null, end: null }
  }
  return { enabled: true, start, end }
}

function isTimeValue(value) {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
}

function ensureRequiredConfig(cfg) {
  const required = ['supabaseUrl', 'supabaseAnonKey', 'workstationEmail', 'workstationPassword']
  const missing = required.filter((key) => !cfg[key])
  if (missing.length) {
    throw new Error(`Brak wymaganych pól w config.json: ${missing.join(', ')}`)
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
  if (!cfg.scheduleEnabled || !cfg.scheduleStart || !cfg.scheduleEnd) return true
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  const [startHour, startMinute] = cfg.scheduleStart.split(':').map(Number)
  const [endHour, endMinute] = cfg.scheduleEnd.split(':').map(Number)
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  if (start === end) return true
  if (start < end) return minutes >= start && minutes <= end
  return minutes >= start || minutes <= end
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

async function refreshSession(cfg) {
  log('Odświeżam sesję Supabase po błędzie 401.')
  authSession = await signInWithRetry(cfg, 2)
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
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(rows),
  })
  if (response.status === 401 && retry) {
    return restInsert(cfg, await refreshSession(cfg), table, rows, false)
  }
  if (!response.ok) {
    throw new Error(`${table} insert failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return response.json()
}

async function restPatch(cfg, session, table, filter, payload, retry = true) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(payload),
  })
  if (response.status === 401 && retry) {
    return restPatch(cfg, await refreshSession(cfg), table, filter, payload, false)
  }
  if (!response.ok) {
    throw new Error(`${table} patch failed: HTTP ${response.status} ${await responseDetail(response)}`)
  }
  return response.json()
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
  return {
    display_name: cfg.workstationName,
    hostname: os.hostname(),
    operator_user_id: userId,
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
      sdEnabled: cfg.sdEnabled,
      draftModelName: cfg.draftModelName || null,
      speculativeTokens: cfg.speculativeTokens,
      optimizationMode: cfg.optimizationMode,
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
  return [
    'Jesteś agentem AI uruchomionym na szkolnej stacji roboczej.',
    payload.instructions || 'Wykonaj zadanie możliwie konkretnie.',
    'Tytuł: ' + (payload.title || ''),
    'Opis: ' + (payload.description || ''),
    'Repo: ' + (payload.git_repo || '—'),
    'Kontekst: ' + JSON.stringify(payload.context || {}),
    'Odpowiedz po polsku. Jeśli generujesz kod, dołącz go w jednej odpowiedzi.',
  ].join('\n')
}

async function callLocalProxy(cfg, prompt) {
  const response = await fetch(`http://127.0.0.1:${cfg.proxyPort}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, maxTokens: 600, temperature: 0.4 }),
  })
  if (!response.ok) {
    throw new Error(`Local proxy HTTP ${response.status}`)
  }
  const data = await response.json()
  return {
    text: (data.text || '').trim(),
    durationMs: data.durationMs || null,
  }
}

async function appendStationMessage(cfg, session, message) {
  await restInsert(cfg, session, 'workstation_messages', [message])
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
    await appendProgressMessage(cfg, session, job, `Job ukończony${result.durationMs ? ` w ${result.durationMs}ms` : ''}.`)
      .catch((error) => log('progress message failed:', error.message))
    await updateTaskStatus(cfg, session, job.task_id, 'done')
    log('Job ukończony:', job.id)
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
      content: `Job nie powiódł się: ${error.message}`,
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
      const result = await callLocalProxy(cfg, [
        'Użytkownik wysłał wiadomość do stacji roboczej.',
        'Odpowiedz krótko po polsku i potwierdź, co zrobisz albo co już zrobiłeś.',
        'Treść wiadomości: ' + (message.content || ''),
      ].join('\n'))
      await appendStationMessage(cfg, session, [{
        workstation_id: workstationId,
        task_id: message.task_id || null,
        sender_kind: 'workstation',
        sender_label: cfg.workstationName,
        message_type: 'reply',
        content: result.text || 'Potwierdzam odbiór wiadomości.',
      }])
      await restPatch(cfg, session, 'workstation_messages', `id=eq.${encodeURIComponent(message.id)}`, {
        read_at: new Date().toISOString(),
      })
    } catch (error) {
      log('Nie udało się obsłużyć wiadomości:', error.message)
    }
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
    log('Błąd podczas zamykania:', error.message)
  } finally {
    process.exit(0)
  }
}

async function main() {
  const cfg = loadConfig()
  ensureRequiredConfig(cfg)
  authSession = await signInWithRetry(cfg)
  log('Zalogowano do Supabase jako:', authSession.user.email)

  await upsertWorkstation(cfg, authSession)
  await syncModels(cfg, authSession)
  await heartbeat(cfg, authSession)
  log('Stacja gotowa:', workstationId, `sloty=${cfg.parallelSlots}`, `SD=${cfg.sdEnabled ? 'on' : 'off'}`)

  setInterval(() => {
    heartbeat(cfg, authSession).catch((error) => log('Heartbeat failed:', error.message))
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
  const cfg = authSession ? loadConfig() : null
  shutdown(cfg, authSession)
})
process.on('SIGTERM', () => {
  const cfg = authSession ? loadConfig() : null
  shutdown(cfg, authSession)
})

main().catch((error) => {
  console.error('[workstation-agent] Fatal:', error.message)
  process.exit(1)
})
