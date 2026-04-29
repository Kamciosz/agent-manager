/**
 * @file manager.js
 * @description Logika AI kierownika — subskrybuje nowe zadania w tabeli `tasks`,
 *              analizuje je i przydziela agentowi wykonawczemu poprzez tabelę
 *              `assignments`. Odpowiada również na pytania agenta wykonawczego
 *              przez tabelę `messages`.
 *
 *              Działa w przeglądarce, bez zewnętrznego API. Symulacja oparta na
 *              regułach z opóźnieniami (800 ms / 1200 ms / 500 ms) zgodnie ze
 *              specyfikacją MVP w todo.md.
 *
 *              Jeśli lokalne proxy AI (ui/ai-client.js) jest dostępne,
 *              kluczowe teksty (instrukcje, odpowiedzi) generuje prawdziwy
 *              model llama.cpp. Gdy proxy nieosiągalne — używane są fallbacki.
 */

import { isAvailable, generate } from './ai-client.js'
import {
  buildHermesLabyrinthInstructions,
  buildHermesLabyrinthPromptBlock,
  isHermesLabyrinthTask,
} from './labyrinth.js'

// ============================================================================
// STAŁE — żadnych magic strings
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

const ASSIGNMENT_STATUS = {
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
}

const MESSAGE_TYPE = {
  QUESTION: 'question',
  ANSWER: 'answer',
  REPORT: 'report',
}

const WORKSTATION_STATUS = {
  ONLINE: 'online',
  BUSY: 'busy',
}

const DELAY = {
  ANALYZE: 800,       // czas „analizy" zadania zanim status zmieni się na analyzing
  ASSIGN: 1200,       // czas tworzenia przydziału (po analyzing)
  ANSWER: 500,        // opóźnienie odpowiedzi managera na pytanie executora
}

const WORKSTATION_STALE_MS = 2 * 60 * 1000

// ============================================================================
// STAN MODUŁU
// ============================================================================

let supabaseClient = null
let initialized = false
let tasksSubscription = null
let messagesSubscription = null

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Inicjalizuje moduł AI kierownika: podpina subskrypcje Realtime na tabelach
 * `tasks` (nowe zadania) i `messages` (pytania do managera). Idempotentne —
 * wielokrotne wywołanie nie zduplikuje subskrypcji.
 * @param {Object} supabase - Klient Supabase (createClient)
 * @returns {void}
 */
export function initManager(supabase) {
  if (initialized) return
  initialized = true
  supabaseClient = supabase

  tasksSubscription = subscribeToNewTasks()
  messagesSubscription = subscribeToManagerMessages()

  console.log('[manager.js] AI kierownik uruchomiony.')
}

/**
 * Zatrzymuje subskrypcje managera po wylogowaniu.
 * @returns {void}
 */
export function stopManager() {
  if (!supabaseClient) return
  if (tasksSubscription) supabaseClient.removeChannel(tasksSubscription)
  if (messagesSubscription) supabaseClient.removeChannel(messagesSubscription)
  tasksSubscription = null
  messagesSubscription = null
  initialized = false
}

// ============================================================================
// SUBSKRYPCJE REALTIME
// ============================================================================

/**
 * Subskrybuje INSERT na tabeli `tasks` aby reagować na nowe zadania.
 * @returns {void}
 */
function subscribeToNewTasks() {
  return supabaseClient
    .channel('manager-tasks')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'tasks',
    }, (payload) => {
      handleNewTask(payload.new)
    })
    .subscribe()
}

/**
 * Subskrybuje INSERT na tabeli `messages` gdzie odbiorcą jest manager.
 * @returns {void}
 */
function subscribeToManagerMessages() {
  return supabaseClient
    .channel('manager-messages')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `to_agent=eq.${AGENT.MANAGER}`,
    }, (payload) => {
      handleManagerMessage(payload.new)
    })
    .subscribe()
}

// ============================================================================
// HANDLERY
// ============================================================================

/**
 * Reaguje na nowe zadanie: po krótkim opóźnieniu ustawia status na `analyzing`,
 * następnie tworzy przydział dla agenta wykonawczego i ustawia status na
 * `in_progress`.
 * @param {Object} task - Świeżo utworzony rekord zadania
 * @returns {Promise<void>}
 */
