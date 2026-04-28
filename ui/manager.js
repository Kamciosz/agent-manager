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

const DELAY = {
  ANALYZE: 800,       // czas „analizy" zadania zanim status zmieni się na analyzing
  ASSIGN: 1200,       // czas tworzenia przydziału (po analyzing)
  ANSWER: 500,        // opóźnienie odpowiedzi managera na pytanie executora
}

// ============================================================================
// STAN MODUŁU
// ============================================================================

let supabaseClient = null
let initialized = false

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

  subscribeToNewTasks()
  subscribeToManagerMessages()

  console.log('[manager.js] AI kierownik uruchomiony.')
}

// ============================================================================
// SUBSKRYPCJE REALTIME
// ============================================================================

/**
 * Subskrybuje INSERT na tabeli `tasks` aby reagować na nowe zadania.
 * @returns {void}
 */
function subscribeToNewTasks() {
  supabaseClient
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
  supabaseClient
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
  await updateTaskStatus(task.id, STATUS.ANALYZING)

  // Krok 2: po kolejnych 1200 ms — utwórz przydział lub job dla stacji
  await sleep(DELAY.ASSIGN)
  const instructions = await generateInstructions(task)
  if (task.requested_workstation_id) {
    await createWorkstationJob(task, instructions)
  } else {
    await createAssignment(task, instructions)
  }

  // Krok 3: natychmiast — zmień status zadania na `in_progress`
  await updateTaskStatus(task.id, STATUS.IN_PROGRESS)
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
 * @returns {Promise<void>}
 */
async function createAssignment(task, instructions) {
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
    console.log('[manager.js] Przydzielono zadanie', task.id, 'do', AGENT.EXECUTOR_1)
  } catch (error) {
    console.error('[manager.js] createAssignment failed:', error)
  }
}

/**
 * Tworzy job dla wskazanej stacji roboczej.
 * @param {Object} task
 * @param {string} instructions
 * @returns {Promise<void>}
 */
async function createWorkstationJob(task, instructions) {
  try {
    const { error } = await supabaseClient
      .from('workstation_jobs')
      .upsert({
        task_id: task.id,
        workstation_id: task.requested_workstation_id,
        requested_by_user_id: task.user_id || null,
        model_name: task.requested_model_name || null,
        status: 'queued',
        payload: {
          title: task.title || '',
          description: task.description || '',
          git_repo: task.git_repo || null,
          context: task.context || {},
          instructions,
        },
      }, { onConflict: 'task_id,workstation_id' })
    if (error) throw error
    console.log('[manager.js] Zadanie', task.id, 'zakolejkowane dla stacji', task.requested_workstation_id)
  } catch (error) {
    console.error('[manager.js] createWorkstationJob failed:', error)
  }
}

/**
 * Generuje instrukcję dla agenta wykonawczego — przez AI lub fallback.
 * @param {Object} task
 * @returns {Promise<string>}
 */
async function generateInstructions(task) {
  const fallback = `Wykonaj: ${task.title}`
  if (!isAvailable()) return fallback
  try {
    const prompt = [
      'Jesteś AI kierownikiem. Sformułuj krótką (1-2 zdania) instrukcję',
      'po polsku dla agenta wykonawczego, który ma zrealizować zadanie.',
      'Tytuł: ' + (task.title || ''),
      'Opis: ' + (task.description || ''),
      'Odpowiedz wyłącznie tekstem instrukcji, bez wstępu.',
    ].join('\n')
    const text = await generate(prompt, { maxTokens: 120, temperature: 0.5 })
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
