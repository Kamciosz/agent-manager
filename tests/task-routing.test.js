const assert = require('node:assert/strict')
const test = require('node:test')

async function routingModule() {
  return import('../ui/labyrinth.js')
}

test('bug-fix repair tasks are routed with code execution budget', async () => {
  const { TASK_ROUTE, classifyTask } = await routingModule()
  const routing = classifyTask({ title: 'napraw program agent menager', template: 'bug-fix' })
  assert.equal(routing.route, TASK_ROUTE.STANDARD)
  assert.equal(routing.modelProfile, 'code-executor')
  assert.ok(routing.reason.includes('code_repair_keyword'))
})

test('saved instant routing is upgraded for code repair tasks', async () => {
  const { TASK_ROUTE, taskRouting } = await routingModule()
  const routing = taskRouting({
    title: 'napraw program agent menager',
    description: '',
    context: {
      template: 'bug-fix',
      raw: {
        routing: {
          route: TASK_ROUTE.INSTANT,
          reason: ['short_simple_task'],
          modelProfile: 'tiny-router',
          maxOutputTokens: 180,
          timeoutMs: 30000,
          contextTokens: 4096,
        },
      },
    },
  })
  assert.equal(routing.route, TASK_ROUTE.STANDARD)
  assert.equal(routing.modelProfile, 'code-executor')
  assert.ok(routing.reason.includes('upgraded_saved_instant'))
})
