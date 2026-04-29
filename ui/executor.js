/**
 * @file executor.js
 * @description Logika agenta wykonawczego (`executor-1`) — subskrybuje nowe
 *              przydziały z tabeli `assignments`, wykonuje je (symulacja),
 *              wysyła pytanie do AI kierownika, czeka na odpowiedź, a po jej
 *              otrzymaniu kończy zadanie i wysyła raport.
 *
 *              Działa w przeglądarce, bez zewnętrznego API. Pełny przepływ
 *              (od assignment do done + raport) trwa łącznie ok. 6 sekund.
 *
 *              Jeśli lokalne proxy AI (ui/ai-client.js) jest dostępne,
 *              treść pytań i raportów generuje prawdziwy model llama.cpp.
 *              W przeciwnym razie używane są fallbacki przeglądarkowe.
 */

import { isAvailable, generate } from './ai-client.js'
import { buildHermesLabyrinthPromptBlock } from './labyrinth.js'

// ============================================================================
// STAŁE
// ============================================================================

const STATUS = {
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
  FAILED: 'failed',
}

const ASSIGNMENT_STATUS = {
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
}

const AGENT = {
  EXECUTOR_1: 'executor-1',
  MANAGER: 'manager',
}

const MESSAGE_TYPE = {
  QUESTION: 'question',
  ANSWER: 'answer',
  REPORT: 'report',
}

const DELAY = {
  START: 500,    // moment startu pracy po przydziale
  WORK: 2000,    // czas „pracy" zanim wyślemy pytanie do managera
  FINISH: 2000,  // czas pracy po odebraniu odpowiedzi managera
}

// ============================================================================
// STAN MODUŁU
// ============================================================================

let supabaseClient = null
let initialized = false
let assignmentsSubscription = null
let answersSubscription = null

// Mapuje task_id → callback do wywołania gdy odpowiedź managera dotrze.
// Pozwala kontynuować przepływ asynchronicznie po otrzymaniu wiadomości.
const pendingAnswers = new Map()

// Cache tytułów/opisów zadań — unikamy wielokrotnych zapytań do Supabase.
const taskCache = new Map()

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Inicjalizuje moduł agenta wykonawczego: podpina subskrypcje Realtime na
 * tabelach `assignments` (nowe przydziały dla executor-1) i `messages`
 * (odpowiedzi od managera). Idempotentne.
 * @param {Object} supabase - Klient Supabase
 * @returns {void}
 */
export function initExecutor(supabase) {
  if (initialized) return
  initialized = true
  supabaseClient = supabase

  assignmentsSubscription = subscribeToNewAssignments()
  answersSubscription = subscribeToManagerAnswers()

  console.log('[executor.js] Agent wykonawczy', AGENT.EXECUTOR_1, 'uruchomiony.')
}

/**
 * Zatrzymuje subskrypcje executora po wylogowaniu.
 * @returns {void}
 */
export function stopExecutor() {
  if (!supabaseClient) return
  if (assignmentsSubscription) supabaseClient.removeChannel(assignmentsSubscription)
  if (answersSubscription) supabaseClient.removeChannel(answersSubscription)
  assignmentsSubscription = null
  answersSubscription = null
  pendingAnswers.clear()
  taskCache.clear()
  initialized = false
}

// ============================================================================
// SUBSKRYPCJE REALTIME
// ============================================================================

/**
 * Subskrybuje INSERT na tabeli `assignments` filtrowane po agent_id.
 * @returns {void}
 */
function subscribeToNewAssignments() {
  return supabaseClient
    .channel('executor-assignments')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'assignments',
      filter: `agent_id=eq.${AGENT.EXECUTOR_1}`,
    }, (payload) => {
      handleNewAssignment(payload.new)
    })
    .subscribe()
}

/**
 * Subskrybuje INSERT na tabeli `messages` aby odbierać odpowiedzi managera.
 * @returns {void}
 */
function subscribeToManagerAnswers() {
  return supabaseClient
    .channel('executor-answers')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `to_agent=eq.${AGENT.EXECUTOR_1}`,
    }, (payload) => {
      handleIncomingAnswer(payload.new)
    })
    .subscribe()
}

