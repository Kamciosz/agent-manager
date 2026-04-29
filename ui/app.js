/**
 * @file app.js
 * @description Główny moduł UI Agent Manager. Inicjalizuje klienta Supabase,
 *              obsługuje autentykację (login/register/logout), nawigację między
 *              widokami, CRUD na tabelach `tasks` i `agents`, oraz subskrypcje
 *              Realtime do live update statusów i wiadomości AI. Uruchamia
 *              również moduły symulacji `manager.js` i `executor.js`.
 *
 *              Działa wyłącznie w przeglądarce — bez bundlera, bez Node.js.
 *              Klucze Supabase są wstrzykiwane przez GitHub Actions (sed).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { initManager, stopManager } from './manager.js'
import { initExecutor, stopExecutor } from './executor.js'
import { initAiClient } from './ai-client.js'
import { applySettings, getRecentRepos, getSettings, rememberRepo, saveSettings } from './settings.js'
import {
  HERMES_LABYRINTH_GATES,
  HERMES_LABYRINTH_LABEL,
  HERMES_LABYRINTH_PRESET,
  HERMES_LABYRINTH_TEMPLATE_ID,
  buildHermesLabyrinthContext,
  isHermesLabyrinthTemplate,
  summarizeHermesLabyrinthContext,
} from './labyrinth.js'

// ============================================================================
// KONFIGURACJA — placeholdery podmieniane przez GitHub Actions
// ============================================================================

const SUPABASE_URL = '__SUPABASE_URL__'
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'

// ============================================================================
// STAŁE — żadnych magic strings w kodzie
// ============================================================================

const STATUS = {
  PENDING: 'pending',
  ANALYZING: 'analyzing',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  FAILED: 'failed',
}

const AGENT = {
  EXECUTOR_1: 'executor-1',
  MANAGER: 'manager',
}

const VIEW = {
  DASHBOARD: 'dashboard',
  TASKS: 'tasks',
  TASK_DETAIL: 'task-detail',
  AGENTS: 'agents',
  WORKSTATIONS: 'workstations',
  MONITOR: 'monitor',
  ADVANCED: 'advanced',
  SETTINGS: 'settings',
}

const TOAST_TYPE = {
  SUCCESS: 'success',
  ERROR: 'error',
  INFO: 'info',
}

const TIMELINE_STEPS = [
  { key: STATUS.PENDING,     label: 'Wysłano zadanie' },
  { key: STATUS.ANALYZING,   label: 'AI kierownik przejął' },
  { key: 'assigned',         label: 'Przydzielono agentowi' },
  { key: STATUS.IN_PROGRESS, label: 'W toku' },
  { key: STATUS.DONE,        label: 'Zakończono' },
]

const STATUS_LABELS = {
  [STATUS.PENDING]: 'Oczekuje',
  [STATUS.ANALYZING]: 'Analiza',
  [STATUS.IN_PROGRESS]: 'W toku',
  [STATUS.DONE]: 'Gotowe',
  [STATUS.FAILED]: 'Błąd',
}

const WORKSTATION_STALE_MS = 2 * 60 * 1000

const PRIORITY_LABELS = {
  low: 'Niski',
  medium: 'Średni',
  high: 'Wysoki',
}

const TEMPLATE_LABELS = {
  'bug-fix': 'Bug Fix',
  refactor: 'Refactor',
  tests: 'Testy',
  custom: 'Własne',
  [HERMES_LABYRINTH_TEMPLATE_ID]: HERMES_LABYRINTH_LABEL,
}

applySettings()

// ============================================================================
// KLIENT SUPABASE — inicjalizacja jednej instancji dla całej aplikacji
// ============================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Eksponowane na window dla testów manualnych w DevTools (np. test RBAC).
window.supabase = supabase

// ============================================================================
// STAN APLIKACJI — minimalny mutowalny stan trzymany w jednym miejscu
// ============================================================================

const state = {
  user: null,
  currentView: VIEW.DASHBOARD,
  currentTaskId: null,
  currentTaskAiMessages: [],
  currentTaskWorkstationMessages: [],
  editingWorkstationId: null,
  selectedMonitorWorkstationId: null,
  agentSkills: [],
  editingAgentId: null,
  tasks: [],
  workstations: [],
  enrollmentTokens: [],
  allTasksSubscription: null,
  detailSubscription: null,
  messagesSubscription: null,
  taskWorkstationMessagesSubscription: null,
  workstationsSubscription: null,
  enrollmentTokensSubscription: null,
  monitorLogSubscription: null,
}

// ============================================================================
// TOAST — globalne powiadomienia
// ============================================================================

/**
 * Wyświetla toast z komunikatem. Znika automatycznie po 3 sekundach.
 * @param {string} message - Treść komunikatu
 * @param {'success'|'error'|'info'} type - Typ powiadomienia
 * @returns {void}
 */
function showToast(message, type = TOAST_TYPE.INFO) {
  const container = document.getElementById('toast-container')
  if (!container) {
    console.warn('[app.js] toast-container missing:', message)
    return
  }
  const colors = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-slate-800',
  }
  const toast = document.createElement('div')
  toast.className = `${colors[type]} text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium animate-in fade-in`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => toast.remove(), 3000)
}

// ============================================================================
// AUTH — logowanie, rejestracja, wylogowanie, listener sesji
// ============================================================================

/**
 * Inicjalizuje moduł auth: sprawdza istniejącą sesję, ustawia listener,
 * podpina handlery formularzy i przełącza widoczność ekranów.
 * @returns {Promise<void>}
 */
async function initAuth() {
  // Krok 1: sprawdź czy użytkownik ma aktywną sesję (przywróconą z localStorage)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      handleAuthenticated(session.user)
    } else {
      showAuthScreen()
    }
  } catch (error) {
    console.error('[app.js] initAuth getSession failed:', error)
    showAuthScreen()
  }

  // Krok 2: nasłuchuj zmian sesji (login/logout w innej karcie też)
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      handleAuthenticated(session.user)
    } else if (event === 'SIGNED_OUT') {
      cleanupAppSession()
      showAuthScreen()
    }
  })

  // Krok 3: podepnij handlery formularzy
  bindAuthForms()
}

/**
 * Pokazuje ekran logowania, ukrywa główną aplikację.
 * @returns {void}
 */
function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden')
  document.getElementById('app-screen').classList.add('hidden')
}

/**
 * Reaguje na pomyślne uwierzytelnienie: pokazuje aplikację, ładuje dane,
 * inicjalizuje subskrypcje Realtime oraz moduły AI (manager + executor).
 * @param {Object} user - Obiekt user z Supabase Auth
 * @returns {Promise<void>}
 */
async function handleAuthenticated(user) {
  cleanupGlobalSubscriptions()
  state.user = user
  document.getElementById('auth-screen').classList.add('hidden')
  document.getElementById('app-screen').classList.remove('hidden')
  document.getElementById('user-email').textContent = user.email

  // Krok 1: załaduj dane do widoków
  const loadJobs = [refreshTasks(), refreshAgents(), refreshWorkstations(), refreshMonitorLog()]
  if (canManageEnrollmentTokens()) loadJobs.push(refreshEnrollmentTokens())
  await Promise.all(loadJobs)
  renderEnrollmentPanelVisibility()

  // Krok 2: subskrybuj globalne zmiany w `tasks` aby odświeżać dashboard
  subscribeToAllTasks()
  subscribeToWorkstationsBoard()
  if (canManageEnrollmentTokens()) subscribeToEnrollmentTokens()
  subscribeToMonitorLog()

  // Krok 3: sprawdź dostępność lokalnego AI proxy (badge w headerze)
  initAiClient()

  // Krok 4: uruchom AI kierownika i agenta wykonawczego
  // (używają ai-client gdy proxy dostępne, inaczej trybu przeglądarkowego)
  initManager(supabase)
  initExecutor(supabase)
}

/**
 * Podpina handlery formularzy logowania, rejestracji i przełączania zakładek.
 * @returns {void}
 */
function bindAuthForms() {
  const tabLogin = document.getElementById('tab-login')
  const tabRegister = document.getElementById('tab-register')
  const formLogin = document.getElementById('form-login')
  const formRegister = document.getElementById('form-register')

  tabLogin.addEventListener('click', () => switchAuthTab('login'))
  tabRegister.addEventListener('click', () => switchAuthTab('register'))

  formLogin.addEventListener('submit', (e) => {
    e.preventDefault()
    handleLogin(
      document.getElementById('login-email').value,
      document.getElementById('login-password').value,
    )
  })

  formRegister.addEventListener('submit', (e) => {
    e.preventDefault()
    handleRegister(
      document.getElementById('register-email').value,
      document.getElementById('register-password').value,
    )
  })
}

/**
 * Przełącza widoczność zakładek logowanie/rejestracja.
 * @param {'login'|'register'} tab
 * @returns {void}
 */
function switchAuthTab(tab) {
  const isLogin = tab === 'login'
  document.getElementById('tab-login').classList.toggle('border-blue-600', isLogin)
  document.getElementById('tab-login').classList.toggle('text-blue-600', isLogin)
  document.getElementById('tab-login').classList.toggle('border-transparent', !isLogin)
  document.getElementById('tab-login').classList.toggle('text-slate-500', !isLogin)
  document.getElementById('tab-register').classList.toggle('border-blue-600', !isLogin)
  document.getElementById('tab-register').classList.toggle('text-blue-600', !isLogin)
  document.getElementById('tab-register').classList.toggle('border-transparent', isLogin)
  document.getElementById('tab-register').classList.toggle('text-slate-500', isLogin)
  document.getElementById('form-login').classList.toggle('hidden', !isLogin)
  document.getElementById('form-register').classList.toggle('hidden', isLogin)
}

/**
 * Loguje użytkownika emailem i hasłem.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<void>}
 */
async function handleLogin(email, password) {
  const errorEl = document.getElementById('login-error')
  errorEl.classList.add('hidden')
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    showToast('Zalogowano pomyślnie', TOAST_TYPE.SUCCESS)
  } catch (error) {
    console.error('[app.js] handleLogin failed:', error)
    errorEl.textContent = error.message || 'Błąd logowania'
    errorEl.classList.remove('hidden')
  }
}

/**
 * Rejestruje nowe konto.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<void>}
 */
async function handleRegister(email, password) {
  const errorEl = document.getElementById('register-error')
  errorEl.classList.add('hidden')
  try {
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    showToast('Sprawdź email, aby potwierdzić konto', TOAST_TYPE.SUCCESS)
  } catch (error) {
    console.error('[app.js] handleRegister failed:', error)
    errorEl.textContent = error.message || 'Błąd rejestracji'
    errorEl.classList.remove('hidden')
  }
}

/**
 * Wylogowuje użytkownika.
 * @returns {Promise<void>}
 */
async function handleLogout() {
  try {
    cleanupAppSession()
    await supabase.auth.signOut()
    showToast('Wylogowano', TOAST_TYPE.INFO)
  } catch (error) {
    console.error('[app.js] handleLogout failed:', error)
    showToast('Błąd wylogowania', TOAST_TYPE.ERROR)
  }
}

// ============================================================================
// NAWIGACJA — przełączanie widoków w głównym obszarze aplikacji
// ============================================================================

/**
 * Pokazuje wybrany widok i ukrywa pozostałe.
 * @param {string} viewName - Nazwa widoku (z VIEW)
 * @returns {void}
 */
function navigateTo(viewName) {
  const target = document.getElementById(`view-${viewName}`)
  if (!target) {
    console.warn('[app.js] missing view:', viewName)
    return
  }
  state.currentView = viewName
  document.querySelectorAll('.view-section').forEach((el) => el.classList.add('hidden'))
  target.classList.remove('hidden')

  // Aktualizuj tytuł strony i podświetlenie linków sidebar
  const titles = {
    dashboard: 'Dashboard',
    tasks: 'Polecenia',
    'task-detail': 'Szczegóły polecenia',
    agents: 'Profile agentów',
    workstations: 'Stacje robocze',
    monitor: 'Monitor',
    advanced: 'Zaawansowane',
    settings: 'Ustawienia',
  }
  document.getElementById('page-title').textContent = titles[viewName] || ''

  document.querySelectorAll('.nav-link').forEach((link) => {
    const isActive = link.dataset.view === viewName
    link.classList.toggle('bg-blue-50', isActive)
    link.classList.toggle('text-blue-700', isActive)
    link.classList.toggle('text-slate-600', !isActive)
  })
  if (viewName === VIEW.SETTINGS) renderSettingsForm()
}

/**
 * Podpina nawigację boczną i przyciski akcji.
 * @returns {void}
 */
