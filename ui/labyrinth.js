/**
 * @file labyrinth.js
 * @description Preset Hermes Agent Labyrinth dostosowany do Agent Manager.
 *              Definiuje role, bramy workflow i pomocnicze funkcje budowania
 *              kontekstu zadania dla managera, executora i lokalnych stacji.
 */

export const HERMES_LABYRINTH_TEMPLATE_ID = 'hermes-labyrinth'
export const HERMES_LABYRINTH_LABEL = 'Hermes Labyrinth'

export const TASK_ROUTE = {
  INSTANT: 'instant',
  FAST: 'fast',
  STANDARD: 'standard',
  DEEP: 'deep',
}

export const TASK_ROUTE_CONFIG = {
  [TASK_ROUTE.INSTANT]: { maxTokens: 180, temperature: 0.2, timeoutMs: 30000, contextTokens: 4096, outputContract: 'Odpowiedz bezpośrednio. Bez nagłówków. Maksymalnie 3 zdania.' },
  [TASK_ROUTE.FAST]: { maxTokens: 700, temperature: 0.3, timeoutMs: 120000, contextTokens: 8192, outputContract: 'Sekcje: Wynik, Sprawdzenie, Następny krok jeśli potrzebny.' },
  [TASK_ROUTE.STANDARD]: { maxTokens: 1800, temperature: 0.35, timeoutMs: 600000, contextTokens: 32768, outputContract: 'Sekcje: Plan, Wykonanie, Dowody, Ryzyka, Raport końcowy.' },
  [TASK_ROUTE.DEEP]: { maxTokens: 4000, temperature: 0.25, timeoutMs: 1800000, contextTokens: 65536, outputContract: 'Zwróć markdown zgodny z JSON: mapa, decyzje, wykonanie, artefakty, testy, blokery, raport.' },
}

export const HERMES_LABYRINTH_PRESET = {
  title: 'Uruchom Hermes Labyrinth dla: ',
  description: [
    'Przeprowadź polecenie przez labirynt agentów: rozpoznanie, plan, wykonanie, weryfikację i raport.',
    'AI kierownik ma rozbić pracę na małe kroki, dobrać wykonawcę lub stację roboczą i pilnować bram jakości.',
  ].join('\n'),
  requirements: [
    'Zacznij od mapy zadania: cel, ścieżka plików, ryzyka, zależności, kolejność działań.',
    'Każdy etap ma mieć krótki wynik kontrolny i dowód przejścia przed następną bramą.',
    'Zapisuj w logu zadania decyzje managera, komunikaty stacji, testy i wynik końcowy.',
    'Na końcu przygotuj raport: co zrobiono, jak sprawdzono, co zostało ryzykowne i jaki jest następny krok.',
  ].join('\n'),
  avoid: [
    'Nie skacz od razu do implementacji bez mapy.',
    'Nie ukrywaj niepewności ani brakujących danych.',
    'Nie zmieniaj plików spoza wskazanego zakresu bez powodu.',
  ].join('\n'),
}

export const HERMES_LABYRINTH_ROLES = [
  { id: 'navigator', name: 'Navigator', responsibility: 'ustala trasę, priorytety, ścieżkę logu i bramy przejścia' },
  { id: 'scout', name: 'Scout', responsibility: 'zbiera kontekst z repo, dokumentacji, UI i danych zadania' },
  { id: 'cartographer', name: 'Cartographer', responsibility: 'zamienia rozpoznanie w mapę plików, ryzyk i punktów kontrolnych' },
  { id: 'builder', name: 'Builder', responsibility: 'wykonuje zmianę albo przygotowuje precyzyjną instrukcję dla stacji' },
  { id: 'verifier', name: 'Verifier', responsibility: 'sprawdza testy, regresje, logi i realny efekt działania' },
  { id: 'scribe', name: 'Scribe', responsibility: 'zamyka zadanie raportem z dowodami i pozostałym ryzykiem' },
]