// ============================================================================
// HANDLERY
// ============================================================================

/**
 * Pełny przepływ wykonania przydziału:
 * 1) status assigned → in_progress
 * 2) krótka „praca" → wyślij pytanie do managera
 * 3) (czekaj na odpowiedź) → kolejny etap pracy
 * 4) status assignment → done, status zadania → done, wyślij raport.
 * @param {Object} assignment - Rekord z tabeli assignments
 * @returns {Promise<void>}
 */
async function handleNewAssignment(assignment) {
  if (assignment.status !== ASSIGNMENT_STATUS.ASSIGNED) return

  console.log('[executor.js] Nowy przydział:', assignment.id, '→ task', assignment.task_id)

  try {
    // Krok 0: doczytaj dane zadania (tytuł/opis) — potrzebne do promptów AI
    await loadTaskInfo(assignment.task_id)

    // Krok 1: oznacz przydział jako rozpoczęty
    await sleep(DELAY.START)
    await updateAssignmentStatus(assignment.id, ASSIGNMENT_STATUS.IN_PROGRESS)

    // Krok 2: po pierwszej fazie pracy — zapytaj managera o wyjaśnienie
    await sleep(DELAY.WORK)
    await askManager(assignment.task_id)

    // Krok 3: czekaj asynchronicznie na odpowiedź managera, potem dokończ
    waitForAnswer(assignment.task_id, async () => {
      await finishAssignment(assignment)
    })
  } catch (error) {
    console.error('[executor.js] handleNewAssignment failed:', error)
    await updateAssignmentStatus(assignment.id, STATUS.FAILED).catch(() => {})
  }
}

/**
 * Reaguje na odpowiedź managera — wywołuje zarejestrowany callback dla danego
 * task_id, jeśli istnieje.
 * @param {Object} message - Rekord wiadomości
 * @returns {void}
 */
function handleIncomingAnswer(message) {
  if (message.type !== MESSAGE_TYPE.ANSWER) return
  const cb = pendingAnswers.get(message.task_id)
  if (!cb) return
  pendingAnswers.delete(message.task_id)
  console.log('[executor.js] Manager odpowiedział na task', message.task_id, ':', message.content)
  cb()
}

/**
 * Rejestruje callback do wywołania po otrzymaniu odpowiedzi managera.
 * @param {string} taskId
 * @param {Function} callback
 * @returns {void}
 */
function waitForAnswer(taskId, callback) {
  pendingAnswers.set(taskId, callback)
}

/**
 * Domyka pracę: aktualizuje przydział i zadanie do done, wysyła raport.
 * @param {Object} assignment
 * @returns {Promise<void>}
 */
async function finishAssignment(assignment) {
  try {
    // Krok 1: jeszcze chwila „pracy"
    await sleep(DELAY.FINISH)

    // Krok 2: oznacz przydział jako ukończony
    await updateAssignmentStatus(assignment.id, ASSIGNMENT_STATUS.DONE)

    // Krok 3: oznacz zadanie jako ukończone
    await updateTaskStatus(assignment.task_id, STATUS.DONE)

    // Krok 4: wyślij raport do managera
    await sendReport(assignment.task_id)
  } catch (error) {
    console.error('[executor.js] finishAssignment failed:', error)
  }
}

// ============================================================================
// OPERACJE NA BAZIE
// ============================================================================

/**
 * Aktualizuje status przydziału.
 * @param {string} assignmentId
 * @param {string} newStatus
 * @returns {Promise<void>}
 */
async function updateAssignmentStatus(assignmentId, newStatus) {
  try {
    const { error } = await supabaseClient
      .from('assignments')
      .update({ status: newStatus })
      .eq('id', assignmentId)
    if (error) throw error
  } catch (error) {
    console.error('[executor.js] updateAssignmentStatus failed:', error)
  }
}

/**
 * Aktualizuje status zadania.
 * @param {string} taskId
 * @param {string} newStatus
 * @returns {Promise<void>}
 */
async function updateTaskStatus(taskId, newStatus) {
  try {
    const { error } = await supabaseClient
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId)
    if (error) throw error
  } catch (error) {
    console.error('[executor.js] updateTaskStatus failed:', error)
  }
}

