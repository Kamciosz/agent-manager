/**
 * @file labyrinth.js
 * @description Preset Hermes Agent Labyrinth dostosowany do Agent Manager.
 *              Definiuje role, bramy workflow i pomocnicze funkcje budowania
 *              kontekstu zadania dla managera, executora i lokalnych stacji.
 */

export const HERMES_LABYRINTH_TEMPLATE_ID = 'hermes-labyrinth'
export const HERMES_LABYRINTH_LABEL = 'Hermes Labyrinth'

export const HERMES_LABYRINTH_PRESET = {
  title: 'Uruchom Hermes Labyrinth dla: ',
  description: [
    'Przeprowadź polecenie przez labirynt agentów: rozpoznanie, plan, wykonanie, weryfikację i raport.',
    'AI kierownik ma rozbić pracę na małe kroki, dobrać wykonawcę lub stację roboczą i pilnować bram jakości.',
  ].join('\n'),
  requirements: [
    'Zacznij od mapy zadania: cel, pliki, ryzyka, kolejność działań.',
    'Każdy etap ma mieć krótki wynik kontrolny przed przejściem dalej.',
    'Na końcu przygotuj raport: co zrobiono, jak sprawdzono, co zostało ryzykowne.',
  ].join('\n'),
  avoid: [
    'Nie skacz od razu do implementacji bez mapy.',
    'Nie ukrywaj niepewności ani brakujących danych.',
    'Nie zmieniaj plików spoza wskazanego zakresu bez powodu.',
  ].join('\n'),
}

export const HERMES_LABYRINTH_ROLES = [
  { id: 'navigator', name: 'Navigator', responsibility: 'ustala trasę, priorytety i bramy przejścia' },
  { id: 'scout', name: 'Scout', responsibility: 'zbiera kontekst z repo, dokumentacji i danych zadania' },
  { id: 'builder', name: 'Builder', responsibility: 'wykonuje zmianę albo przygotowuje instrukcję dla stacji' },
  { id: 'verifier', name: 'Verifier', responsibility: 'sprawdza testy, ryzyka, regresje i bezpieczeństwo' },
  { id: 'scribe', name: 'Scribe', responsibility: 'zamyka zadanie krótkim raportem dla człowieka' },
]

export const HERMES_LABYRINTH_GATES = [
  { id: 'intake', name: 'Brama wejścia', check: 'cel, repo, ograniczenia i kryterium sukcesu są jasne' },
  { id: 'map', name: 'Mapa labiryntu', check: 'wybrane są pliki, zależności, ryzyka i kolejność kroków' },
  { id: 'split', name: 'Podział ról', check: 'AI kierownik wie, czy użyć executora, specjalisty czy stacji roboczej' },
  { id: 'execute', name: 'Przejście ścieżki', check: 'zmiany są małe, odwracalne i zgodne z lokalnym stylem' },
  { id: 'verify', name: 'Lustro testera', check: 'wynik przeszedł testy albo ryzyko jest jawnie opisane' },
  { id: 'report', name: 'Wyjście', check: 'człowiek dostaje zwięzły raport i następny bezpieczny krok' },
]

const HERMES_LABYRINTH_RULES = [
  'Najpierw mapa, potem wykonanie.',
  'Jedna decyzja routingowa na etap: przeglądarka, konkretna stacja albo fallback.',
  'Każda niepewność trafia do raportu zamiast do cichego zgadywania.',
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
  return {
    ...(baseContext || {}),
    workflow: {
      id: HERMES_LABYRINTH_TEMPLATE_ID,
      name: HERMES_LABYRINTH_LABEL,
      inspiration: 'Hermes Agent style multi-agent routing, adapted for Agent Manager fork',
      mode: 'manager-led-labyrinth',
      roles: HERMES_LABYRINTH_ROLES,
      gates: HERMES_LABYRINTH_GATES,
      rules: HERMES_LABYRINTH_RULES,
      outputContract: [
        'mapa zadania',
        'wykonane kroki',
        'wynik weryfikacji',
        'krótki raport końcowy',
      ],
    },
  }
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
    'Pracuj trybem Hermes Labyrinth: najpierw mapa, potem małe kroki, potem weryfikacja i raport.',
    `Bramy: ${gates}.`,
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
    'Zasady: najpierw mapa, jawne ryzyka, test przed raportem.',
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
