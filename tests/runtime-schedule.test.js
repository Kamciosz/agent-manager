const assert = require('node:assert/strict')
const test = require('node:test')

const {
  formatDuration,
  getScheduleState,
  isInsideWindow,
  isTimeValue,
  normalizeSchedule,
  timeToMinutes,
} = require('../local-ai-proxy/runtime-schedule')

test('normalizeSchedule disables invalid windows safely', () => {
  const schedule = normalizeSchedule({ scheduleEnabled: true, scheduleStart: '25:00', scheduleEnd: '08:00' })
  assert.equal(schedule.enabled, false)
  assert.equal(schedule.valid, false)
  assert.match(schedule.error, /Invalid schedule window/)
})

test('overnight schedule treats late night and early morning as inside', () => {
  const start = timeToMinutes('18:00')
  const end = timeToMinutes('08:00')
  assert.equal(isInsideWindow(timeToMinutes('23:30'), start, end), true)
  assert.equal(isInsideWindow(timeToMinutes('07:45'), start, end), true)
  assert.equal(isInsideWindow(timeToMinutes('12:00'), start, end), false)
})

test('getScheduleState reports wait until next overnight start', () => {
  const state = getScheduleState({
    scheduleEnabled: true,
    scheduleStart: '18:00',
    scheduleEnd: '08:00',
  }, new Date('2026-04-30T12:15:00'))
  assert.equal(state.inside, false)
  assert.equal(state.nextStart, '18:00')
  assert.equal(state.secondsUntilStart, 20700)
})

test('time validation and duration formatting stay stable', () => {
  assert.equal(isTimeValue('08:30'), true)
  assert.equal(isTimeValue('8:30'), false)
  assert.equal(formatDuration(3660), '1h 1m')
  assert.equal(formatDuration(59), '0m')
})
