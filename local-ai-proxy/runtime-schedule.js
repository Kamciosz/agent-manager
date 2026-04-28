const VALID_OUTSIDE_ACTIONS = new Set(['wait', 'exit'])
const VALID_END_ACTIONS = new Set(['finish-current', 'stop-now'])

function normalizeSchedule(raw = {}) {
  const scheduleEnabled = raw.scheduleEnabled === true
  const scheduleStart = typeof raw.scheduleStart === 'string' ? raw.scheduleStart : null
  const scheduleEnd = typeof raw.scheduleEnd === 'string' ? raw.scheduleEnd : null
  const outsideAction = VALID_OUTSIDE_ACTIONS.has(raw.scheduleOutsideAction) ? raw.scheduleOutsideAction : 'wait'
  const endAction = VALID_END_ACTIONS.has(raw.scheduleEndAction) ? raw.scheduleEndAction : 'finish-current'
  const dumpOnStop = raw.scheduleDumpOnStop === true

  if (!scheduleEnabled) {
    return {
      enabled: false,
      valid: true,
      start: null,
      end: null,
      outsideAction,
      endAction,
      dumpOnStop,
    }
  }

  if (!isTimeValue(scheduleStart) || !isTimeValue(scheduleEnd)) {
    return {
      enabled: false,
      valid: false,
      start: null,
      end: null,
      outsideAction,
      endAction,
      dumpOnStop,
      error: `Invalid schedule window: ${scheduleStart || 'null'}-${scheduleEnd || 'null'}`,
    }
  }

  return {
    enabled: true,
    valid: true,
    start: scheduleStart,
    end: scheduleEnd,
    outsideAction,
    endAction,
    dumpOnStop,
  }
}

function isTimeValue(value) {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function minutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440
  const hour = String(Math.floor(normalized / 60)).padStart(2, '0')
  const minute = String(normalized % 60).padStart(2, '0')
  return `${hour}:${minute}`
}

function currentMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes()
}

function isInsideWindow(minutes, start, end) {
  if (start === end) return true
  if (start < end) return minutes >= start && minutes <= end
  return minutes >= start || minutes <= end
}

function secondsUntilStart(minutes, start) {
  if (minutes <= start) return (start - minutes) * 60
  return (1440 - minutes + start) * 60
}

function getScheduleState(raw = {}, now = new Date()) {
  const schedule = normalizeSchedule(raw)
  if (!schedule.enabled) {
    return {
      ...schedule,
      inside: true,
      windowLabel: 'disabled',
      secondsUntilStart: 0,
      nextStart: null,
    }
  }

  const minutes = currentMinutes(now)
  const start = timeToMinutes(schedule.start)
  const end = timeToMinutes(schedule.end)
  const inside = isInsideWindow(minutes, start, end)
  const waitSeconds = inside ? 0 : secondsUntilStart(minutes, start)

  return {
    ...schedule,
    inside,
    windowLabel: `${schedule.start}-${schedule.end}`,
    now: minutesToTime(minutes),
    secondsUntilStart: waitSeconds,
    nextStart: schedule.start,
  }
}

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

module.exports = {
  normalizeSchedule,
  getScheduleState,
  isTimeValue,
  isInsideWindow,
  timeToMinutes,
  formatDuration,
}
