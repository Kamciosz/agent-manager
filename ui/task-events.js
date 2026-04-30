export const TASK_EVENT_LABELS = {
  'task.created': 'Utworzono',
  'task.edited': 'Edytowano',
  'task.status_changed': 'Status',
  'task.cancelled': 'Anulowano',
  'task.retried': 'Ponowiono',
  'task.deleted': 'Usunięto',
}

export function taskEventLabel(eventType) {
  return TASK_EVENT_LABELS[eventType] || eventType || 'Zdarzenie'
}

export function taskEventActorLabel(event, currentUserId) {
  if (event.actor_user_id && currentUserId && event.actor_user_id === currentUserId) return 'Ty'
  if (event.actor_kind === 'station') return 'Stacja robocza'
  if (event.actor_kind === 'user') return 'Użytkownik panelu'
  return 'System'
}

export function taskEventHtml(event, { currentUserId, escapeHtml, formatDate }) {
  const fields = Array.isArray(event.metadata?.changed_fields) ? event.metadata.changed_fields : []
  const actor = taskEventActorLabel(event, currentUserId)
  return `
    <div class="rounded-lg border border-violet-100 bg-violet-50 px-4 py-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold text-slate-900">${escapeHtml(taskEventLabel(event.event_type))}</div>
        <div class="text-xs text-slate-500">${formatDate(event.created_at)}</div>
      </div>
      <div class="mt-1 text-sm text-slate-700">${escapeHtml(event.summary || '')}</div>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>${escapeHtml(actor)}</span>
        ${fields.length ? `<span>· pola: ${escapeHtml(fields.join(', '))}</span>` : ''}
      </div>
    </div>
  `
}

export function runTraceAuditHtml(event, index, { escapeHtml, formatDate }) {
  return `
    <div class="grid grid-cols-[72px_1fr] gap-3">
      <div class="pt-3 text-right font-mono text-xs text-slate-400">${String(index + 1).padStart(2, '0')}</div>
      <div class="rounded-lg border border-violet-200 bg-violet-50 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="font-semibold text-slate-900">Historia · ${escapeHtml(taskEventLabel(event.event_type))}</div>
          <div class="text-xs text-slate-500">${formatDate(event.created_at)}</div>
        </div>
        <div class="mt-2 text-sm text-slate-700">${escapeHtml(event.summary || '')}</div>
      </div>
    </div>
  `
}