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
}

let busy = false
let shuttingDown = false
let workstationId = null
let authSession = null

function log(...args) {
  console.log('[workstation-agent]', ...args)
}

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
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
    scheduleEnabled: raw.scheduleEnabled === true,
    scheduleStart: raw.scheduleStart || null,
    scheduleEnd: raw.scheduleEnd || null,
  }
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
  return busy ? 'busy' : 'online'
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

async function restUpsert(cfg, session, table, rows, onConflict) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  })
  if (!response.ok) {
    throw new Error(`${table} upsert failed: HTTP ${response.status}`)
  }
  return response.json()
}

async function restInsert(cfg, session, table, rows) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(rows),
  })
  if (!response.ok) {
    throw new Error(`${table} insert failed: HTTP ${response.status}`)
  }
  return response.json()
}

async function restPatch(cfg, session, table, filter, payload) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey, {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`${table} patch failed: HTTP ${response.status}`)
  }
  return response.json()
}

async function restSelect(cfg, session, table, query) {
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: buildHeaders(session.access_token, cfg.supabaseAnonKey),
  })
  if (!response.ok) {
    throw new Error(`${table} select failed: HTTP ${response.status}`)
  }
  return response.json()
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

async function fetchQueuedJob(cfg, session) {
  if (!workstationId || !cfg.acceptsJobs || !isWithinSchedule(cfg)) return null
  const rows = await restSelect(
    cfg,
    session,
    'workstation_jobs',
    `select=*&workstation_id=eq.${encodeURIComponent(workstationId)}&status=eq.queued&order=created_at.asc&limit=1`,
  )
  return rows[0] || null
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
  return (data.text || '').trim()
}

async function appendStationMessage(cfg, session, message) {
  await restInsert(cfg, session, 'workstation_messages', [message])
}

async function updateTaskStatus(cfg, session, taskId, status) {
  if (!taskId) return
  await restPatch(cfg, session, 'tasks', `id=eq.${encodeURIComponent(taskId)}`, { status })
}

async function processJob(cfg, session, job) {
  busy = true
  await heartbeat(cfg, session)
  await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
    status: 'running',
    started_at: new Date().toISOString(),
  })

  try {
    const output = await callLocalProxy(cfg, buildJobPrompt(job))
    await restPatch(cfg, session, 'workstation_jobs', `id=eq.${encodeURIComponent(job.id)}`, {
      status: 'done',
      result_summary: output.slice(0, 500),
      result_payload: { text: output },
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
    busy = false
    await heartbeat(cfg, session)
  }
}

async function processIncomingMessages(cfg, session) {
  const messages = await fetchUnreadMessages(cfg, session)
  for (const message of messages) {
    try {
      const reply = await callLocalProxy(cfg, [
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
        content: reply || 'Potwierdzam odbiór wiadomości.',
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
  authSession = await signIn(cfg)
  log('Zalogowano do Supabase jako:', authSession.user.email)

  await upsertWorkstation(cfg, authSession)
  await syncModels(cfg, authSession)
  await heartbeat(cfg, authSession)
  log('Stacja gotowa:', workstationId)

  setInterval(() => {
    heartbeat(cfg, authSession).catch((error) => log('Heartbeat failed:', error.message))
  }, DEFAULTS.HEARTBEAT_MS)

  setInterval(() => {
    syncModels(cfg, authSession).catch((error) => log('syncModels failed:', error.message))
  }, DEFAULTS.HEARTBEAT_MS)

  setInterval(async () => {
    if (busy || shuttingDown) return
    try {
      const job = await fetchQueuedJob(cfg, authSession)
      if (job) await processJob(cfg, authSession, job)
    } catch (error) {
      log('pollJobs failed:', error.message)
    }
  }, DEFAULTS.POLL_MS)

  setInterval(() => {
    if (shuttingDown) return
    processIncomingMessages(cfg, authSession).catch((error) => log('pollMessages failed:', error.message))
  }, DEFAULTS.MESSAGE_POLL_MS)
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
