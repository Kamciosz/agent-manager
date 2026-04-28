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
import { initManager } from './manager.js'
import { initExecutor } from './executor.js'
import { initAiClient } from './ai-client.js'

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
  agentSkills: [],
  editingAgentId: null,
  detailSubscription: null,
  messagesSubscription: null,
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
      state.user = null
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
  state.user = user
  document.getElementById('auth-screen').classList.add('hidden')
  document.getElementById('app-screen').classList.remove('hidden')
  document.getElementById('user-email').textContent = user.email

  // Krok 1: załaduj dane do widoków
  await Promise.all([refreshTasks(), refreshAgents()])

  // Krok 2: subskrybuj globalne zmiany w `tasks` aby odświeżać dashboard
  subscribeToAllTasks()

  // Krok 3: sprawdź dostępność lokalnego AI proxy (badge w headerze)
  initAiClient()

  // Krok 4: uruchom AI kierownika i agenta wykonawczego
  // (używają ai-client gdy proxy dostępne, fallback symulacja gdy nie)
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
  state.currentView = viewName
  document.querySelectorAll('.view-section').forEach((el) => el.classList.add('hidden'))
  document.getElementById(`view-${viewName}`).classList.remove('hidden')

  // Aktualizuj tytuł strony i podświetlenie linków sidebar
  const titles = {
    dashboard: 'Dashboard',
    tasks: 'Zadania',
    'task-detail': 'Szczegóły zadania',
    agents: 'Profile agentów',
  }
  document.getElementById('page-title').textContent = titles[viewName] || ''

  document.querySelectorAll('.nav-link').forEach((link) => {
    const isActive = link.dataset.view === viewName
    link.classList.toggle('bg-blue-50', isActive)
    link.classList.toggle('text-blue-700', isActive)
    link.classList.toggle('text-slate-600', !isActive)
  })
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
  document.getElementById('btn-back-to-tasks').addEventListener('click', () => {
    cleanupTaskSubscriptions()
    navigateTo(VIEW.TASKS)
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
async function createTask({ title, description, priority, repo, context, template }) {
  try {
    const row = {
      title,
      description,
      priority,
      status: STATUS.PENDING,
      repo: repo || null,
      context: { template: template || null, raw: context || null },
      requester_id: state.user?.id || null,
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
  renderTasksTable('tasks-table-body', tasks.slice(0, 10))
  renderTasksTable('tasks-table-body-full', tasks)
  renderStats(tasks)
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
  document.getElementById('stat-pending').textContent = counts.pending
  document.getElementById('stat-in-progress').textContent = counts.in_progress
  document.getElementById('stat-done').textContent = counts.done
}

/**
 * Renderuje tabelę zadań w podanym tbody.
 * @param {string} tbodyId
 * @param {Array} tasks
 * @returns {void}
 */
function renderTasksTable(tbodyId, tasks) {
  const tbody = document.getElementById(tbodyId)
  if (!tasks.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-500">Brak zadań</td></tr>'
    return
  }
  tbody.innerHTML = tasks.map((t) => `
    <tr class="hover:bg-slate-50 cursor-pointer task-row" data-task-id="${t.id}">
      <td class="px-6 py-3 font-mono text-xs text-slate-500">${escapeHtml(String(t.id).slice(0, 8))}</td>
      <td class="px-6 py-3 font-medium">${escapeHtml(t.title || '')}</td>
      <td class="px-6 py-3">${statusBadge(t.status)}</td>
      <td class="px-6 py-3">${escapeHtml(t.priority || '')}</td>
      <td class="px-6 py-3 text-slate-500">${formatDate(t.created_at)}</td>
    </tr>
  `).join('')

  // Klik na wiersz → otwórz Task Detail
  tbody.querySelectorAll('.task-row').forEach((row) => {
    row.addEventListener('click', () => openTaskDetail(row.dataset.taskId))
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
  return `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${cls}">${escapeHtml(status || '')}</span>`
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
  renderMessages(messages)

  // Subskrybuj zmiany zadania (UPDATE) i nowe wiadomości (INSERT)
  state.detailSubscription = subscribeToTask(taskId, (updated) => {
    renderTaskDetail(updated)
    renderTimeline(updated.status)
  })
  state.messagesSubscription = subscribeToTaskMessages(taskId, (msg) => {
    appendMessage(msg)
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
  document.getElementById('detail-priority').textContent = task.priority || '—'
  document.getElementById('detail-repo').textContent = task.repo || '—'
  document.getElementById('detail-created').textContent = formatDate(task.created_at)
  document.getElementById('detail-id').textContent = task.id
  const badge = document.getElementById('detail-status-badge')
  badge.outerHTML = `<span id="detail-status-badge">${statusBadge(task.status)}</span>`
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
  if (!messages.length) {
    list.innerHTML = '<p class="text-slate-500 text-sm">Brak wiadomości</p>'
    return
  }
  list.innerHTML = messages.map((m) => messageHtml(m)).join('')
}

/**
 * Dopisuje pojedynczą wiadomość na koniec listy (live update).
 * @param {Object} msg
 * @returns {void}
 */
function appendMessage(msg) {
  const list = document.getElementById('messages-list')
  if (list.querySelector('p.text-slate-500')) list.innerHTML = ''
  list.insertAdjacentHTML('beforeend', messageHtml(msg))
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
 * @returns {Object} kanał Supabase
 */
function subscribeToTask(taskId, callback) {
  return supabase
    .channel(`task-${taskId}`)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tasks',
      filter: `id=eq.${taskId}`,
    }, (payload) => callback(payload.new))
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
 * Subskrybuje wszystkie zmiany w `tasks` aby trzymać dashboard świeży.
 * @returns {void}
 */
function subscribeToAllTasks() {
  supabase
    .channel('tasks-dashboard')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
      refreshTasks()
    })
    .subscribe((status) => updateConnectionIndicator(status))
}

/**
 * Aktualizuje wskaźnik statusu połączenia Realtime w górnym pasku.
 * @param {string} status
 * @returns {void}
 */
function updateConnectionIndicator(status) {
  const dot = document.getElementById('connection-dot')
  const text = document.getElementById('connection-text')
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
  summary.innerHTML = `
    <div><span class="text-slate-500">Szablon:</span> <strong>${escapeHtml(wizard.template || 'custom')}</strong></div>
    <div><span class="text-slate-500">Tytuł:</span> <strong>${escapeHtml(data.title)}</strong></div>
    <div><span class="text-slate-500">Opis:</span> ${escapeHtml(data.description)}</div>
    <div><span class="text-slate-500">Priorytet:</span> <strong>${escapeHtml(data.priority)}</strong></div>
    <div><span class="text-slate-500">Repo:</span> ${escapeHtml(data.repo || '—')}</div>
    ${data.context ? `<div><span class="text-slate-500">Kontekst:</span> <code class="text-xs">${escapeHtml(data.context)}</code></div>` : ''}
  `
}

/**
 * Zbiera dane z formularza zadania.
 * @returns {Object}
 */
function collectTaskFormData() {
  return {
    title: document.getElementById('task-title').value.trim(),
    description: document.getElementById('task-description').value.trim(),
    priority: document.getElementById('task-priority').value,
    repo: document.getElementById('task-repo').value.trim(),
    context: document.getElementById('task-context').value.trim(),
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
    showToast('Wypełnij tytuł i opis.', TOAST_TYPE.ERROR)
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
  document.querySelectorAll('.modal-close').forEach((b) => b.addEventListener('click', closeAllModals))

  // Wybór szablonu w kroku 1
  document.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', () => {
      wizard.template = card.dataset.template
      document.querySelectorAll('.template-card').forEach((c) => c.classList.remove('border-blue-500', 'bg-blue-50'))
      card.classList.add('border-blue-500', 'bg-blue-50')
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
 * Wysyła zadanie do Supabase, zamyka modal i odświeża listę.
 * @returns {Promise<void>}
 */
async function submitTaskForm() {
  const data = collectTaskFormData()
  const created = await createTask(data)
  if (created) {
    showToast('Zadanie wysłane!', TOAST_TYPE.SUCCESS)
    closeAllModals()
    await refreshTasks()
  }
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
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-slate-500">Brak profili</td></tr>'
    return
  }
  tbody.innerHTML = agents.map((a) => `
    <tr class="hover:bg-slate-50">
      <td class="px-6 py-3 font-medium">${escapeHtml(a.name || '')}</td>
      <td class="px-6 py-3">${escapeHtml(a.role || '')}</td>
      <td class="px-6 py-3">${(a.skills || []).map(s => `<span class="inline-block bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs mr-1">${escapeHtml(s)}</span>`).join('')}</td>
      <td class="px-6 py-3">${a.concurrency_limit ?? 1}</td>
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