/**
 * Wysyła pytanie do managera (typ `question`).
 * @param {string} taskId
 * @returns {Promise<void>}
 */
async function askManager(taskId) {
  const content = await generateQuestion(taskId)
  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert({
        from_agent: AGENT.EXECUTOR_1,
        to_agent: AGENT.MANAGER,
        type: MESSAGE_TYPE.QUESTION,
        content,
        task_id: taskId,
      })
    if (error) throw error
  } catch (error) {
    console.error('[executor.js] askManager failed:', error)
  }
}

/**
 * Wysyła raport końcowy do managera (typ `report`).
 * @param {string} taskId
 * @returns {Promise<void>}
 */
async function sendReport(taskId) {
  const content = await generateReport(taskId)
  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert({
        from_agent: AGENT.EXECUTOR_1,
        to_agent: AGENT.MANAGER,
        type: MESSAGE_TYPE.REPORT,
        content,
        task_id: taskId,
      })
    if (error) throw error
  } catch (error) {
    console.error('[executor.js] sendReport failed:', error)
  }
}

/**
 * Doczytuje tytuł/opis zadania z tabeli `tasks` i cache'uje wynik.
 * @param {string} taskId
 * @returns {Promise<void>}
 */
async function loadTaskInfo(taskId) {
  if (taskCache.has(taskId)) return
  try {
    const { data, error } = await supabaseClient
      .from('tasks')
      .select('title,description,context')
      .eq('id', taskId)
      .single()
    if (error) throw error
    taskCache.set(taskId, data || { title: '', description: '' })
  } catch (error) {
    console.warn('[executor.js] loadTaskInfo failed:', error.message)
    taskCache.set(taskId, { title: '', description: '', context: null })
  }
}

/**
 * Generuje treść pytania executora do managera — przez AI lub fallback.
 * @param {string} taskId
 * @returns {Promise<string>}
 */
async function generateQuestion(taskId) {
  const fallback = 'Czy mam wykonać pełną weryfikację?'
  if (!isAvailable()) return fallback
  const info = taskCache.get(taskId) || { title: '', description: '' }
  try {
    const labyrinthBlock = buildHermesLabyrinthPromptBlock(info)
    const prompt = [
      'Jesteś agentem wykonawczym. Sformułuj po polsku JEDNO krótkie pytanie',
      'do AI kierownika (max 15 słów) o doprecyzowanie zadania.',
      labyrinthBlock,
      'Tytuł zadania: ' + info.title,
      'Opis: ' + info.description,
      'Odpowiedz wyłącznie tekstem pytania, bez wstępu.',
    ].filter(Boolean).join('\n')
    const text = await generate(prompt, { maxTokens: 60, temperature: 0.6 })
    return text || fallback
  } catch (error) {
    console.warn('[executor.js] AI fallback (question):', error.message)
    return fallback
  }
}

/**
 * Generuje raport końcowy executora — przez AI lub fallback.
 * @param {string} taskId
 * @returns {Promise<string>}
 */
async function generateReport(taskId) {
  const fallback = 'Zadanie ukończone pomyślnie.'
  if (!isAvailable()) return fallback
  const info = taskCache.get(taskId) || { title: '', description: '' }
  try {
    const labyrinthBlock = buildHermesLabyrinthPromptBlock(info)
    const prompt = [
      'Jesteś agentem wykonawczym. Napisz po polsku krótki (1-2 zdania) raport',
      'końcowy z wykonania zadania. Zacznij od czasownika dokonanego.',
      labyrinthBlock,
      'Tytuł zadania: ' + info.title,
      'Jeśli aktywny jest workflow Labyrinth, uwzględnij wynik weryfikacji.',
      'Odpowiedz wyłącznie tekstem raportu, bez wstępu.',
    ].filter(Boolean).join('\n')
    const text = await generate(prompt, { maxTokens: 100, temperature: 0.5 })
    return text || fallback
  } catch (error) {
    console.warn('[executor.js] AI fallback (report):', error.message)
    return fallback
  }
}

// ============================================================================
// HELPERY
// ============================================================================

/**
 * Promise opakowujący setTimeout.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