function bindNavigation() {
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => navigateTo(link.dataset.view))
  })
  document.getElementById('btn-logout').addEventListener('click', handleLogout)
  document.getElementById('btn-open-help').addEventListener('click', openHelpModal)
  document.getElementById('btn-save-settings').addEventListener('click', handleSaveSettings)
  document.getElementById('btn-generate-station-config').addEventListener('click', renderStationConfigInstruction)
  document.getElementById('form-classroom-grid')?.addEventListener('submit', handleApplyClassroomGrid)
  document.getElementById('form-workstation-edit')?.addEventListener('submit', handleWorkstationEditSubmit)
  document.getElementById('form-enrollment-token')?.addEventListener('submit', handleCreateEnrollmentToken)
  document.getElementById('btn-copy-enrollment-token')?.addEventListener('click', copyLatestEnrollmentToken)
  document.getElementById('btn-clear-task-log')?.addEventListener('click', handleClearTaskLog)
  document.getElementById('btn-back-to-tasks').addEventListener('click', () => {
    cleanupTaskSubscriptions()
    navigateTo(VIEW.TASKS)
  })
  document.getElementById('btn-delete-task-detail').addEventListener('click', () => {
    if (!state.currentTaskId) return
    handleDeleteTask(state.currentTaskId)
  })
}

// ============================================================================
// CRUD: TASKS
// ============================================================================

/**
 * Tworzy nowe zadanie w tabeli `tasks`.
 * @param {Object} payload
 * @param {string} payload.title
 * @param {string} payload.description
 * @param {string} payload.priority - low|medium|high
 * @param {string} [payload.repo]
 * @param {Object} [payload.context]
 * @param {string} [payload.template]
 * @returns {Promise<Object|null>} Utworzony rekord lub null przy błędzie
 */
async function createTask({ title, description, priority, repo, context, template, workstationId, modelName }) {
  try {
    const row = {
      title,
      description,
      priority,
      status: STATUS.PENDING,
      git_repo: repo || null,
      context: { template: template || null, raw: context || null },
      user_id: state.user?.id || null,
      requested_workstation_id: workstationId || null,
      requested_model_name: modelName || null,
    }
    const { data, error } = await supabase.from('tasks').insert(row).select().single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('[app.js] createTask failed:', error)
    showToast('Błąd zapisu zadania. Spróbuj ponownie.', TOAST_TYPE.ERROR)
    return null
  }
}

/**
 * Pobiera 50 ostatnich zadań.
 * @returns {Promise<Array>}
 */
async function getTasks() {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('[app.js] getTasks failed:', error)
    showToast('Błąd pobierania zadań.', TOAST_TYPE.ERROR)
    return []
  }
}

/**
 * Pobiera pojedyncze zadanie po ID.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getTaskById(id) {
  try {
    const { data, error } = await supabase.from('tasks').select('*').eq('id', id).single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('[app.js] getTaskById failed:', error)
    return null
  }
}

/**
 * Usuwa zadanie z tabeli `tasks`.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function deleteTask(id) {
  try {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) throw error
    return true
  } catch (error) {
    console.error('[app.js] deleteTask failed:', error)
    showToast('Błąd usuwania zadania.', TOAST_TYPE.ERROR)
    return false
  }
}

/**
 * Potwierdza i wykonuje usunięcie zadania z dowolnego widoku.
 * @param {string} taskId
 * @returns {Promise<void>}
 */
async function handleDeleteTask(taskId) {
  if (!confirm('Usunąć polecenie? Zadanie i jego rozmowy AI zostaną usunięte. Historia stacji roboczych zostanie zachowana bez powiązania z tym zadaniem.')) return
  const ok = await deleteTask(taskId)
  if (!ok) return

  if (state.currentTaskId === taskId) {
    cleanupTaskSubscriptions()
    state.currentTaskId = null
    navigateTo(VIEW.TASKS)
  }
  await refreshTasks()
  showToast('Polecenie usunięte.', TOAST_TYPE.SUCCESS)
}

/**
 * Pobiera wiadomości powiązane z zadaniem (tabela `messages`).
 * @param {string} taskId
 * @returns {Promise<Array>}
 */
async function getMessagesForTask(taskId) {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('[app.js] getMessagesForTask failed:', error)
    return []
  }
}

/**
 * Odświeża listę zadań na dashboardzie i statystyki kart.
 * @returns {Promise<void>}
 */
async function refreshTasks() {
  const tasks = await getTasks()
  state.tasks = tasks
  renderTasksTable('tasks-table-body', tasks.slice(0, 10))
  renderTasksTable('tasks-table-body-full', tasks)
  renderStats(tasks)
  renderMonitorPanel()
}

// ============================================================================
// CRUD: WORKSTATIONS
// ============================================================================

/**
 * Pobiera listę stacji roboczych wraz z modelami.
 * @returns {Promise<Array>}
 */
async function getWorkstations() {
  try {
    const { data, error } = await supabase
      .from('workstations')
      .select('*, workstation_models(*)')
      .order('display_name')
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('[app.js] getWorkstations failed:', error)
    showToast('Błąd pobierania stacji roboczych.', TOAST_TYPE.ERROR)
    return []
  }
}

/**
 * Odświeża widok stacji i opcje w formularzu zadania.
 * @returns {Promise<void>}
 */
async function refreshWorkstations() {
  const workstations = await getWorkstations()
  state.workstations = workstations
  if (state.selectedMonitorWorkstationId && !findWorkstation(state.selectedMonitorWorkstationId)) {
    state.selectedMonitorWorkstationId = null
  }
  renderWorkstationsTable(workstations)
  renderClassroomGrid(workstations)
  renderMonitorPanel()
  renderAdvancedRuntimePanel(workstations)
  renderStats(state.tasks)
  populateTaskWorkstationSelects()
  renderSettingsForm()
}

/**
 * Aktualizuje dane porządkowe stacji roboczej.
 * @param {string} workstationId
 * @param {Object} payload
 * @returns {Promise<boolean>}
 */
async function updateWorkstation(workstationId, payload) {
  try {
    const { error } = await supabase
      .from('workstations')
      .update(payload)
      .eq('id', workstationId)
    if (error) throw error
    return true
  } catch (error) {
    console.error('[app.js] updateWorkstation failed:', error)
    showToast('Nie udało się zapisać stacji. Sprawdź migrację bazy i RLS.', TOAST_TYPE.ERROR)
    return false
  }
}

/**
 * Buduje payload zmiany sali/pozycji z kopią w metadata dla zgodności wstecznej.
 * @param {Object} workstation
 * @param {Object} values
 * @returns {Object}
 */
function workstationLocationPayload(workstation, values) {
  const room = normalizeRoom(values.classroomLabel)
  const row = normalizeGridNumber(values.gridRow)
  const col = normalizeGridNumber(values.gridCol)
  const label = String(values.gridLabel || '').trim() || (room && row && col ? `${room}_${row}_${col}` : '')
  return {
    display_name: String(values.displayName || workstation.display_name || workstation.hostname || 'Stacja').trim(),
    classroom_label: room || null,
    grid_row: row,
    grid_col: col,
    grid_label: label || null,
    metadata: {
      ...(workstation.metadata || {}),
      classroomLabel: room || null,
      gridRow: row,
      gridCol: col,
      gridLabel: label || null,
    },
  }
}

function normalizeRoom(value) {
  return String(value || '').trim().replace(/\s+/g, '_')
}

function normalizeGridNumber(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return Math.min(99, parsed)
}

function workstationRoom(workstation) {
  return workstation.classroom_label || workstation.metadata?.classroomLabel || 'Bez sali'
}

function workstationGridRow(workstation) {
  return normalizeGridNumber(workstation.grid_row ?? workstation.metadata?.gridRow)
}

function workstationGridCol(workstation) {
  return normalizeGridNumber(workstation.grid_col ?? workstation.metadata?.gridCol)
}

function workstationGridLabel(workstation) {
  const room = workstationRoom(workstation)
  const row = workstationGridRow(workstation)
  const col = workstationGridCol(workstation)
  return workstation.grid_label || workstation.metadata?.gridLabel || (room !== 'Bez sali' && row && col ? `${room}_${row}_${col}` : workstation.display_name || workstation.hostname || 'Stacja')
}

function workstationDisplayName(workstation) {
  return workstation.display_name || workstation.hostname || 'Stacja'
}

function groupWorkstationsByRoom(workstations) {
  const groups = new Map()
  for (const workstation of workstations) {
    const room = workstationRoom(workstation)
    if (!groups.has(room)) groups.set(room, [])
    groups.get(room).push(workstation)
  }
  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, 'pl'))
}

function canManageEnrollmentTokens() {
  return state.user && state.user.app_metadata?.role !== 'workstation' && state.user.user_metadata?.role !== 'workstation'
}

function renderEnrollmentPanelVisibility() {
  const panel = document.getElementById('workstation-enrollment-panel')
  if (!panel) return
  panel.classList.toggle('hidden', !canManageEnrollmentTokens())
}