async function handleNewTask(task) {
  // Reaguj wyłącznie na zadania o statusie `pending` aby uniknąć pętli
  if (task.status !== STATUS.PENDING) return

  console.log('[manager.js] Nowe zadanie:', task.id, task.title)

  // Krok 1: po 800 ms — przejdź do statusu `analyzing`
  await sleep(DELAY.ANALYZE)
  const claimed = await claimPendingTask(task.id)
  if (!claimed) {
    console.log('[manager.js] Zadanie już przejęte przez inną kartę:', task.id)
    return
  }

  // Krok 2: po kolejnych 1200 ms — utwórz przydział lub job dla stacji
  await sleep(DELAY.ASSIGN)
  const instructions = await generateInstructions(task)
  const target = await resolveExecutionTarget(task)
  let assigned = false
  if (target.kind === 'workstation') {
    assigned = await createWorkstationJob(task, instructions, target)
  } else {
    assigned = await createAssignment(task, instructions)
  }
  if (!assigned && target.kind === 'workstation') {
    assigned = await createAssignment(task, instructions, 'workstation-job-failed')
  }

  // Krok 3: natychmiast — zmień status zadania na `in_progress`
  await updateTaskStatus(task.id, assigned ? STATUS.IN_PROGRESS : STATUS.FAILED)
}

/**
 * Atomowo przejmuje zadanie pending, aby wiele kart nie dublowało pracy.
 * @param {string} taskId - UUID zadania
 * @returns {Promise<boolean>}
 */
async function claimPendingTask(taskId) {
  try {
    const { data, error } = await supabaseClient
      .from('tasks')
      .update({ status: STATUS.ANALYZING })
      .eq('id', taskId)
      .eq('status', STATUS.PENDING)
      .select('id')
      .maybeSingle()
    if (error) throw error
    return Boolean(data?.id)
  } catch (error) {
    console.error('[manager.js] claimPendingTask failed:', error)
    return false
  }
}

/**
 * Reaguje na wiadomość skierowaną do managera — odpowiada na pytania.
 * @param {Object} message - Rekord z tabeli messages
 * @returns {Promise<void>}
 */
async function handleManagerMessage(message) {
  // Odpowiadamy tylko na pytania od innych agentów
  if (message.type !== MESSAGE_TYPE.QUESTION) return
  if (message.from_agent === AGENT.MANAGER) return

  console.log('[manager.js] Pytanie od', message.from_agent, ':', message.content)

  // Krok 1: poczekaj 500 ms aby zasymulować „myślenie"
  await sleep(DELAY.ANSWER)

  // Krok 2: wyślij odpowiedź do nadawcy pytania
  await sendAnswer(message)
}

// ============================================================================
// OPERACJE NA BAZIE
// ============================================================================

/**
 * Aktualizuje status zadania w tabeli `tasks`.
 * @param {string} taskId - UUID zadania
 * @param {string} newStatus - nowa wartość status
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
    console.error('[manager.js] updateTaskStatus failed:', error)
  }
}

/**
 * Tworzy przydział zadania dla agenta wykonawczego.
 * @param {Object} task - Rekord zadania z tabeli tasks
 * @param {string} task.id - UUID zadania
 * @param {string} task.title - Tytuł zadania
 * @returns {Promise<boolean>}
 */
async function createAssignment(task, instructions, reason = 'no-active-workstation') {
  try {
    const { error } = await supabaseClient
      .from('assignments')
      .upsert({
        task_id: task.id,
        agent_id: AGENT.EXECUTOR_1,
        instructions,
        profile: 'programista',
        status: ASSIGNMENT_STATUS.ASSIGNED,
      }, { onConflict: 'task_id,agent_id' })
    if (error) throw error
    await logManagerDecision(task, assignmentDecisionText(reason))
    console.log('[manager.js] Przydzielono zadanie', task.id, 'do', AGENT.EXECUTOR_1)
    return true
  } catch (error) {
    console.error('[manager.js] createAssignment failed:', error)
    return false
  }
}

/**
 * Buduje opis decyzji dla fallbackowego wykonawcy przeglądarkowego.
 * @param {string} reason
 * @returns {string}
 */
function assignmentDecisionText(reason) {
  if (reason === 'workstation-job-failed') {
    return 'Nie udało się zakolejkować jobu na stację, więc wykonawca przeglądarkowy przejmuje rolę pracownika.'
  }
  return 'Brak aktywnej stacji z wolnym slotem, więc wykonawca przeglądarkowy obsłuży zadanie jako pracownik.'
}

/**
 * Tworzy job dla wskazanej stacji roboczej.
 * @param {Object} task
 * @param {string} instructions
 * @param {Object} target
 * @returns {Promise<boolean>}
 */
