/**
 * @file supabase-smoke.mjs
 * @description Opcjonalny smoke test Supabase Auth/RLS/CRUD bez npm i bez bundlera.
 * Uruchamia się z kontem testowym podanym przez zmienne środowiskowe.
 */

const APP_USER_ROLES = ['admin', 'manager', 'operator', 'teacher', 'executor', 'viewer']
const POLL_INTERVAL_MS = 500
const POLL_ATTEMPTS = 12

const config = {
  supabaseUrl: requiredEnv('SUPABASE_URL'),
  anonKey: requiredEnv('SUPABASE_ANON_KEY'),
  email: requiredEnv('SUPABASE_TEST_EMAIL'),
  password: requiredEnv('SUPABASE_TEST_PASSWORD'),
}

let createdTaskId = null
let accessToken = null

try {
  const session = await signIn(config.email, config.password)
  accessToken = session.access_token
  assertAppRole(session.user)
  const task = await createSmokeTask(session)
  createdTaskId = task.id
  await waitForTaskCreatedEvent(session.access_token, task.id)
  await deleteTask(session.access_token, task.id)
  createdTaskId = null
  await assertTaskDeleted(session.access_token, task.id)
  console.log('[supabase-smoke] passed')
} catch (error) {
  if (createdTaskId && accessToken) await cleanupTask(createdTaskId, accessToken).catch(() => {})
  console.error(`[supabase-smoke] ${error.message}`)
  process.exit(1)
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function signIn(email, password) {
  const data = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  if (!data.access_token || !data.user?.id) throw new Error('Supabase Auth did not return a usable session')
  return data
}

function assertAppRole(user) {
  const role = user?.app_metadata?.role || ''
  if (!APP_USER_ROLES.includes(role)) {
    throw new Error(`Test user must have app_metadata.role in ${APP_USER_ROLES.join(', ')}; got "${role || 'empty'}"`)
  }
}

async function createSmokeTask(session) {
  const title = `Acceptance smoke ${new Date().toISOString()}`
  const rows = await request('/rest/v1/tasks?select=id,title,status,user_id,created_at', {
    method: 'POST',
    token: session.access_token,
    headers: { Prefer: 'return=representation' },
    body: {
      title,
      description: 'Automatyczny test Supabase CRUD/RLS/audit. Rekord powinien zostać usunięty na końcu testu.',
      priority: 'low',
      status: 'pending',
      git_repo: null,
      context: { template: 'acceptance-smoke', raw: { source: 'tests/acceptance/supabase-smoke.mjs' } },
      user_id: session.user.id,
    },
  })
  const task = Array.isArray(rows) ? rows[0] : null
  if (!task?.id || task.status !== 'pending') throw new Error('Task insert did not return a pending task')
  return task
}

async function waitForTaskCreatedEvent(token, taskId) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const events = await request(`/rest/v1/task_events?task_id=eq.${encodeURIComponent(taskId)}&select=event_type,summary,created_at&order=created_at.asc`, { token })
    if (events.some((event) => event.event_type === 'task.created')) return
    await delay(POLL_INTERVAL_MS)
  }
  throw new Error(`task.created audit event was not visible for task ${taskId}`)
}

async function deleteTask(token, taskId) {
  await request(`/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    token,
  })
}

async function assertTaskDeleted(token, taskId) {
  const rows = await request(`/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}&select=id`, { token })
  if (rows.length !== 0) throw new Error(`Task ${taskId} is still visible after delete`)
}

async function cleanupTask(taskId, token) {
  await fetch(`${config.supabaseUrl}/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
  })
}

async function request(path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${options.token || config.anonKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} returned ${response.status}: ${text}`)
  return data
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}