async function getEnrollmentTokens() {
  try {
    const { data, error } = await supabase
      .from('workstation_enrollment_tokens')
      .select('id, created_by_user_id, assigned_workstation_name, expires_at, uses_allowed, used_count, revoked_at, last_redeemed_at, last_redeemed_metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('[app.js] getEnrollmentTokens failed:', error)
    showToast('Błąd pobierania tokenów stacji.', TOAST_TYPE.ERROR)
    return []
  }
}

async function refreshEnrollmentTokens() {
  if (!canManageEnrollmentTokens()) return
  state.enrollmentTokens = await getEnrollmentTokens()
  renderEnrollmentTokensTable(state.enrollmentTokens)
}

async function handleCreateEnrollmentToken(event) {
  event.preventDefault()
  if (!canManageEnrollmentTokens()) return
  const workstationName = document.getElementById('enrollment-workstation-name').value.trim()
  const expiresHours = Number(document.getElementById('enrollment-expires-hours').value || 24)
  const usesAllowed = Math.max(1, Math.min(50, Number(document.getElementById('enrollment-uses').value || 1)))
  const expiresAt = new Date(Date.now() + Math.max(1, expiresHours) * 60 * 60 * 1000).toISOString()
  try {
    const { data, error } = await supabase.functions.invoke('create-workstation-enrollment', {
      body: { workstationName, expiresAt, usesAllowed },
    })
    if (error) throw error
    showOneTimeEnrollmentToken(data?.token || '')
    document.getElementById('form-enrollment-token').reset()
    document.getElementById('enrollment-expires-hours').value = '24'
    document.getElementById('enrollment-uses').value = '1'
    await refreshEnrollmentTokens()
    showToast('Token stacji wygenerowany.', TOAST_TYPE.SUCCESS)
  } catch (error) {
    console.error('[app.js] handleCreateEnrollmentToken failed:', error)
    showToast('Nie udało się wygenerować tokenu. Sprawdź Edge Function i sekrety Supabase.', TOAST_TYPE.ERROR)
  }
}

function showOneTimeEnrollmentToken(token) {
  const container = document.getElementById('enrollment-token-once')
  const value = document.getElementById('enrollment-token-value')
  if (!container || !value) return
  value.textContent = token || 'Brak tokenu w odpowiedzi funkcji.'
  container.classList.remove('hidden')
}

async function copyLatestEnrollmentToken() {
  const value = document.getElementById('enrollment-token-value')?.textContent || ''
  if (!value || value.startsWith('Brak tokenu')) return
  try {
    await navigator.clipboard.writeText(value)
    showToast('Token skopiowany.', TOAST_TYPE.SUCCESS)
  } catch (error) {
    console.error('[app.js] copyLatestEnrollmentToken failed:', error)
    showToast('Nie udało się skopiować tokenu.', TOAST_TYPE.ERROR)
  }
}

async function revokeEnrollmentToken(id) {
  if (!canManageEnrollmentTokens()) return
  if (!confirm('Cofnąć ten token instalacyjny? Nie będzie można go użyć do nowej stacji.')) return
  try {
    const { error } = await supabase
      .from('workstation_enrollment_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await refreshEnrollmentTokens()
    showToast('Token cofnięty.', TOAST_TYPE.SUCCESS)
  } catch (error) {
    console.error('[app.js] revokeEnrollmentToken failed:', error)
    showToast('Nie udało się cofnąć tokenu.', TOAST_TYPE.ERROR)
  }
}

function enrollmentTokenStatus(token) {
  if (token.revoked_at) return { label: 'cofnięty', cls: 'bg-red-100 text-red-700' }
  if (new Date(token.expires_at).getTime() <= Date.now()) return { label: 'wygasł', cls: 'bg-slate-200 text-slate-700' }
  if (Number(token.used_count || 0) >= Number(token.uses_allowed || 1)) return { label: 'użyty', cls: 'bg-blue-100 text-blue-700' }
  return { label: 'aktywny', cls: 'bg-emerald-100 text-emerald-700' }
}

function renderEnrollmentTokensTable(tokens) {
  const tbody = document.getElementById('enrollment-tokens-table-body')
  if (!tbody) return
  if (!tokens.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-6 text-center text-slate-500">Brak tokenów instalacyjnych.</td></tr>'
    return
  }
  tbody.innerHTML = tokens.map((token) => {
    const status = enrollmentTokenStatus(token)
    const used = `${Number(token.used_count || 0)}/${Number(token.uses_allowed || 1)}`
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-6 py-3 font-medium">${escapeHtml(token.assigned_workstation_name || 'Dowolna stacja')}</td>
        <td class="px-6 py-3"><span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${status.cls}">${escapeHtml(status.label)}</span></td>
        <td class="px-6 py-3 font-mono text-xs text-slate-700">${escapeHtml(used)}</td>
        <td class="px-6 py-3 text-slate-500">${formatDate(token.expires_at)}</td>
        <td class="px-6 py-3 text-slate-500">${token.last_redeemed_at ? formatDate(token.last_redeemed_at) : '—'}</td>
        <td class="px-6 py-3 text-right">
          <button class="enrollment-revoke text-red-600 hover:underline text-sm" data-id="${token.id}" ${token.revoked_at ? 'disabled' : ''}>Cofnij</button>
        </td>
      </tr>
    `
  }).join('')
  tbody.querySelectorAll('.enrollment-revoke').forEach((button) => {
    button.addEventListener('click', () => revokeEnrollmentToken(button.dataset.id))
  })
}

async function handleApplyClassroomGrid(event) {
  event.preventDefault()
  const room = normalizeRoom(document.getElementById('classroom-grid-room')?.value || '')
  const rows = normalizeGridNumber(document.getElementById('classroom-grid-rows')?.value || 4) || 4
  const cols = normalizeGridNumber(document.getElementById('classroom-grid-cols')?.value || 6) || 6
  if (!room) {
    showToast('Podaj nazwę sali, np. 226.', TOAST_TYPE.ERROR)
    return
  }
  const selected = state.workstations
    .filter((workstation) => workstationRoom(workstation) === room || workstationRoom(workstation) === 'Bez sali')
    .sort((left, right) => workstationDisplayName(left).localeCompare(workstationDisplayName(right), 'pl'))
    .slice(0, rows * cols)
  if (!selected.length) {
    showToast('Nie ma stacji do ułożenia w tej sali.', TOAST_TYPE.INFO)
    return
  }
  const results = await Promise.all(selected.map((workstation, index) => {
    const row = Math.floor(index / cols) + 1
    const col = (index % cols) + 1
    return updateWorkstation(workstation.id, workstationLocationPayload(workstation, {
      displayName: workstationDisplayName(workstation),
      classroomLabel: room,
      gridRow: row,
      gridCol: col,
      gridLabel: `${room}_${row}_${col}`,
    }))
  }))
  if (results.every(Boolean)) {
    await refreshWorkstations()
    showToast(`Ułożono ${selected.length} stacji w sali ${room}.`, TOAST_TYPE.SUCCESS)
  }
}

function openWorkstationEditModal(workstationId) {
  const workstation = findWorkstation(workstationId)
  if (!workstation) return
  state.editingWorkstationId = workstationId
  document.getElementById('workstation-edit-id').value = workstationId
  document.getElementById('workstation-edit-name').value = workstationDisplayName(workstation)
  document.getElementById('workstation-edit-room').value = workstationRoom(workstation) === 'Bez sali' ? '' : workstationRoom(workstation)
  document.getElementById('workstation-edit-row').value = workstationGridRow(workstation) || ''
  document.getElementById('workstation-edit-col').value = workstationGridCol(workstation) || ''
  document.getElementById('workstation-edit-label').value = workstation.grid_label || workstation.metadata?.gridLabel || ''
  document.getElementById('modal-workstation-edit').classList.remove('hidden')
}

async function handleWorkstationEditSubmit(event) {
  event.preventDefault()
  const workstationId = document.getElementById('workstation-edit-id').value
  const workstation = findWorkstation(workstationId)
  if (!workstation) return
  const payload = workstationLocationPayload(workstation, {
    displayName: document.getElementById('workstation-edit-name').value,
    classroomLabel: document.getElementById('workstation-edit-room').value,
    gridRow: document.getElementById('workstation-edit-row').value,
    gridCol: document.getElementById('workstation-edit-col').value,
    gridLabel: document.getElementById('workstation-edit-label').value,
  })
  const ok = await updateWorkstation(workstationId, payload)
  if (!ok) return
  closeAllModals()
  await refreshWorkstations()
  showToast('Stacja zapisana.', TOAST_TYPE.SUCCESS)
}

/**
 * Renderuje tabelę stacji roboczych.
 * @param {Array} workstations
 * @returns {void}
 */
function renderWorkstationsTable(workstations) {
  const tbody = document.getElementById('workstations-table-body')
  if (!tbody) return
  if (!workstations.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-8 text-center text-slate-500">Brak aktywnych stacji. Uruchom start.command/start.sh na wybranym komputerze.</td></tr>'
    return
  }

  tbody.innerHTML = workstations.map((workstation) => {
    const models = getWorkstationModelLabels(workstation)
    const position = workstationGridRow(workstation) && workstationGridCol(workstation)
      ? `${workstationGridRow(workstation)} / ${workstationGridCol(workstation)}`
      : '—'
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-6 py-3 font-medium">${escapeHtml(workstationDisplayName(workstation))}</td>
        <td class="px-6 py-3 text-slate-600">
          <div>${escapeHtml(workstationRoom(workstation))}</div>
          <div class="font-mono text-xs text-slate-400">${escapeHtml(position)} · ${escapeHtml(workstationGridLabel(workstation))}</div>
        </td>
        <td class="px-6 py-3 text-slate-600">${escapeHtml(formatWorkstationPlatform(workstation))}</td>
        <td class="px-6 py-3 text-slate-600">${escapeHtml(workstation.current_model_name || models[0] || '—')}</td>
        <td class="px-6 py-3">${workstationStatusBadge(workstation.status)}</td>
        <td class="px-6 py-3">${workstationAdvancedSummary(workstation)}</td>
        <td class="px-6 py-3 text-slate-500">${formatDate(workstation.last_seen_at)}</td>
        <td class="px-6 py-3 space-x-2">
          <button class="workstation-edit text-slate-700 hover:underline text-sm" data-id="${workstation.id}">Edytuj</button>
          <button class="workstation-message text-blue-600 hover:underline text-sm" data-id="${workstation.id}">Wyślij wiadomość</button>
        </td>
      </tr>
    `
  }).join('')

  tbody.querySelectorAll('.workstation-edit').forEach((button) => {
    button.addEventListener('click', () => openWorkstationEditModal(button.dataset.id))
  })
  tbody.querySelectorAll('.workstation-message').forEach((button) => {
    button.addEventListener('click', () => openWorkstationMessageModal(button.dataset.id, null))
  })
}

/**
 * Renderuje graficzny plan sal i stanowisk.
 * @param {Array} workstations
 * @returns {void}
 */
function renderClassroomGrid(workstations) {
  const container = document.getElementById('workstation-classroom-grid')
  if (!container) return
  if (!workstations.length) {
    container.innerHTML = '<p class="text-sm text-slate-500">Brak stacji do ułożenia w siatce.</p>'
    return
  }

  container.innerHTML = groupWorkstationsByRoom(workstations).map(([room, roomStations]) => {
    const maxRow = Math.max(1, ...roomStations.map((workstation) => workstationGridRow(workstation) || 1))
    const maxCol = Math.max(1, ...roomStations.map((workstation) => workstationGridCol(workstation) || 1))
    const rows = room === 'Bez sali' ? Math.min(2, Math.ceil(roomStations.length / 6) || 1) : maxRow
    const cols = room === 'Bez sali' ? Math.min(6, Math.max(1, roomStations.length)) : maxCol
    const cells = []
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= cols; col += 1) {
        const station = roomStations.find((workstation) => workstationGridRow(workstation) === row && workstationGridCol(workstation) === col)
        cells.push(classroomGridCell(room, row, col, station))
      }
    }
    const unplaced = roomStations.filter((workstation) => !workstationGridRow(workstation) || !workstationGridCol(workstation))
    return `
      <section class="rounded-lg border border-slate-200 bg-white p-4">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div>
            <h4 class="font-semibold text-slate-900">${escapeHtml(room)}</h4>
            <div class="text-xs text-slate-500">${roomStations.length} stacji · siatka ${rows} x ${cols}</div>
          </div>
        </div>
        <div class="grid gap-2" style="grid-template-columns: repeat(${cols}, minmax(92px, 1fr));">
          ${cells.join('')}
        </div>
        ${unplaced.length ? `
          <div class="mt-3 flex flex-wrap gap-2">
            ${unplaced.map((workstation) => classroomUnplacedChip(workstation)).join('')}
          </div>
        ` : ''}
      </section>
    `
  }).join('')

  bindClassroomGridEvents(container)
}

function classroomGridCell(room, row, col, workstation) {
  const cellAttrs = `data-room="${escapeHtml(room)}" data-row="${row}" data-col="${col}"`
  if (!workstation) {
    return `<button type="button" class="classroom-drop min-h-[74px] rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400 hover:border-blue-300 hover:bg-blue-50" ${cellAttrs}>${row}.${col}</button>`
  }
  const stale = isStaleWorkstation(workstation)
  const busy = workstation.status === 'busy'
  const cls = stale ? 'border-red-200 bg-red-50' : busy ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50'
  return `
    <button type="button" draggable="true" class="classroom-tile classroom-drop min-h-[74px] rounded-lg border ${cls} p-2 text-left hover:ring-2 hover:ring-blue-200" data-id="${workstation.id}" ${cellAttrs}>
      <div class="flex items-center justify-between gap-2">
        <span class="font-mono text-xs text-slate-500">${escapeHtml(workstationGridLabel(workstation))}</span>
        <span class="h-2 w-2 rounded-full ${stale ? 'bg-red-500' : busy ? 'bg-blue-500' : 'bg-emerald-500'}"></span>
      </div>
      <div class="mt-1 font-semibold text-slate-900 truncate">${escapeHtml(workstationDisplayName(workstation))}</div>
      <div class="text-xs text-slate-500 truncate">${escapeHtml(workstationActiveJobs(workstation) + '/' + workstationParallelSlots(workstation) + ' slotów')}</div>
    </button>
  `
}

function classroomUnplacedChip(workstation) {
  return `
    <button type="button" draggable="true" class="classroom-tile rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:border-blue-300" data-id="${workstation.id}">
      ${escapeHtml(workstationDisplayName(workstation))}
    </button>
  `
}

function bindClassroomGridEvents(container) {
  container.querySelectorAll('.classroom-tile').forEach((tile) => {
    tile.addEventListener('click', () => openWorkstationEditModal(tile.dataset.id))
    tile.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/workstation-id', tile.dataset.id)
    })
  })
  container.querySelectorAll('.classroom-drop').forEach((cell) => {
    cell.addEventListener('dragover', (event) => event.preventDefault())
    cell.addEventListener('drop', (event) => handleClassroomDrop(event, cell))
  })
}

async function handleClassroomDrop(event, cell) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/workstation-id')
  if (!draggedId) return
  const dragged = findWorkstation(draggedId)
  if (!dragged) return
  const targetId = cell.dataset.id || null
  const target = targetId ? findWorkstation(targetId) : null
  const room = normalizeRoom(cell.dataset.room)
  const row = normalizeGridNumber(cell.dataset.row)
  const col = normalizeGridNumber(cell.dataset.col)
  const updates = [
    updateWorkstation(dragged.id, workstationLocationPayload(dragged, {
      displayName: workstationDisplayName(dragged),
      classroomLabel: room,
      gridRow: row,
      gridCol: col,
      gridLabel: `${room}_${row}_${col}`,
    })),
  ]
  if (target && target.id !== dragged.id) {
    const originalRoom = workstationRoom(dragged)
    const originalRow = workstationGridRow(dragged)
    const originalCol = workstationGridCol(dragged)
    updates.push(updateWorkstation(target.id, workstationLocationPayload(target, {
      displayName: workstationDisplayName(target),
      classroomLabel: originalRoom,
      gridRow: originalRow,
      gridCol: originalCol,
      gridLabel: originalRoom !== 'Bez sali' && originalRow && originalCol ? `${originalRoom}_${originalRow}_${originalCol}` : workstationGridLabel(target),
    })))
  }
  const results = await Promise.all(updates)
  if (results.every(Boolean)) {
    await refreshWorkstations()
    showToast('Pozycja stacji zapisana.', TOAST_TYPE.SUCCESS)
  }
}