export const HERMES_LABYRINTH_GATES = [
  { id: 'intake', name: 'Brama wejścia', check: 'cel, repo, zakres, ograniczenia i kryterium sukcesu są jawne' },
  { id: 'map', name: 'Mapa labiryntu', check: 'wskazane są pliki, zależności, ryzyka, komendy i kolejność kroków' },
  { id: 'route', name: 'Wybór ścieżki', check: 'routing wskazuje przeglądarkę, konkretną stację lub fallback i powód wyboru' },
  { id: 'execute', name: 'Przejście ścieżki', check: 'zmiany są małe, spójne z repo i opisane w logu zadania' },
  { id: 'evidence', name: 'Ślad dowodowy', check: 'konsola zawiera decyzje, wynik stacji, testy i ostrzeżenia' },
  { id: 'verify', name: 'Lustro testera', check: 'wynik przeszedł sensowną weryfikację albo ryzyko jest jawne' },
  { id: 'report', name: 'Wyjście', check: 'człowiek dostaje zwięzły raport, dowody i następny bezpieczny krok' },
]

const HERMES_LABYRINTH_RULES = [
  'Najpierw mapa, potem wykonanie.',
  'Każda decyzja routingowa ma powód i trafia do logu zadania.',
  'Każda niepewność trafia do raportu i konsoli zamiast do cichego zgadywania.',
  'Nie kończ bez śladu dowodowego: komenda, test, obserwacja albo powód braku testu.',
  'Weryfikator próbuje znaleźć błąd przed oznaczeniem zadania jako gotowe.',
]

/**
 * Sprawdza, czy wybrany szablon to Hermes Labyrinth.
 * @param {string|null|undefined} template
 * @returns {boolean}
 */
export function isHermesLabyrinthTemplate(template) {
  return template === HERMES_LABYRINTH_TEMPLATE_ID
}

/**
 * Buduje kontekst zapisywany w `tasks.context.raw`.
 * @param {Object|null} baseContext
 * @returns {Object}
 */
export function buildHermesLabyrinthContext(baseContext = {}) {
  const routing = classifyTask(baseContext)
  return {
    ...(baseContext || {}),
    routing,
    workflow: {
      id: HERMES_LABYRINTH_TEMPLATE_ID,
      name: HERMES_LABYRINTH_LABEL,
      inspiration: 'Hermes Agent style multi-agent routing, adapted for Agent Manager fork',
      mode: routing.route,
      roles: HERMES_LABYRINTH_ROLES,
      gates: HERMES_LABYRINTH_GATES,
      rules: HERMES_LABYRINTH_RULES,
      budgets: TASK_ROUTE_CONFIG[routing.route],
      outputContract: [
        'Mapa: cel, pliki, ryzyka, kolejność, routing',
        'Ścieżka: wykonane kroki i decyzje managera/stacji',
        'Dowody: testy, logi, obserwacje, błędy lub powód braku testu',
        'Raport: rezultat, ryzyko, następny krok',
      ],
    },
  }
}

/**
 * Klasyfikuje zadanie do budżetu wykonania instant/fast/standard/deep.
 * @param {Object|null} input
 * @returns {{route:string, reason:string[], modelProfile:string, maxOutputTokens:number, timeoutMs:number, contextTokens:number}}
 */
export function classifyTask(input = {}) {
  const text = [input.title, input.description, input.requirements, input.links, input.avoid].filter(Boolean).join('\n').toLowerCase()
  const words = text.split(/\s+/).filter(Boolean).length
  const reason = []
  let score = 0
  if (words > 80) { score += 1; reason.push('words_gt_80') }
  if (words > 250) { score += 2; reason.push('words_gt_250') }
  if (/analiza|research|architektura|rls|bezpiecze|migrac|benchmark|audyt|produkcyj/.test(text)) { score += 2; reason.push('deep_keyword') }
  if (/testy|e2e|playwright|supabase|migrac|edge function|kolejk|lease|retry/.test(text)) { score += 1; reason.push('engineering_keyword') }
  if (input.template === HERMES_LABYRINTH_TEMPLATE_ID || input.workflow?.id === HERMES_LABYRINTH_TEMPLATE_ID) { score += 1; reason.push('hermes_template') }
  const route = words < 25 && score === 0 ? TASK_ROUTE.INSTANT : score <= 1 ? TASK_ROUTE.FAST : score <= 3 ? TASK_ROUTE.STANDARD : TASK_ROUTE.DEEP
  const cfg = TASK_ROUTE_CONFIG[route]
  return {
    route,
    reason: reason.length ? reason : ['short_simple_task'],
    modelProfile: route === TASK_ROUTE.INSTANT ? 'tiny-router' : route === TASK_ROUTE.FAST ? 'fast-general' : route === TASK_ROUTE.STANDARD ? 'code-executor' : 'deep-reasoner',
    maxOutputTokens: cfg.maxTokens,
    timeoutMs: cfg.timeoutMs,
    contextTokens: cfg.contextTokens,
  }
}