async function createWorkstationJob(task, instructions, target) {
  const workstation = target.workstation || null
  const workstationId = task.requested_workstation_id || workstation?.id
  const modelName = task.requested_model_name || workstation?.current_model_name || firstWorkstationModel(workstation)
  try {
    if (!workstationId) throw new Error('Brak ID stacji roboczej dla jobu')
    const { error } = await supabaseClient
      .from('workstation_jobs')
      .upsert({
        task_id: task.id,
        workstation_id: workstationId,
        requested_by_user_id: task.user_id || null,
        model_name: modelName || null,
        status: 'queued',
        payload: {
          title: task.title || '',
          description: task.description || '',
          git_repo: task.git_repo || null,
          context: task.context || {},
          instructions,
          routing: target.reason,
        },
      }, { onConflict: 'task_id,workstation_id' })
    if (error) throw error
    if (!task.requested_workstation_id) await rememberAssignedWorkstation(task.id, workstationId, modelName)
    await logManagerDecision(task, managerDecisionText(target, workstation, modelName))
    console.log('[manager.js] Zadanie', task.id, 'zakolejkowane dla stacji', workstationId)
    return true
  } catch (error) {
    console.error('[manager.js] createWorkstationJob failed:', error)
    return false
  }
}

/**
 * Decyduje, czy zadanie ma wykonać stacja robocza, czy fallback w przeglądarce.
 * @param {Object} task
 * @returns {Promise<Object>}
 */
async function resolveExecutionTarget(task) {
  if (task.requested_workstation_id) {
    return { kind: 'workstation', workstation: null, reason: 'explicit-workstation' }
  }
  const workstations = await getRunnableWorkstations()
  if (!workstations.length) {
    return { kind: 'browser', reason: 'no-active-workstation' }
  }
  const workstation = pickBestWorkstation(workstations)
  return { kind: 'workstation', workstation, reason: workstations.length === 1 ? 'single-active-workstation' : 'best-available-workstation' }
}

/**
 * Pobiera aktywne stacje z wolnym slotem.
 * @returns {Promise<Array>}
 */
async function getRunnableWorkstations() {
  try {
    const { data, error } = await supabaseClient
      .from('workstations')
      .select('*, workstation_models(*)')
      .eq('accepts_jobs', true)
      .in('status', [WORKSTATION_STATUS.ONLINE, WORKSTATION_STATUS.BUSY])
    if (error) throw error
    return (data || []).filter(isRunnableWorkstation)
  } catch (error) {
    console.error('[manager.js] getRunnableWorkstations failed:', error)
    return []
  }
}

/**
 * Sprawdza, czy stacja jest świeża i ma wolny slot.
 * @param {Object} workstation
 * @returns {boolean}
 */
function isRunnableWorkstation(workstation) {
  if (!workstation.last_seen_at) return false
  const ageMs = Date.now() - new Date(workstation.last_seen_at).getTime()
  if (!Number.isFinite(ageMs) || ageMs > WORKSTATION_STALE_MS) return false
  return workstationAvailableSlots(workstation) > 0
}

/**
 * Wybiera najlepszą stację według wolnych slotów i świeżości heartbeat.
 * @param {Array} workstations
 * @returns {Object}
 */
function pickBestWorkstation(workstations) {
  return [...workstations].sort((left, right) => {
    const slotDiff = workstationAvailableSlots(right) - workstationAvailableSlots(left)
    if (slotDiff !== 0) return slotDiff
    return new Date(right.last_seen_at).getTime() - new Date(left.last_seen_at).getTime()
  })[0]
}

/**
 * Zwraca liczbę wolnych slotów stacji z metadata.
 * @param {Object} workstation
 * @returns {number}
 */
function workstationAvailableSlots(workstation) {
  const metadata = workstation.metadata || {}
  const slots = Number(metadata.parallelSlots || 1)
  const active = Number(metadata.activeJobs || 0)
  if (Number.isFinite(Number(metadata.availableSlots))) return Math.max(0, Number(metadata.availableSlots))
  return Math.max(0, slots - active)
}

/**
 * Zapamiętuje automatycznie dobraną stację w rekordzie zadania.
 * @param {string} taskId
 * @param {string} workstationId
 * @param {string|null} modelName
 * @returns {Promise<void>}
 */
async function rememberAssignedWorkstation(taskId, workstationId, modelName) {
  try {
    const { error } = await supabaseClient
      .from('tasks')
      .update({ requested_workstation_id: workstationId, requested_model_name: modelName || null })
      .eq('id', taskId)
    if (error) throw error
  } catch (error) {
    console.error('[manager.js] rememberAssignedWorkstation failed:', error)
  }
}