/**
 * Renderuje skrót ustawień Advanced w tabeli stacji.
 * @param {Object} workstation
 * @returns {string}
 */
function workstationAdvancedSummary(workstation) {
  const slots = workstationParallelSlots(workstation)
  const active = workstationActiveJobs(workstation)
  const sdLabel = workstationSdEnabled(workstation) ? 'SD on' : 'SD off'
  return `
    <div class="space-y-1">
      <div class="font-mono text-xs text-slate-700">${active}/${slots} slotów</div>
      <div class="text-xs text-slate-500">${escapeHtml(workstationContextLabel(workstation))} · KV ${escapeHtml(workstationKvCacheLabel(workstation))}</div>
      <div class="text-xs text-slate-500">${escapeHtml(sdLabel)}</div>
    </div>
  `
}

/**
 * Renderuje panel Advanced z podsumowaniem runtime.
 * @param {Array} workstations
 * @returns {void}
 */
function renderAdvancedRuntimePanel(workstations) {
  const tbody = document.getElementById('advanced-runtime-table-body')
  if (!tbody) return
  const active = workstations.filter((workstation) => workstation.status === 'online' || workstation.status === 'busy')
  const totalSlots = active.reduce((sum, workstation) => sum + workstationParallelSlots(workstation), 0)
  const sdCount = active.filter(workstationSdEnabled).length
  const longContextCount = active.filter((workstation) => workstationContextTokens(workstation) >= 65536).length
  setText('advanced-active-workstations', active.length)
  setText('advanced-total-slots', totalSlots)
  setText('advanced-sd-state', sdCount ? `${sdCount} on` : 'off')
  setText('advanced-context-state', longContextCount ? `${longContextCount} long` : 'native')

  if (!workstations.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-8 text-center text-slate-500">Brak danych runtime.</td></tr>'
    return
  }

  tbody.innerHTML = workstations.map((workstation) => {
    const metadata = workstation.metadata || {}
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-6 py-3 font-medium">${escapeHtml(workstation.display_name || workstation.hostname || 'Stacja')}</td>
        <td class="px-6 py-3 font-mono text-xs text-slate-700">${workstationActiveJobs(workstation)}/${workstationParallelSlots(workstation)}</td>
        <td class="px-6 py-3 text-slate-600">${escapeHtml(workstationContextLabel(workstation))}</td>
        <td class="px-6 py-3 text-slate-600">${escapeHtml(workstationKvCacheLabel(workstation))}</td>
        <td class="px-6 py-3">${workstationSdEnabled(workstation) ? 'on' : 'off'}</td>
        <td class="px-6 py-3 text-slate-600">${escapeHtml(metadata.optimizationMode || 'standard')}</td>
        <td class="px-6 py-3 text-slate-600">${escapeHtml(metadata.draftModelName || '—')}</td>
      </tr>
    `
  }).join('')
}

/**
 * Zwraca liczbę slotów zgłoszoną przez stację.
 * @param {Object} workstation
 * @returns {number}
 */
function workstationParallelSlots(workstation) {
  const value = Number(workstation.metadata?.parallelSlots || 1)
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(4, value))
}

/**
 * Zwraca liczbę aktywnych jobów zgłoszoną przez stację.
 * @param {Object} workstation
 * @returns {number}
 */
function workstationActiveJobs(workstation) {
  const value = Number(workstation.metadata?.activeJobs || 0)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

/**
 * Sprawdza, czy stacja raportuje włączone SD.
 * @param {Object} workstation
 * @returns {boolean}
 */
function workstationSdEnabled(workstation) {
  return workstation.metadata?.sdEnabled === true
}

/**
 * Zwraca liczbę tokenów kontekstu zgłoszoną przez stację.
 * @param {Object} workstation
 * @returns {number}
 */
function workstationContextTokens(workstation) {
  const value = Number(workstation.metadata?.effectiveContextSizeTokens ?? workstation.metadata?.contextSizeTokens ?? 0)
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

/**
 * Format etykiety kontekstu stacji.
 * @param {Object} workstation
 * @returns {string}
 */
function workstationContextLabel(workstation) {
  const mode = workstation.metadata?.contextMode || 'native'
  const tokens = workstationContextTokens(workstation)
  if (mode === 'native' || tokens === 0) return 'native ctx'
  if (tokens % 1024 === 0) return `${tokens / 1024}k ctx`
  return `${tokens} ctx`
}

/**
 * Format etykiety KV cache stacji.
 * @param {Object} workstation
 * @returns {string}
 */
function workstationKvCacheLabel(workstation) {
  return workstation.metadata?.effectiveKvCacheQuantization || workstation.metadata?.kvCacheQuantization || 'auto'
}

// ============================================================================
// MONITOR — szybki podgląd postępu i ostatnich zdarzeń
// ============================================================================

/**
 * Odświeża live log monitora z wiadomości AI i stacji.
 * @returns {Promise<void>}
 */
async function refreshMonitorLog() {
  const events = await getMonitorEvents()
  renderMonitorLog(events)
}

/**
 * Pobiera ostatnie zdarzenia do monitora.
 * @returns {Promise<Array>}
 */
async function getMonitorEvents() {
  try {
    const [aiMessages, stationMessages] = await Promise.all([getRecentAiMessages(), getRecentWorkstationMessages()])
    return [...aiMessages, ...stationMessages]
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice(0, 30)
  } catch (error) {
    console.error('[app.js] getMonitorEvents failed:', error)
    return []
  }
}

/**
 * Pobiera ostatnie wiadomości AI.
 * @returns {Promise<Array>}
 */
async function getRecentAiMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data || []).map((message) => ({ ...message, source: 'ai' }))
}

/**
 * Pobiera ostatnie wiadomości stacji roboczych.
 * @returns {Promise<Array>}
 */
async function getRecentWorkstationMessages() {
  const { data, error } = await supabase
    .from('workstation_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data || []).map((message) => ({ ...message, source: 'workstation' }))
}

/**
 * Renderuje metryki i listy monitora z aktualnego stanu aplikacji.
 * @returns {void}
 */
function renderMonitorPanel() {
  const activeTasks = state.tasks.filter(isActiveTask)
  const freeSlots = state.workstations.reduce((sum, workstation) => sum + workstationFreeSlots(workstation), 0)
  const staleStations = state.workstations.filter(isStaleWorkstation)
  setText('monitor-active-tasks', activeTasks.length)
  setText('monitor-free-slots', freeSlots)
  setText('monitor-stale-workstations', staleStations.length)
  renderMonitorActiveTasks(activeTasks)
  renderMonitorWorkstations(state.workstations)
  renderSelectedMonitorWorkstation()
}

/**
 * Czy zadanie jest wciąż w toku.
 * @param {Object} task
 * @returns {boolean}
 */
function isActiveTask(task) {
  return [STATUS.PENDING, STATUS.ANALYZING, STATUS.IN_PROGRESS].includes(task.status)
}

/**
 * Renderuje listę aktywnych zadań w monitorze.
 * @param {Array} tasks
 * @returns {void}
 */
function renderMonitorActiveTasks(tasks) {
  const list = document.getElementById('monitor-active-tasks-list')
  if (!list) return
  if (!tasks.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">Brak aktywnych zadań.</p>'
    return
  }
  list.innerHTML = tasks.slice(0, 8).map((task) => `
    <button class="monitor-task w-full text-left border border-slate-200 rounded-lg px-4 py-3 hover:bg-slate-50" data-task-id="${task.id}">
      <div class="flex items-center justify-between gap-3">
        <div class="font-medium text-slate-900 truncate">${escapeHtml(task.title || 'Bez tytułu')}</div>
        ${statusBadge(task.status)}
      </div>
      <div class="text-xs text-slate-500 mt-1">Stacja: ${escapeHtml(resolveWorkstationName(task.requested_workstation_id))} · ${formatDate(task.created_at)}</div>
    </button>
  `).join('')
  list.querySelectorAll('.monitor-task').forEach((button) => {
    button.addEventListener('click', () => openTaskDetail(button.dataset.taskId))
  })
}

/**
 * Renderuje skrót kondycji stacji w monitorze.
 * @param {Array} workstations
 * @returns {void}
 */
function renderMonitorWorkstations(workstations) {
  const list = document.getElementById('monitor-workstations-list')
  if (!list) return
  if (!workstations.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">Brak aktywnych stacji.</p>'
    return
  }
  list.innerHTML = workstations.map((workstation) => {
    const stale = isStaleWorkstation(workstation)
    const staleText = stale ? 'Może stać: brak świeżego heartbeat' : `Heartbeat ${formatDate(workstation.last_seen_at)}`
    return `
      <button type="button" class="monitor-workstation w-full text-left border ${stale ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'} rounded-lg px-4 py-3 hover:ring-2 hover:ring-blue-100" data-id="${workstation.id}">
        <div class="flex items-center justify-between gap-3">
          <div class="font-medium text-slate-900 truncate">${escapeHtml(workstationGridLabel(workstation))} · ${escapeHtml(workstationDisplayName(workstation))}</div>
          ${workstationStatusBadge(workstation.status)}
        </div>
        <div class="text-xs text-slate-500 mt-1">${escapeHtml(workstationRoom(workstation))} · Sloty: ${workstationActiveJobs(workstation)}/${workstationParallelSlots(workstation)} · ${escapeHtml(workstationContextLabel(workstation))} · ${escapeHtml(staleText)}</div>
      </button>
    `
  }).join('')
  list.querySelectorAll('.monitor-workstation').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedMonitorWorkstationId = button.dataset.id
      renderSelectedMonitorWorkstation()
    })
  })
}

function renderSelectedMonitorWorkstation() {
  const container = document.getElementById('monitor-station-detail')
  if (!container) return
  const workstation = findWorkstation(state.selectedMonitorWorkstationId) || state.workstations[0]
  if (!workstation) {
    container.innerHTML = '<p class="text-sm text-slate-500">Wybierz stację, aby zobaczyć monitor.</p>'
    return
  }
  state.selectedMonitorWorkstationId = workstation.id
  const models = getWorkstationModelLabels(workstation)
  const metadata = workstation.metadata || {}
  const stale = isStaleWorkstation(workstation)
  container.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <h4 class="font-semibold text-slate-900">${escapeHtml(workstationGridLabel(workstation))}</h4>
        <div class="text-sm text-slate-500">${escapeHtml(workstationDisplayName(workstation))} · ${escapeHtml(workstationRoom(workstation))}</div>
      </div>
      ${workstationStatusBadge(stale ? 'offline' : workstation.status)}
    </div>
    <dl class="grid grid-cols-2 gap-3 mt-4 text-sm">
      <div class="rounded-lg bg-slate-50 p-3"><dt class="text-slate-500">Sloty</dt><dd class="font-mono text-slate-900">${workstationActiveJobs(workstation)}/${workstationParallelSlots(workstation)}</dd></div>
      <div class="rounded-lg bg-slate-50 p-3"><dt class="text-slate-500">Kontekst</dt><dd class="font-mono text-slate-900">${escapeHtml(workstationContextLabel(workstation))}</dd></div>
      <div class="rounded-lg bg-slate-50 p-3"><dt class="text-slate-500">KV</dt><dd class="font-mono text-slate-900">${escapeHtml(workstationKvCacheLabel(workstation))}</dd></div>
      <div class="rounded-lg bg-slate-50 p-3"><dt class="text-slate-500">SD</dt><dd class="font-mono text-slate-900">${workstationSdEnabled(workstation) ? 'on' : 'off'}</dd></div>
      <div class="rounded-lg bg-slate-50 p-3"><dt class="text-slate-500">Platforma</dt><dd class="text-slate-900">${escapeHtml(formatWorkstationPlatform(workstation))}</dd></div>
      <div class="rounded-lg bg-slate-50 p-3"><dt class="text-slate-500">Heartbeat</dt><dd class="text-slate-900">${escapeHtml(formatDate(workstation.last_seen_at))}</dd></div>
    </dl>
    <div class="mt-4 rounded-lg border border-slate-200 bg-white p-3">
      <div class="text-xs font-semibold uppercase text-slate-500 mb-2">Modele</div>
      <div class="flex flex-wrap gap-2 text-xs">
        ${(models.length ? models : [workstation.current_model_name || 'brak modeli']).map((model) => `<span class="rounded-full bg-slate-100 px-2 py-1 text-slate-700">${escapeHtml(model)}</span>`).join('')}
      </div>
    </div>
    <div class="mt-4 rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-100 overflow-auto">
      <div>proxy: ${escapeHtml(String(metadata.proxyPort || '—'))} · llama: ${escapeHtml(String(metadata.llamaPort || '—'))}</div>
      <div>tryb: ${escapeHtml(metadata.optimizationMode || 'standard')} · timeout: ${escapeHtml(String(metadata.generationTimeoutMs || '—'))}ms</div>
      <div>ostatni stan: ${escapeHtml(stale ? 'heartbeat stale' : 'aktywny')}</div>
    </div>
  `
}

/**
 * Renderuje live log monitora.
 * @param {Array} events
 * @returns {void}
 */
function renderMonitorLog(events) {
  const list = document.getElementById('monitor-live-log')
  if (!list) return
  if (!events.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">Brak zdarzeń.</p>'
    return
  }
  list.innerHTML = events.map((event) => {
    const isStation = event.source === 'workstation'
    const label = isStation ? event.sender_label || 'stacja' : `${event.from_agent || 'agent'} → ${event.to_agent || 'agent'}`
    const type = event.message_type || event.type || 'event'
    return `
      <div class="border-l-4 ${isStation ? 'border-emerald-300 bg-emerald-50' : 'border-blue-300 bg-blue-50'} px-4 py-2 rounded-r-lg">
        <div class="text-xs text-slate-500 mb-1">
          <span class="font-semibold">${escapeHtml(label)}</span>
          <span class="ml-2 uppercase">[${escapeHtml(type)}]</span>
          <span class="ml-2">${formatDate(event.created_at)}</span>
        </div>
        <div class="text-sm text-slate-800">${escapeHtml(truncateText(event.content || '', 260))}</div>
      </div>
    `
  }).join('')
}

/**
 * Liczy wolne sloty stacji.
 * @param {Object} workstation
 * @returns {number}
 */
function workstationFreeSlots(workstation) {
  if (isStaleWorkstation(workstation)) return 0
  if (!['online', 'busy'].includes(workstation.status)) return 0
  return Math.max(0, workstationParallelSlots(workstation) - workstationActiveJobs(workstation))
}

/**
 * Sprawdza, czy stacja nie wysłała heartbeat od dłuższego czasu.
 * @param {Object} workstation
 * @returns {boolean}
 */
function isStaleWorkstation(workstation) {
  if (!workstation.last_seen_at) return true
  const ageMs = Date.now() - new Date(workstation.last_seen_at).getTime()
  return !Number.isFinite(ageMs) || ageMs > WORKSTATION_STALE_MS
}

/**
 * Skraca tekst logu do bezpiecznej długości.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

/**
 * Zwraca badge statusu stacji roboczej.
 * @param {string} status
 * @returns {string}
 */
function workstationStatusBadge(status) {
  const styles = {
    online: 'bg-emerald-100 text-emerald-700',
    busy: 'bg-blue-100 text-blue-700',
    offline: 'bg-slate-200 text-slate-700',
    error: 'bg-red-100 text-red-700',
  }
  const cls = styles[status] || styles.offline
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}">${escapeHtml(status || 'offline')}</span>`
}

/**
 * Skleja platformę stacji roboczej do czytelnej etykiety.
 * @param {Object} workstation
 * @returns {string}
 */
function formatWorkstationPlatform(workstation) {
  const parts = [workstation.os, workstation.arch, workstation.gpu_backend].filter(Boolean)
  return parts.length ? parts.join(' / ') : '—'
}

/**
 * Zwraca listę etykiet modeli stacji.
 * @param {Object} workstation
 * @returns {string[]}
 */
function getWorkstationModelLabels(workstation) {
  return (workstation.workstation_models || []).map((model) => model.model_label).filter(Boolean)
}

/**
 * Szuka stacji po ID w aktualnym stanie aplikacji.
 * @param {string} workstationId
 * @returns {Object|null}
 */
function findWorkstation(workstationId) {
  return state.workstations.find((workstation) => workstation.id === workstationId) || null
}

/**
 * Uzupełnia select stacji i modeli w wizardzie zadania.
 * @returns {void}
 */
function populateTaskWorkstationSelects() {
  const workstationSelect = document.getElementById('task-workstation')
  const modelSelect = document.getElementById('task-model')
  if (!workstationSelect || !modelSelect) return

  workstationSelect.innerHTML = [
    '<option value="">Automatycznie - AI wybierze stację</option>',
    groupedWorkstationOptionsHtml(state.workstations, true),
  ].join('')

  populateTaskModelSelect(workstationSelect.value)
}

function groupedWorkstationOptionsHtml(workstations, includeStatus = false) {
  return groupWorkstationsByRoom(workstations).map(([room, roomStations]) => `
    <optgroup label="${escapeHtml(room)}">
      ${roomStations.map((workstation) => {
        const name = workstationDisplayName(workstation)
        const suffix = includeStatus ? ` (${workstation.status || 'offline'})` : ''
        return `<option value="${workstation.id}">${escapeHtml(workstationGridLabel(workstation))} - ${escapeHtml(name + suffix)}</option>`
      }).join('')}
    </optgroup>
  `).join('')
}

/**
 * Uzupełnia select modeli dla wybranej stacji.
 * @param {string} workstationId
 * @returns {void}
 */
function populateTaskModelSelect(workstationId) {
  const modelSelect = document.getElementById('task-model')
  if (!modelSelect) return

  if (!workstationId) {
    modelSelect.innerHTML = '<option value="">Automatycznie</option>'
    modelSelect.disabled = true
    renderTaskWorkstationAdvancedInfo(null)
    return
  }

  const workstation = findWorkstation(workstationId)
  const models = workstation ? getWorkstationModelLabels(workstation) : []
  modelSelect.disabled = models.length === 0
  modelSelect.innerHTML = models.length
    ? models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')
    : '<option value="">Brak wykrytych modeli</option>'
  renderTaskWorkstationAdvancedInfo(workstation)
}

/**
 * Pokazuje skrót Advanced dla wybranej stacji w wizardzie zadania.
 * @param {Object|null} workstation
 * @returns {void}
 */
function renderTaskWorkstationAdvancedInfo(workstation) {
  const element = document.getElementById('task-workstation-advanced-info')
  if (!element) return
  if (!workstation) {
    element.classList.add('hidden')
    element.textContent = ''
    return
  }
  const active = workstationActiveJobs(workstation)
  const slots = workstationParallelSlots(workstation)
  const sd = workstationSdEnabled(workstation) ? 'włączone' : 'wyłączone'
  element.classList.remove('hidden')
  element.textContent = `Wybrana stacja: ${active}/${slots} zajętych miejsc pracy, kontekst ${workstationContextLabel(workstation)}, KV ${workstationKvCacheLabel(workstation)}, SD ${sd}. Te parametry zmienia się w widoku Stacje robocze albo lokalnie przez --config.`
}

/**
 * Pobiera wiadomości do/z stacji roboczej powiązane z zadaniem.
 * @param {string} taskId
 * @returns {Promise<Array>}
 */
async function getWorkstationMessagesForTask(taskId) {
  try {
    const { data, error } = await supabase
      .from('workstation_messages')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('[app.js] getWorkstationMessagesForTask failed:', error)
    return []
  }
}

/**
 * Wysyła wiadomość do stacji roboczej.
 * @param {Object} payload
 * @param {string} payload.workstationId
 * @param {string|null} payload.taskId
 * @param {string} payload.content
 * @returns {Promise<boolean>}
 */
async function sendWorkstationMessage({ workstationId, taskId, content }) {
  try {
    const { error } = await supabase
      .from('workstation_messages')
      .insert({
        workstation_id: workstationId,
        task_id: taskId || null,
        sender_kind: 'user',
        sender_label: state.user?.email || 'user',
        message_type: 'note',
        content,
      })
    if (error) throw error
    return true
  } catch (error) {
    console.error('[app.js] sendWorkstationMessage failed:', error)
    showToast('Nie udało się wysłać wiadomości do stacji.', TOAST_TYPE.ERROR)
    return false
  }
}

/**
 * Renderuje wiadomości do/z przypisanej stacji w Task Detail.
 * @param {Array} messages
 * @returns {void}
 */
function renderTaskWorkstationMessages(messages) {
  const list = document.getElementById('workstation-messages-list')
  if (!list) return
  state.currentTaskWorkstationMessages = messages
  if (!messages.length) {
    list.innerHTML = '<p class="text-slate-500 text-sm">Brak wiadomości do stacji roboczej</p>'
    renderTaskConsole()
    return
  }
  list.innerHTML = messages.map((message) => workstationMessageHtml(message)).join('')
  renderTaskConsole()
}

/**
 * Dopisuje pojedynczą wiadomość stacji na koniec listy.
 * @param {Object} message
 * @returns {void}
 */
function appendTaskWorkstationMessage(message) {
  const list = document.getElementById('workstation-messages-list')
  if (!list) return
  state.currentTaskWorkstationMessages = [...state.currentTaskWorkstationMessages, message]
  if (list.querySelector('p.text-slate-500')) list.innerHTML = ''
  list.insertAdjacentHTML('beforeend', workstationMessageHtml(message))
  renderTaskConsole()
}

/**
 * Generuje HTML wiadomości do/z stacji.
 * @param {Object} message
 * @returns {string}
 */
function workstationMessageHtml(message) {
  const isUser = message.sender_kind === 'user'
  const cls = isUser ? 'border-blue-300 bg-blue-50' : 'border-emerald-300 bg-emerald-50'
  return `
    <div class="border-l-4 ${cls} px-4 py-2 rounded-r-lg">
      <div class="text-xs text-slate-500 mb-1">
        <span class="font-semibold">${escapeHtml(message.sender_label || message.sender_kind || 'system')}</span>
        <span class="ml-2 uppercase">[${escapeHtml(message.message_type || 'note')}]</span>
      </div>
      <div class="text-sm text-slate-800">${escapeHtml(message.content || '')}</div>
    </div>
  `
}

function renderTaskConsole() {
  const list = document.getElementById('task-console-list')
  if (!list) return
  const events = [
    ...state.currentTaskAiMessages.map((message) => ({ ...message, source: 'ai' })),
    ...state.currentTaskWorkstationMessages.map((message) => ({ ...message, source: 'workstation' })),
  ].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
  if (!events.length) {
    list.innerHTML = '<p class="text-sm text-slate-500">Konsola jest pusta.</p>'
    return
  }
  list.innerHTML = events.map((event, index) => taskConsoleEventHtml(event, index)).join('')
}

function taskConsoleEventHtml(event, index) {
  const isStation = event.source === 'workstation'
  const actor = isStation ? event.sender_label || 'stacja' : event.from_agent || 'agent'
  const target = isStation ? resolveWorkstationName(event.workstation_id) : event.to_agent || 'agent'
  const type = isStation ? event.message_type || 'event' : event.type || 'event'
  const color = isStation ? 'border-emerald-300 bg-emerald-50' : 'border-blue-300 bg-blue-50'
  return `
    <div class="grid grid-cols-[84px_1fr] gap-3">
      <div class="pt-2 text-right font-mono text-xs text-slate-400">${String(index + 1).padStart(2, '0')}</div>
      <div class="border-l-4 ${color} rounded-r-lg px-4 py-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
          <span class="font-semibold text-slate-700">${escapeHtml(actor)}</span>
          <span>→</span>
          <span>${escapeHtml(target)}</span>
          <span class="uppercase">[${escapeHtml(type)}]</span>
          <span>${formatDate(event.created_at)}</span>
        </div>
        <pre class="whitespace-pre-wrap break-words text-sm text-slate-800 font-sans">${escapeHtml(event.content || '')}</pre>
      </div>
    </div>
  `
}

async function handleClearTaskLog() {
  if (!state.currentTaskId) return
  if (!confirm('Wyczyścić logi tego zadania? Usunięte zostaną wiadomości AI i wiadomości stacji przypięte do zadania.')) return
  try {
    const [aiResult, stationResult] = await Promise.all([
      supabase.from('messages').delete().eq('task_id', state.currentTaskId),
      supabase.from('workstation_messages').delete().eq('task_id', state.currentTaskId),
    ])
    if (aiResult.error) throw aiResult.error
    if (stationResult.error) throw stationResult.error
    state.currentTaskAiMessages = []
    state.currentTaskWorkstationMessages = []
    renderMessages([])
    renderTaskWorkstationMessages([])
    renderTaskConsole()
    await refreshMonitorLog()
    showToast('Log zadania wyczyszczony.', TOAST_TYPE.SUCCESS)
  } catch (error) {
    console.error('[app.js] handleClearTaskLog failed:', error)
    showToast('Nie udało się wyczyścić logów. Sprawdź polityki RLS dla delete.', TOAST_TYPE.ERROR)
  }
}

/**
 * Renderuje statystyki na kartach dashboardu.
 * @param {Array} tasks
 * @returns {void}
 */
function renderStats(tasks) {
  const counts = { pending: 0, in_progress: 0, done: 0 }
  for (const t of tasks) {
    if (t.status === STATUS.PENDING || t.status === STATUS.ANALYZING) counts.pending++
    else if (t.status === STATUS.IN_PROGRESS) counts.in_progress++
    else if (t.status === STATUS.DONE) counts.done++
  }
  setText('stat-pending', counts.pending)
  setText('stat-in-progress', counts.in_progress)
  setText('stat-done', counts.done)
  setText('stat-workstations', state.workstations.filter((workstation) => !isStaleWorkstation(workstation) && ['online', 'busy'].includes(workstation.status)).length)
}

/**
 * Renderuje tabelę zadań w podanym tbody.
 * @param {string} tbodyId
 * @param {Array} tasks
 * @returns {void}
 */
function renderTasksTable(tbodyId, tasks) {
  const tbody = document.getElementById(tbodyId)
  if (!tbody) {
    console.warn('[app.js] missing tasks table body:', tbodyId)
    return
  }
  if (!tasks.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-slate-500">Brak zadań</td></tr>'
    return
  }
  tbody.innerHTML = tasks.map((t) => `
    <tr class="hover:bg-slate-50 cursor-pointer task-row" data-task-id="${t.id}">
      <td class="px-6 py-3 font-mono text-xs text-slate-500">${escapeHtml(String(t.id).slice(0, 8))}</td>
      <td class="px-6 py-3 font-medium">${escapeHtml(t.title || '')}</td>
      <td class="px-6 py-3">${statusBadge(t.status)}</td>
      <td class="px-6 py-3">${escapeHtml(priorityLabel(t.priority))}</td>
      <td class="px-6 py-3 text-slate-500">${formatDate(t.created_at)}</td>
      <td class="px-6 py-3 text-right">
        <button class="task-delete text-red-600 hover:underline text-sm" data-id="${t.id}" aria-label="Usuń zadanie ${escapeHtml(t.title || '')}">Usuń</button>
      </td>
    </tr>
  `).join('')

  // Klik na wiersz → otwórz Task Detail
  tbody.querySelectorAll('.task-row').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('.task-delete')) return
      openTaskDetail(row.dataset.taskId)
    })
  })
  tbody.querySelectorAll('.task-delete').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      handleDeleteTask(button.dataset.id)
    })
  })
}