/**
 * Zwraca routing zapisany w zadaniu albo klasyfikuje zadanie z pól rekordu.
 * @param {Object|null} task
 * @returns {{route:string, reason:string[], modelProfile:string, maxOutputTokens:number, timeoutMs:number, contextTokens:number}}
 */
export function taskRouting(task) {
  const context = task?.context || {}
  const raw = context.raw || context
  if (raw?.routing?.route && TASK_ROUTE_CONFIG[raw.routing.route]) return raw.routing
  if (raw?.workflow?.mode && TASK_ROUTE_CONFIG[raw.workflow.mode]) {
    const cfg = TASK_ROUTE_CONFIG[raw.workflow.mode]
    return { route: raw.workflow.mode, reason: ['workflow_mode'], modelProfile: raw.routing?.modelProfile || 'code-executor', maxOutputTokens: cfg.maxTokens, timeoutMs: cfg.timeoutMs, contextTokens: cfg.contextTokens }
  }
  return classifyTask({ title: task?.title, description: task?.description, template: context.template })
}

/**
 * Zwraca konfigurację budżetu dla routingu zadania.
 * @param {Object|null} task
 * @returns {Object}
 */
export function taskRouteConfig(task) {
  return TASK_ROUTE_CONFIG[taskRouting(task).route] || TASK_ROUTE_CONFIG[TASK_ROUTE.STANDARD]
}

/**
 * Sprawdza rekord zadania pod kątem aktywnego workflow Hermes Labyrinth.
 * @param {Object|null} task
 * @returns {boolean}
 */
export function isHermesLabyrinthTask(task) {
  const context = task?.context || {}
  const raw = context.raw || context
  return isHermesLabyrinthTemplate(context.template) || raw?.workflow?.id === HERMES_LABYRINTH_TEMPLATE_ID
}

/**
 * Buduje fallbackową instrukcję dla executora lub stacji roboczej.
 * @param {Object} task
 * @returns {string}
 */
export function buildHermesLabyrinthInstructions(task) {
  const gates = HERMES_LABYRINTH_GATES.map((gate) => `${gate.name}: ${gate.check}`).join(' -> ')
  return [
    `Wykonaj: ${task?.title || 'polecenie'}.`,
    'Pracuj trybem Hermes Labyrinth: mapa, wybór ścieżki, małe kroki, ślad dowodowy, weryfikacja i raport.',
    `Bramy: ${gates}.`,
    'W odpowiedzi użyj sekcji: Mapa, Ścieżka, Dowody, Weryfikacja, Raport końcowy.',
  ].join(' ')
}

/**
 * Zwraca blok promptu dla lokalnego LLM, jeśli zadanie używa labiryntu.
 * @param {Object} task
 * @returns {string}
 */
export function buildHermesLabyrinthPromptBlock(task) {
  if (!isHermesLabyrinthTask(task)) return ''
  const roles = HERMES_LABYRINTH_ROLES.map((role) => `- ${role.name}: ${role.responsibility}`).join('\n')
  const gates = HERMES_LABYRINTH_GATES.map((gate) => `- ${gate.name}: ${gate.check}`).join('\n')
  return [
    'Aktywny workflow: Hermes Labyrinth dla Agent Manager.',
    'Role:',
    roles,
    'Bramy przejścia:',
    gates,
    'Zasady: najpierw mapa, jawne ryzyka, decyzje w logu, dowody przed raportem.',
    'Format odpowiedzi: Mapa / Ścieżka / Dowody / Weryfikacja / Raport końcowy.',
  ].join('\n')
}

/**
 * Buduje krótkie podsumowanie workflow do widoku przeglądu.
 * @param {Object|null} context
 * @returns {string}
 */
export function summarizeHermesLabyrinthContext(context) {
  const workflow = context?.workflow
  if (!workflow || workflow.id !== HERMES_LABYRINTH_TEMPLATE_ID) return ''
  return `${workflow.name}: ${workflow.gates.length} bram, ${workflow.roles.length} ról, tryb ${workflow.mode}.`
}
