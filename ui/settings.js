const STORAGE_KEYS = {
  theme: 'agent-manager-theme',
  language: 'agent-manager-language',
  defaultRepo: 'agent-manager-default-repo',
  defaultWorkstation: 'agent-manager-default-workstation',
}

export function getSettings() {
  return {
    theme: localStorage.getItem(STORAGE_KEYS.theme) || 'system',
    language: localStorage.getItem(STORAGE_KEYS.language) || 'pl',
    defaultRepo: localStorage.getItem(STORAGE_KEYS.defaultRepo) || '',
    defaultWorkstation: localStorage.getItem(STORAGE_KEYS.defaultWorkstation) || '',
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.theme, settings.theme || 'system')
  localStorage.setItem(STORAGE_KEYS.language, settings.language || 'pl')
  localStorage.setItem(STORAGE_KEYS.defaultRepo, settings.defaultRepo || '')
  localStorage.setItem(STORAGE_KEYS.defaultWorkstation, settings.defaultWorkstation || '')
  applySettings(getSettings())
}

export function applySettings(settings = getSettings()) {
  document.documentElement.lang = settings.language || 'pl'
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const useDark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('theme-dark', useDark)
}

export function getRecentRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem('agent-manager-recent-repos') || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : []
  } catch {
    return []
  }
}

export function rememberRepo(repo) {
  const value = String(repo || '').trim()
  if (!value) return
  const next = [value, ...getRecentRepos().filter((item) => item !== value)].slice(0, 8)
  localStorage.setItem('agent-manager-recent-repos', JSON.stringify(next))
}