/**
 * Zwraca HTML kolorowego badge statusu.
 * @param {string} status
 * @returns {string}
 */
function statusBadge(status) {
  const styles = {
    pending:     'bg-slate-200 text-slate-700',
    analyzing:   'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-700',
    done:        'bg-emerald-100 text-emerald-700',
    failed:      'bg-red-100 text-red-700',
  }
  const cls = styles[status] || styles.pending
  const label = STATUS_LABELS[status] || status || ''
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}" title="${escapeHtml(status || '')}">${escapeHtml(label)}</span>`
}

/**
 * Zwraca czytelną etykietę priorytetu.
 * @param {string} priority
 * @returns {string}
 */
function priorityLabel(priority) {
  return PRIORITY_LABELS[priority] || priority || '—'
}

// ============================================================================
// TASK DETAIL — widok szczegółów + timeline + Realtime
// ============================================================================

/**
 * Otwiera widok szczegółów zadania, ładuje dane, podpina Realtime.
 * @param {string} taskId
 * @returns {Promise<void>}
 */
async function openTaskDetail(taskId) {
  state.currentTaskId = taskId
  state.currentTaskAiMessages = []
  state.currentTaskWorkstationMessages = []
  navigateTo(VIEW.TASK_DETAIL)
  cleanupTaskSubscriptions()

  const task = await getTaskById(taskId)
  if (!task) {
    showToast('Nie znaleziono zadania.', TOAST_TYPE.ERROR)
    return
  }
  renderTaskDetail(task)
  renderTimeline(task.status)

  const messages = await getMessagesForTask(taskId)
  state.currentTaskAiMessages = messages
  renderMessages(messages)

  const workstationMessages = await getWorkstationMessagesForTask(taskId)
  state.currentTaskWorkstationMessages = workstationMessages
  renderTaskWorkstationMessages(workstationMessages)
  renderTaskConsole()

  // Subskrybuj zmiany zadania (UPDATE) i nowe wiadomości (INSERT)
  state.detailSubscription = subscribeToTask(taskId, (updated) => {
    renderTaskDetail(updated)
    renderTimeline(updated.status)
  }, () => {
    showToast('To zadanie zostało usunięte.', TOAST_TYPE.INFO)
    cleanupTaskSubscriptions()
    state.currentTaskId = null
    navigateTo(VIEW.TASKS)
    refreshTasks()
  })
  state.messagesSubscription = subscribeToTaskMessages(taskId, (msg) => {
    appendMessage(msg)
  })
  state.taskWorkstationMessagesSubscription = subscribeToTaskWorkstationMessages(taskId, (message) => {
    appendTaskWorkstationMessage(message)
  })
}