/**
 * Zwraca pierwszy znany model stacji roboczej.
 * @param {Object|null} workstation
 * @returns {string|null}
 */
function firstWorkstationModel(workstation) {
  return workstation?.workstation_models?.[0]?.model_label || null
}

/**
 * Wysyła czytelny wpis decyzji managera do wiadomości zadania.
 * @param {Object} task
 * @param {string} content
 * @returns {Promise<void>}
 */
async function logManagerDecision(task, content) {
  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert({
        from_agent: AGENT.MANAGER,
        to_agent: AGENT.EXECUTOR_1,
        type: MESSAGE_TYPE.REPORT,
        content,
        task_id: task.id,
      })
    if (error) throw error
  } catch (error) {
    console.error('[manager.js] logManagerDecision failed:', error)
  }
}

/**
 * Buduje opis decyzji managera.
 * @param {Object} target
 * @param {Object|null} workstation
 * @param {string|null} modelName
 * @returns {string}
 */
function managerDecisionText(target, workstation, modelName) {
  if (target.reason === 'single-active-workstation') {
    return `Jedna aktywna stacja ma wolny slot, więc pełni rolę wykonawcy. Model: ${modelName || 'domyślny'}.`
  }
  if (target.reason === 'best-available-workstation') {
    return `Wybrano stację ${workstation?.display_name || workstation?.hostname || 'roboczą'} z największą dostępną pojemnością. Model: ${modelName || 'domyślny'}.`
  }
  return `Używam wskazanej stacji roboczej. Model: ${modelName || 'domyślny'}.`
}

/**
 * Generuje instrukcję dla agenta wykonawczego — przez AI lub fallback.
 * @param {Object} task
 * @returns {Promise<string>}
 */
async function generateInstructions(task) {
  const fallback = isHermesLabyrinthTask(task) ? buildHermesLabyrinthInstructions(task) : `Wykonaj: ${task.title}`
  if (!isAvailable()) return fallback
  try {
    const labyrinthBlock = buildHermesLabyrinthPromptBlock(task)
    const prompt = [
      'Jesteś AI kierownikiem. Sformułuj konkretną instrukcję po polsku',
      'dla agenta wykonawczego, który ma zrealizować zadanie.',
      labyrinthBlock,
      'Tytuł: ' + (task.title || ''),
      'Opis: ' + (task.description || ''),
      'Odpowiedz wyłącznie tekstem instrukcji, bez wstępu. Maksymalnie 5 punktów.',
    ].filter(Boolean).join('\n')
    const text = await generate(prompt, { maxTokens: isHermesLabyrinthTask(task) ? 220 : 120, temperature: 0.5 })
    return text || fallback
  } catch (error) {
    console.warn('[manager.js] AI fallback (instructions):', error.message)
    return fallback
  }
}

/**
 * Wysyła odpowiedź managera na pytanie executora.
 * @param {Object} questionMessage - Wiadomość typu question, na którą odpowiadamy
 * @returns {Promise<void>}
 */
async function sendAnswer(questionMessage) {
  const content = await generateAnswer(questionMessage)
  try {
    const { error } = await supabaseClient
      .from('messages')
      .insert({
        from_agent: AGENT.MANAGER,
        to_agent: questionMessage.from_agent,
        type: MESSAGE_TYPE.ANSWER,
        content,
        task_id: questionMessage.task_id,
      })
    if (error) throw error
  } catch (error) {
    console.error('[manager.js] sendAnswer failed:', error)
  }
}

/**
 * Generuje treść odpowiedzi managera — przez AI lub fallback.
 * @param {Object} questionMessage
 * @returns {Promise<string>}
 */
async function generateAnswer(questionMessage) {
  const fallback = 'Kontynuuj zadanie.'
  if (!isAvailable()) return fallback
  try {
    const prompt = [
      'Jesteś AI kierownikiem. Agent wykonawczy zadał ci pytanie.',
      'Odpowiedz po polsku jednym krótkim zdaniem (max 15 słów).',
      'Pytanie: "' + (questionMessage.content || '') + '"',
      'Odpowiedź:',
    ].join('\n')
    const text = await generate(prompt, { maxTokens: 60, temperature: 0.3 })
    return text || fallback
  } catch (error) {
    console.warn('[manager.js] AI fallback (answer):', error.message)
    return fallback
  }
}

// ============================================================================
// HELPERY
// ============================================================================

/**
 * Promise opakowujący setTimeout.
 * @param {number} ms - milisekundy
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