/**
 * Wypełnia pola w sekcji Task Detail danymi rekordu.
 * @param {Object} task
 * @returns {void}
 */
function renderTaskDetail(task) {
  document.getElementById('detail-title').textContent = task.title || ''
  document.getElementById('detail-description').textContent = task.description || ''
  document.getElementById('detail-priority').textContent = priorityLabel(task.priority)
  document.getElementById('detail-repo').textContent = task.git_repo || '—'
  document.getElementById('detail-workstation').textContent = resolveWorkstationName(task.requested_workstation_id)
  document.getElementById('detail-model').textContent = task.requested_model_name || '—'
  document.getElementById('detail-created').textContent = formatDate(task.created_at)
  document.getElementById('detail-id').textContent = task.id
  setText('detail-log-path', `Zadania / ${task.title || 'bez tytułu'} / konsola / ${String(task.id).slice(0, 8)}`)
  document.getElementById('btn-delete-task-detail').dataset.taskId = task.id
  document.getElementById('btn-task-send-workstation-message').disabled = !task.requested_workstation_id
  document.getElementById('btn-task-send-workstation-message').dataset.workstationId = task.requested_workstation_id || ''
  const badge = document.getElementById('detail-status-badge')
  badge.outerHTML = `<span id="detail-status-badge">${statusBadge(task.status)}</span>`
}

/**
 * Rozwiązuje nazwę stacji roboczej na podstawie ID.
 * @param {string|null} workstationId
 * @returns {string}
 */
function resolveWorkstationName(workstationId) {
  if (!workstationId) return '—'
  const workstation = findWorkstation(workstationId)
  return workstation?.display_name || workstation?.hostname || workstationId
}

/**
 * Renderuje pionowy timeline 5 kroków z podświetleniem na podstawie statusu.
 * @param {string} status - Bieżący status zadania
 * @returns {void}
 */
function renderTimeline(status) {
  const ol = document.getElementById('timeline')
  const currentIdx = computeTimelineIndex(status)
  ol.innerHTML = TIMELINE_STEPS.map((step, idx) => {
    const isDone = idx < currentIdx
    const isCurrent = idx === currentIdx
    const dot = isDone
      ? '<span class="absolute -left-[11px] w-5 h-5 rounded-full bg-emerald-500 border-4 border-white"></span>'
      : isCurrent
        ? '<span class="absolute -left-[11px] w-5 h-5 rounded-full bg-blue-500 border-4 border-white timeline-current"></span>'
        : '<span class="absolute -left-[11px] w-5 h-5 rounded-full bg-slate-200 border-4 border-white"></span>'
    const textCls = isDone ? 'text-slate-900 font-medium' : isCurrent ? 'text-blue-700 font-semibold' : 'text-slate-400'
    return `<li class="pl-6 relative">${dot}<div class="${textCls}">${step.label}</div></li>`
  }).join('')
}

/**
 * Mapuje status zadania na indeks aktualnego kroku timelineʼu.
 * @param {string} status
 * @returns {number}
 */
function computeTimelineIndex(status) {
  switch (status) {
    case STATUS.PENDING:     return 0
    case STATUS.ANALYZING:   return 1
    case STATUS.IN_PROGRESS: return 3
    case STATUS.DONE:        return 5 // wszystkie ukończone
    case STATUS.FAILED:      return 4
    default:                 return 0
  }
}

/**
 * Renderuje listę wiadomości AI w widoku Task Detail.
 * @param {Array} messages
 * @returns {void}
 */
function renderMessages(messages) {
  const list = document.getElementById('messages-list')
  state.currentTaskAiMessages = messages
  if (!messages.length) {
    list.innerHTML = '<p class="text-slate-500 text-sm">Brak wiadomości</p>'
    renderTaskConsole()
    return
  }
  list.innerHTML = messages.map((m) => messageHtml(m)).join('')
  renderTaskConsole()
}

/**
 * Dopisuje pojedynczą wiadomość na koniec listy (live update).
 * @param {Object} msg
 * @returns {void}
 */
function appendMessage(msg) {
  const list = document.getElementById('messages-list')
  state.currentTaskAiMessages = [...state.currentTaskAiMessages, msg]
  if (list.querySelector('p.text-slate-500')) list.innerHTML = ''
  list.insertAdjacentHTML('beforeend', messageHtml(msg))
  renderTaskConsole()
}

/**
 * Generuje HTML pojedynczej wiadomości.
 * @param {Object} msg
 * @returns {string}
 */
function messageHtml(msg) {
  const typeColors = {
    question: 'border-yellow-300 bg-yellow-50',
    answer:   'border-blue-300 bg-blue-50',
    report:   'border-emerald-300 bg-emerald-50',
  }
  const cls = typeColors[msg.type] || 'border-slate-200 bg-slate-50'
  return `
    <div class="border-l-4 ${cls} px-4 py-2 rounded-r-lg">
      <div class="text-xs text-slate-500 mb-1">
        <span class="font-semibold">${escapeHtml(msg.from_agent)}</span> →
        <span>${escapeHtml(msg.to_agent)}</span>
        <span class="ml-2 uppercase">[${escapeHtml(msg.type)}]</span>
      </div>
      <div class="text-sm text-slate-800">${escapeHtml(msg.content || '')}</div>
    </div>
  `
}

// ============================================================================
// REALTIME — subskrypcje Supabase
// ============================================================================

/**
 * Subskrybuje zmiany pojedynczego zadania (UPDATE).
 * @param {string} taskId
 * @param {Function} callback - wywoływany z nowym rekordem
 * @param {Function} onDelete - wywoływany po usunięciu rekordu
 * @returns {Object} kanał Supabase
 */
function subscribeToTask(taskId, callback, onDelete) {
  return supabase
    .channel(`task-${taskId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tasks',
      filter: `id=eq.${taskId}`,
    }, (payload) => callback(payload.new))
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'tasks',
      filter: `id=eq.${taskId}`,
    }, () => onDelete())
    .subscribe()
}

/**
 * Subskrybuje nowe wiadomości dla zadania (INSERT na messages).
 * @param {string} taskId
 * @param {Function} callback
 * @returns {Object} kanał Supabase
 */
function subscribeToTaskMessages(taskId, callback) {
  return supabase
    .channel(`task-${taskId}-messages`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `task_id=eq.${taskId}`,
    }, (payload) => callback(payload.new))
    .subscribe()
}

/**
 * Subskrybuje nowe wiadomości do/z stacji dla wskazanego zadania.
 * @param {string} taskId
 * @param {Function} callback
 * @returns {Object}
 */
function subscribeToTaskWorkstationMessages(taskId, callback) {
  return supabase
    .channel(`task-${taskId}-workstation-messages`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'workstation_messages',
      filter: `task_id=eq.${taskId}`,
    }, (payload) => callback(payload.new))
    .subscribe()
}

/**
 * Subskrybuje wszystkie zmiany w `tasks` aby trzymać dashboard świeży.
 * @returns {void}
 */
function subscribeToAllTasks() {
  if (state.allTasksSubscription) return
  state.allTasksSubscription = supabase
    .channel('tasks-dashboard')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
      refreshTasks()
    })
    .subscribe((status) => updateConnectionIndicator(status))
}

/**
 * Subskrybuje zmiany w stacjach, modelach i jobach.
 * @returns {void}
 */
function subscribeToWorkstationsBoard() {
  if (state.workstationsSubscription) return
  state.workstationsSubscription = supabase
    .channel('workstations-board')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workstations' }, () => {
      refreshWorkstations()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workstation_models' }, () => {
      refreshWorkstations()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workstation_jobs' }, () => {
      refreshWorkstations()
    })
    .subscribe()
}

function subscribeToEnrollmentTokens() {
  if (state.enrollmentTokensSubscription) return
  state.enrollmentTokensSubscription = supabase
    .channel('workstation-enrollment-tokens')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'workstation_enrollment_tokens' }, () => {
      refreshEnrollmentTokens()
    })
    .subscribe()
}

/**
 * Subskrybuje zdarzenia logów monitora.
 * @returns {void}
 */
function subscribeToMonitorLog() {
  if (state.monitorLogSubscription) return
  state.monitorLogSubscription = supabase
    .channel('monitor-log')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
      refreshMonitorLog()
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'workstation_messages' }, () => {
      refreshMonitorLog()
    })
    .subscribe()
}

/**
 * Aktualizuje wskaźnik statusu połączenia Realtime w górnym pasku.
 * @param {string} status
 * @returns {void}
 */
function updateConnectionIndicator(status) {
  const dot = document.getElementById('connection-dot')
  const text = document.getElementById('connection-text')
  if (!dot || !text) return
  const ok = status === 'SUBSCRIBED'
  dot.classList.toggle('bg-emerald-500', ok)
  dot.classList.toggle('bg-red-500', !ok)
  text.textContent = ok ? 'Połączono' : 'Brak połączenia'
}

/**
 * Odpisuje subskrypcje Task Detail (przy wyjściu z widoku).
 * @returns {void}
 */
function cleanupTaskSubscriptions() {
  if (state.detailSubscription) {
    supabase.removeChannel(state.detailSubscription)
    state.detailSubscription = null
  }
  if (state.messagesSubscription) {
    supabase.removeChannel(state.messagesSubscription)
    state.messagesSubscription = null
  }
  if (state.taskWorkstationMessagesSubscription) {
    supabase.removeChannel(state.taskWorkstationMessagesSubscription)
    state.taskWorkstationMessagesSubscription = null
  }
}

/**
 * Odpisuje globalne subskrypcje Realtime.
 * @returns {void}
 */
function cleanupGlobalSubscriptions() {
  if (state.allTasksSubscription) {
    supabase.removeChannel(state.allTasksSubscription)
    state.allTasksSubscription = null
  }
  if (state.workstationsSubscription) {
    supabase.removeChannel(state.workstationsSubscription)
    state.workstationsSubscription = null
  }
  if (state.enrollmentTokensSubscription) {
    supabase.removeChannel(state.enrollmentTokensSubscription)
    state.enrollmentTokensSubscription = null
  }
  if (state.monitorLogSubscription) {
    supabase.removeChannel(state.monitorLogSubscription)
    state.monitorLogSubscription = null
  }
}

/**
 * Czyści stan sesji aplikacji po wylogowaniu lub utracie auth.
 * @returns {void}
 */
function cleanupAppSession() {
  cleanupTaskSubscriptions()
  cleanupGlobalSubscriptions()
  stopManager()
  stopExecutor()
  state.user = null
  state.currentTaskId = null
  state.currentTaskAiMessages = []
  state.currentTaskWorkstationMessages = []
  state.selectedMonitorWorkstationId = null
}

/**
 * Bezpiecznie ustawia textContent, jeśli element istnieje.
 * @param {string} id
 * @param {string|number} value
 * @returns {void}
 */
function setText(id, value) {
  const element = document.getElementById(id)
  if (!element) {
    console.warn('[app.js] missing element:', id)
    return
  }
  element.textContent = value
}

/**
 * Uzupełnia pola widoku Ustawienia aktualnymi preferencjami.
 * @returns {void}
 */
function renderSettingsForm() {
  const settings = getSettings()
  document.getElementById('settings-theme').value = settings.theme
  document.getElementById('settings-language').value = settings.language
  document.getElementById('settings-default-repo').value = settings.defaultRepo
  const select = document.getElementById('settings-default-workstation')
  if (select) {
    select.innerHTML = [
      '<option value="">Automatycznie - AI wybierze stację</option>',
      groupedWorkstationOptionsHtml(state.workstations),
    ].join('')
    select.value = settings.defaultWorkstation
  }
}

/**
 * Zapisuje preferencje UI w localStorage.
 * @returns {void}
 */
function handleSaveSettings() {
  saveSettings({
    theme: document.getElementById('settings-theme').value,
    language: document.getElementById('settings-language').value,
    defaultRepo: document.getElementById('settings-default-repo').value.trim(),
    defaultWorkstation: document.getElementById('settings-default-workstation').value,
  })
  renderSettingsForm()
  showToast('Ustawienia zapisane.', TOAST_TYPE.SUCCESS)
}

/**
 * Uzupełnia datalistę ostatnio używanymi repozytoriami.
 * @returns {void}
 */
function populateRepoSuggestions() {
  const datalist = document.getElementById('repo-suggestions')
  if (!datalist) return
  const settings = getSettings()
  const repos = [settings.defaultRepo, ...getRecentRepos()].filter(Boolean)
  datalist.innerHTML = [...new Set(repos)].map((repo) => `<option value="${escapeHtml(repo)}"></option>`).join('')
}

/**
 * Renderuje prostą instrukcję dla konfiguracji stacji.
 * @returns {void}
 */
function renderStationConfigInstruction() {
  const slots = document.getElementById('station-config-slots').value || '1'
  const context = document.getElementById('station-config-context').value || 'native'
  const kv = document.getElementById('station-config-kv').value || 'auto'
  const sd = document.getElementById('station-config-sd').value === 'true'
  const schedule = document.getElementById('station-config-schedule').value.trim()
  const autoUpdate = document.getElementById('station-config-update').value === 'true'
  const output = document.getElementById('station-config-output')
  const scheduleLine = schedule ? `Harmonogram: ${schedule}` : 'Harmonogram: wyłączony'
  output.textContent = [
    'Na komputerze stacji uruchom:',
    'Windows: start.bat --config',
    'macOS/Linux: ./start.sh --config',
    '',
    'Wybierz w konfiguratorze:',
    `Równoległe zadania: ${slots}`,
    `Kontekst modelu: ${context}`,
    `KV cache: ${kv}`,
    `SD: ${sd ? 'włączone' : 'wyłączone'}`,
    scheduleLine,
    `Auto-update: ${autoUpdate ? 'włączony' : 'wyłączony'}`,
    kv.startsWith('planar') || kv.startsWith('iso') || kv.startsWith('turbo')
      ? 'Uwaga: Planar/Iso/Turbo wymagają builda llama.cpp zgodnego z RotorQuant; stock llama.cpp spadnie do q8_0.'
      : 'q8_0 jest domyślnym wyborem dla stock llama.cpp i długiego kontekstu.',
    '',
    'Po zapisie zostaw okno launchera otwarte. Stacja pojawi się w tabeli po pierwszym heartbeat.',
  ].join('\n')
  output.classList.remove('hidden')
}

// ============================================================================
// MODAL: SUBMIT TASK (3-krokowy wizard)
// ============================================================================

const wizard = {
  step: 1,
  template: null,
}

/**
 * Otwiera modal Submit Task w pierwszym kroku.
 * @returns {void}
 */
function openTaskModal() {
  wizard.step = 1
  wizard.template = null
  document.getElementById('form-task').reset()
  document.getElementById('task-labyrinth-guide')?.classList.add('hidden')
  document.querySelectorAll('.template-card').forEach((card) => card.classList.remove('border-blue-500', 'bg-blue-50'))
  const settings = getSettings()
  document.getElementById('task-repo').value = settings.defaultRepo || ''
  populateRepoSuggestions()
  populateTaskWorkstationSelects()
  const workstationSelect = document.getElementById('task-workstation')
  if (settings.defaultWorkstation && findWorkstation(settings.defaultWorkstation)) {
    workstationSelect.value = settings.defaultWorkstation
    populateTaskModelSelect(settings.defaultWorkstation)
  }
  renderWizardStep()
  document.getElementById('modal-submit-task').classList.remove('hidden')
}

/**
 * Zamyka dowolny otwarty modal.
 * @returns {void}
 */
function closeAllModals() {
  document.getElementById('modal-submit-task').classList.add('hidden')
  document.getElementById('modal-agent').classList.add('hidden')
  document.getElementById('modal-workstation-message').classList.add('hidden')
  document.getElementById('modal-workstation-edit')?.classList.add('hidden')
  document.getElementById('modal-help').classList.add('hidden')
}

/**
 * Otwiera słownik pojęć i statusów.
 * @returns {void}
 */
function openHelpModal() {
  document.getElementById('modal-help').classList.remove('hidden')
}

/**
 * Renderuje aktualny krok wizardu (widoczność, paski, przyciski).
 * @returns {void}
 */
function renderWizardStep() {
  document.querySelectorAll('.wizard-step').forEach((el) => {
    el.classList.toggle('hidden', Number(el.dataset.step) !== wizard.step)
  })
  document.getElementById('wizard-progress').style.width = `${(wizard.step / 3) * 100}%`
  document.getElementById('wizard-back').classList.toggle('hidden', wizard.step === 1)
  document.getElementById('wizard-next').classList.toggle('hidden', wizard.step === 3)
  document.getElementById('wizard-submit').classList.toggle('hidden', wizard.step !== 3)
  document.getElementById('wizard-draft').classList.toggle('hidden', wizard.step !== 3)
  if (wizard.step === 3) renderReviewSummary()
}

/**
 * Wypełnia ekran podsumowania danymi z formularza.
 * @returns {void}
 */
function renderReviewSummary() {
  const data = collectTaskFormData()
  const summary = document.getElementById('review-summary')
  const contextRows = data.context
    ? [
      data.context.links ? `<div><span class="text-slate-500">Linki/pliki:</span> ${escapeHtml(data.context.links)}</div>` : '',
      data.context.requirements ? `<div><span class="text-slate-500">Wymagania:</span> ${escapeHtml(data.context.requirements)}</div>` : '',
      data.context.avoid ? `<div><span class="text-slate-500">Nie robić:</span> ${escapeHtml(data.context.avoid)}</div>` : '',
    ].filter(Boolean).join('')
    : ''
  const workflowSummary = summarizeHermesLabyrinthContext(data.context)
  summary.innerHTML = `
    <div><span class="text-slate-500">Szablon:</span> <strong>${escapeHtml(templateLabel(wizard.template))}</strong></div>
    <div><span class="text-slate-500">Polecenie:</span> <strong>${escapeHtml(data.title)}</strong></div>
    <div><span class="text-slate-500">Szczegóły:</span> ${escapeHtml(data.description)}</div>
    <div><span class="text-slate-500">Priorytet:</span> <strong>${escapeHtml(priorityLabel(data.priority))}</strong></div>
    <div><span class="text-slate-500">Repo:</span> ${escapeHtml(data.repo || '—')}</div>
    <div><span class="text-slate-500">Stacja:</span> ${escapeHtml(data.workstationId ? resolveWorkstationName(data.workstationId) : 'Automatycznie - AI wybierze stację')}</div>
    <div><span class="text-slate-500">Model:</span> ${escapeHtml(data.modelName || '—')}</div>
    ${workflowSummary ? `<div><span class="text-slate-500">Workflow:</span> ${escapeHtml(workflowSummary)}</div>` : ''}
    ${contextRows}
  `
}

/**
 * Zbiera dane z formularza zadania.
 * @returns {Object}
 */
function collectTaskFormData() {
  const context = {
    links: document.getElementById('task-links').value.trim(),
    requirements: document.getElementById('task-requirements').value.trim(),
    avoid: document.getElementById('task-avoid').value.trim(),
  }
  const hasContext = Object.values(context).some(Boolean)
  const finalContext = isHermesLabyrinthTemplate(wizard.template)
    ? buildHermesLabyrinthContext(context)
    : (hasContext ? context : null)
  return {
    title: document.getElementById('task-title').value.trim(),
    description: document.getElementById('task-description').value.trim(),
    priority: document.getElementById('task-priority').value,
    repo: document.getElementById('task-repo').value.trim(),
    context: finalContext,
    workstationId: document.getElementById('task-workstation').value,
    modelName: document.getElementById('task-model').value,
    template: wizard.template,
  }
}

/**
 * Waliduje wymagane pola w kroku 2.
 * @returns {boolean}
 */
function validateTaskForm() {
  const data = collectTaskFormData()
  if (!data.title || !data.description) {
    showToast('Wypełnij polecenie i szczegóły.', TOAST_TYPE.ERROR)
    return false
  }
  if (data.workstationId && !data.modelName) {
    showToast('Wybierz model dla wskazanej stacji.', TOAST_TYPE.ERROR)
    return false
  }
  return true
}

/**
 * Podpina obsługę wizardu i przycisków modala.
 * @returns {void}
 */
function bindTaskModal() {
  document.getElementById('btn-add-task').addEventListener('click', openTaskModal)
  document.getElementById('btn-add-task-2').addEventListener('click', openTaskModal)
  document.getElementById('btn-refresh-workstations').addEventListener('click', refreshWorkstations)
  document.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', closeAllModals))
  document.getElementById('task-workstation').addEventListener('change', (event) => {
    populateTaskModelSelect(event.target.value)
  })
  document.getElementById('btn-task-send-workstation-message').addEventListener('click', () => {
    const workstationId = document.getElementById('btn-task-send-workstation-message').dataset.workstationId || ''
    if (!workstationId) {
      showToast('To zadanie nie ma przypisanej stacji.', TOAST_TYPE.INFO)
      return
    }
    openWorkstationMessageModal(workstationId, state.currentTaskId)
  })
  document.getElementById('form-workstation-message').addEventListener('submit', async (event) => {
    event.preventDefault()
    const workstationId = document.getElementById('workstation-message-workstation-id').value
    const taskId = document.getElementById('workstation-message-task-id').value || null
    const content = document.getElementById('workstation-message-content').value.trim()
    if (!workstationId || !content) {
      showToast('Wybierz stację i wpisz wiadomość.', TOAST_TYPE.ERROR)
      return
    }
    const ok = await sendWorkstationMessage({ workstationId, taskId, content })
    if (!ok) return
    document.getElementById('workstation-message-content').value = ''
    closeAllModals()
    showToast('Wiadomość wysłana do stacji.', TOAST_TYPE.SUCCESS)
  })

  // Wybór szablonu w kroku 1
  document.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', () => {
      wizard.template = card.dataset.template
      document.querySelectorAll('.template-card').forEach((c) => c.classList.remove('border-blue-500', 'bg-blue-50'))
      card.classList.add('border-blue-500', 'bg-blue-50')
      applySelectedTemplatePreset()
      renderHermesLabyrinthAssist()
    })
  })

  document.getElementById('wizard-back').addEventListener('click', () => {
    if (wizard.step > 1) { wizard.step--; renderWizardStep() }
  })
  document.getElementById('wizard-next').addEventListener('click', () => {
    if (wizard.step === 1 && !wizard.template) {
      showToast('Wybierz szablon.', TOAST_TYPE.ERROR); return
    }
    if (wizard.step === 2 && !validateTaskForm()) return
    wizard.step++
    renderWizardStep()
  })
  document.getElementById('wizard-submit').addEventListener('click', submitTaskForm)
  document.getElementById('wizard-draft').addEventListener('click', () => {
    showToast('Szkic zapisany lokalnie (placeholder).', TOAST_TYPE.INFO)
    closeAllModals()
  })
}

/**
 * Zwraca czytelną nazwę szablonu.
 * @param {string|null} template
 * @returns {string}
 */
function templateLabel(template) {
  return TEMPLATE_LABELS[template] || template || 'Własne'
}

/**
 * Wypełnia pola formularza dla szablonów z presetem.
 * @returns {void}
 */
function applySelectedTemplatePreset() {
  if (!isHermesLabyrinthTemplate(wizard.template)) return
  setValueIfEmpty('task-title', HERMES_LABYRINTH_PRESET.title)
  setValueIfEmpty('task-description', HERMES_LABYRINTH_PRESET.description)
  setValueIfEmpty('task-requirements', HERMES_LABYRINTH_PRESET.requirements)
  setValueIfEmpty('task-avoid', HERMES_LABYRINTH_PRESET.avoid)
}

/**
 * Ustawia wartość pola tylko wtedy, gdy użytkownik nie wpisał własnej treści.
 * @param {string} id
 * @param {string} value
 * @returns {void}
 */
function setValueIfEmpty(id, value) {
  const element = document.getElementById(id)
  if (element && !element.value.trim()) element.value = value
}

/**
 * Pokazuje krótką mapę bram dla szablonu Hermes Labyrinth.
 * @returns {void}
 */
function renderHermesLabyrinthAssist() {
  const element = document.getElementById('task-labyrinth-guide')
  if (!element) return
  element.classList.toggle('hidden', !isHermesLabyrinthTemplate(wizard.template))
  if (!isHermesLabyrinthTemplate(wizard.template)) return
  element.innerHTML = HERMES_LABYRINTH_GATES.map((gate) => `
    <div class="rounded-lg border border-indigo-100 bg-white px-3 py-2">
      <div class="font-semibold text-indigo-900">${escapeHtml(gate.name)}</div>
      <div class="text-xs text-indigo-700 mt-1">${escapeHtml(gate.check)}</div>
    </div>
  `).join('')
}

/**
 * Wysyła zadanie do Supabase, zamyka modal i odświeża listę.
 * @returns {Promise<void>}
 */
async function submitTaskForm() {
  const data = collectTaskFormData()
  const created = await createTask(data)
  if (created) {
    rememberRepo(data.repo)
    showToast('Polecenie wysłane do AI.', TOAST_TYPE.SUCCESS)
    closeAllModals()
    await refreshTasks()
  }
}

/**
 * Otwiera modal wiadomości do stacji roboczej.
 * @param {string} workstationId
 * @param {string|null} taskId
 * @returns {void}
 */
function openWorkstationMessageModal(workstationId, taskId) {
  const workstation = findWorkstation(workstationId)
  document.getElementById('workstation-message-workstation-id').value = workstationId || ''
  document.getElementById('workstation-message-task-id').value = taskId || ''
  document.getElementById('workstation-message-target').textContent = workstation?.display_name || workstation?.hostname || 'Stacja robocza'
  document.getElementById('modal-workstation-message').classList.remove('hidden')
}

// ============================================================================
// CRUD: AGENTS
// ============================================================================

/**
 * Pobiera profile agentów.
 * @returns {Promise<Array>}
 */
async function getAgents() {
  try {
    const { data, error } = await supabase.from('agents').select('*').order('name')
    if (error) throw error
    return data || []
  } catch (error) {
    console.error('[app.js] getAgents failed:', error)
    return []
  }
}

/**
 * Tworzy nowy profil agenta.
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
async function createAgent(payload) {
  try {
    const { data, error } = await supabase.from('agents').insert(payload).select().single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('[app.js] createAgent failed:', error)
    showToast('Błąd zapisu profilu.', TOAST_TYPE.ERROR)
    return null
  }
}

/**
 * Aktualizuje istniejący profil agenta.
 * @param {string} id
 * @param {Object} payload
 * @returns {Promise<Object|null>}
 */
async function updateAgent(id, payload) {
  try {
    const { data, error } = await supabase.from('agents').update(payload).eq('id', id).select().single()
    if (error) throw error
    return data
  } catch (error) {
    console.error('[app.js] updateAgent failed:', error)
    showToast('Błąd aktualizacji profilu.', TOAST_TYPE.ERROR)
    return null
  }
}

/**
 * Usuwa profil agenta.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function deleteAgent(id) {
  try {
    const { error } = await supabase.from('agents').delete().eq('id', id)
    if (error) throw error
    return true
  } catch (error) {
    console.error('[app.js] deleteAgent failed:', error)
    showToast('Błąd usuwania profilu.', TOAST_TYPE.ERROR)
    return false
  }
}

/**
 * Odświeża listę profili agentów w widoku.
 * @returns {Promise<void>}
 */
async function refreshAgents() {
  const agents = await getAgents()
  renderAgentsTable(agents)
}

/**
 * Renderuje tabelę profili.
 * @param {Array} agents
 * @returns {void}
 */
function renderAgentsTable(agents) {
  const tbody = document.getElementById('agents-table-body')
  if (!agents.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-500">Brak profili agentów. Dodaj profil, aby pojawił się w tym widoku.</td></tr>'
    return
  }
  tbody.innerHTML = agents.map((a) => `
    <tr class="hover:bg-slate-50">
      <td class="px-6 py-3 font-medium">${escapeHtml(a.name || '')}</td>
      <td class="px-6 py-3">${agentRoleBadge(a.role)}</td>
      <td class="px-6 py-3">${(a.skills || []).map(s => `<span class="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs mr-1">${escapeHtml(s)}</span>`).join('')}</td>
      <td class="px-6 py-3">${a.concurrency_limit ?? 1} równocześnie</td>
      <td class="px-6 py-3 space-x-2">
        <button class="agent-edit text-blue-600 hover:underline text-sm" data-id="${a.id}">Edytuj</button>
        <button class="agent-delete text-red-600 hover:underline text-sm" data-id="${a.id}">Usuń</button>
      </td>
    </tr>
  `).join('')

  tbody.querySelectorAll('.agent-edit').forEach((b) => b.addEventListener('click', () => openAgentModal(agents.find(x => x.id === b.dataset.id))))
  tbody.querySelectorAll('.agent-delete').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Usunąć profil agenta?')) return
    const ok = await deleteAgent(b.dataset.id)
    if (ok) { showToast('Profil usunięty.', TOAST_TYPE.SUCCESS); refreshAgents() }
  }))
}

/**
 * Zwraca badge roli profilu agenta.
 * @param {string} role
 * @returns {string}
 */
function agentRoleBadge(role) {
  const styles = {
    manager: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    executor: 'bg-blue-100 text-blue-700 border-blue-200',
    specialist: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  }
  const labels = {
    manager: 'Manager',
    executor: 'Executor',
    specialist: 'Specialist',
  }
  const cls = styles[role] || 'bg-slate-100 text-slate-700 border-slate-200'
  const label = labels[role] || role || '—'
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}">${escapeHtml(label)}</span>`
}

/**
 * Otwiera modal profilu — pusty (nowy) lub wypełniony (edycja).
 * @param {Object|null} agent
 * @returns {void}
 */
function openAgentModal(agent = null) {
  state.editingAgentId = agent?.id || null
  state.agentSkills = agent?.skills ? [...agent.skills] : []
  document.getElementById('modal-agent-title').textContent = agent ? 'Edytuj profil' : 'Nowy profil'
  document.getElementById('agent-id').value = agent?.id || ''
  document.getElementById('agent-name').value = agent?.name || ''
  document.getElementById('agent-role').value = agent?.role || 'executor'
  document.getElementById('agent-concurrency').value = agent?.concurrency_limit ?? 1
  renderSkillsTags()
  document.getElementById('modal-agent').classList.remove('hidden')
}

/**
 * Renderuje aktualne tagi umiejętności w polu input-tags.
 * @returns {void}
 */
function renderSkillsTags() {
  const container = document.getElementById('skills-tags')
  // Usuń wszystkie tagi (zachowaj input)
  container.querySelectorAll('.skill-tag').forEach((el) => el.remove())
  const input = document.getElementById('skill-input')
  state.agentSkills.forEach((skill, idx) => {
    const tag = document.createElement('span')
    tag.className = 'skill-tag inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs'
    tag.innerHTML = `${escapeHtml(skill)} <button type="button" data-idx="${idx}" class="skill-remove text-blue-700 hover:text-red-600 font-bold">×</button>`
    container.insertBefore(tag, input)
  })
  container.querySelectorAll('.skill-remove').forEach((b) => b.addEventListener('click', () => {
    state.agentSkills.splice(Number(b.dataset.idx), 1)
    renderSkillsTags()
  }))
}

/**
 * Podpina handlery modalu agenta.
 * @returns {void}
 */
function bindAgentModal() {
  document.getElementById('btn-add-agent').addEventListener('click', () => openAgentModal(null))

  // Dodawanie tagów na Enter
  document.getElementById('skill-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const value = e.target.value.trim()
      if (value && !state.agentSkills.includes(value)) {
        state.agentSkills.push(value)
        renderSkillsTags()
      }
      e.target.value = ''
    }
  })

  document.getElementById('form-agent').addEventListener('submit', async (e) => {
    e.preventDefault()
    const payload = {
      name: document.getElementById('agent-name').value.trim(),
      role: document.getElementById('agent-role').value,
      skills: state.agentSkills,
      concurrency_limit: Number(document.getElementById('agent-concurrency').value) || 1,
    }
    const result = state.editingAgentId
      ? await updateAgent(state.editingAgentId, payload)
      : await createAgent(payload)
    if (result) {
      showToast('Profil zapisany.', TOAST_TYPE.SUCCESS)
      closeAllModals()
      refreshAgents()
    }
  })
}

// ============================================================================
// HELPERY
// ============================================================================

/**
 * Bezpieczne escapowanie HTML.
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

/**
 * Formatuje timestamp ISO do czytelnego formatu.
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

// ============================================================================
// BOOTSTRAP — uruchomienie aplikacji po załadowaniu DOM
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  bindNavigation()
  bindTaskModal()
  bindAgentModal()
  initAuth()
})

// Export pomocnicze (gdyby ktoś chciał testować z konsoli)
export { supabase, STATUS, AGENT }
