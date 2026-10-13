import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type World = {
  sorted: string[]
  setModels: string[]
  prompts: { text: string; context?: readonly string[] }[]
  steps: string[]
  model: () => string
}

/**
 * The engine beneath the mod: a model picker, a session model, a sorter that answers `answer`.
 * `isLive` false is a session that keeps its model when the setting changes, as `claude -p` does.
 * `refused` names the lines the model setting will not take, as on a plan without them.
 */
function world(
  on: On,
  answer: () => string,
  store: Record<string, unknown> = { isOn: true },
  turns = 0,
  isLive = true,
  refused: readonly string[] = [],
): World {
  let current = 'claude-sonnet-5-5'
  const w: World = { sorted: [], setModels: [], prompts: [], steps: [], model: () => current }
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodel' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: turns }))
  on('settings.read', () => ({ value: { model: 'opus' } }))
  on('session.model', () => ({ value: current }))
  on('tool.list', () => ({ value: [] }))
  on('config.list', () => ({
    value: [
      {
        key: 'model',
        label: 'Model',
        kind: 'choice' as const,
        value: current,
        options: ['haiku', 'sonnet', 'opus', 'fable'],
        provider: { plugin: 'engine', tier: 'core' as const },
        isLocked: false,
      },
    ],
  }))
  on('config.set', ($, e) => {
    if (refused.includes(String(e.value))) return { deny: 'not on this plan' }
    if (isLive) current = `claude-${String(e.value)}-5-5`
    w.setModels.push(String(e.value))
    return { value: e.value }
  })
  on('model.complete', ($, e) => {
    w.sorted.push(e.prompt)
    return { value: { isAnswered: true as const, text: answer(), usage: USAGE } }
  })
  on('prompt.submit', ($, e) => {
    w.prompts.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('classic.SessionStart', () => ({}))
  on('turn.step', async function* ($, e) {
    w.steps.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  return w
}

/** A main-loop model step naming `model`, as the engine resolved it. */
const step = (model: string, index = 0) => ({ turnId: 'turn-1', index, model, messageCount: 1 })

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const START = { cwd: '/tmp', surface: 'terminal' as const, isInteractive: true }
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
const command = (args: string) => ({
  command: 'automodel',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})
const pickByHand = (value: string) => ({
  key: 'model',
  value,
  previous: 'opus',
  provider: { plugin: 'engine', tier: 'core' as const },
  origin: { kind: 'composer' as const },
})

describe('Auto Model in a session', () => {
  test('the first typed prompt picks the main model', async ($, on) => {
    const w = world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('Refactor the billing module and add tests for it'))
    expect(w.sorted.length).toBe(1)
    expect(w.setModels).toEqual(['opus'])
  })

  test('a step already on the locked model goes out as the engine named it', async ($, on) => {
    const w = world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('Refactor the billing module and add tests for it'))
    for await (const _ of $.turn.step(step('claude-opus-5-5'))) {
      // the test's engine yields no chunks
    }
    expect(w.steps).toEqual(['claude-opus-5-5'])
  })

  test('a step never names a bare alias, which the API refuses', async ($, on) => {
    const w = world(on, () => 'small', { isOn: true }, 0, false)
    await $.session.start(START)
    await $.prompt.submit(typed('What is the capital of France?'))
    expect(w.setModels).toEqual(['haiku'])
    for await (const _ of $.turn.step(step('claude-sonnet-5-5'))) {
      // the test's engine yields no chunks
    }
    expect(w.steps).toEqual(['claude-sonnet-5-5'])
  })

  test('a step moves to the full id it has seen for the locked line', async ($, on) => {
    const w = world(on, () => 'small', { isOn: true }, 0, false)
    await $.session.start(START)
    for await (const _ of $.turn.step(step('claude-haiku-5-5'))) {
      // the test's engine yields no chunks
    }
    await $.prompt.submit(typed('What is the capital of France?'))
    for await (const _ of $.turn.step(step('claude-sonnet-5-5', 1))) {
      // the test's engine yields no chunks
    }
    expect(w.steps).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5'])
  })

  test('a line the plan lacks steps down to the next one the setting takes', async ($, on) => {
    const w = world(on, () => 'strongest', { isOn: true }, 0, true, ['fable'])
    await $.session.start(START)
    await $.prompt.submit(typed('Do deep research comparing every home battery system for hours'))
    expect(w.setModels).toEqual(['opus'])
    expect(w.model()).toBe('claude-opus-5-5')
    const reply = await $.command.run(command('status'))
    expect(reply.text).toContain('Locked model: Opus')
  })

  test('a later prompt that sorts lower keeps the lock and a small job gets the helper note', async ($, on) => {
    let answer = 'strong'
    const w = world(on, () => answer)
    await $.session.start(START)
    await $.prompt.submit(typed('Build a CLI that syncs two folders over SSH'))
    answer = 'small'
    await $.prompt.submit(typed('Summarize notes.md into five bullet points'))
    expect(w.setModels).toEqual(['opus'])
    expect(w.prompts[1]?.context?.some(note => note.includes('model "haiku"'))).toBe(true)
    await $.prompt.submit(typed('What year did Apollo 11 land on the Moon?'))
    expect(w.prompts[2]?.context ?? []).toEqual([])
  })

  test('a higher prompt steps up once and never steps back down', async ($, on) => {
    let answer = 'everyday'
    const w = world(on, () => answer)
    await $.session.start(START)
    await $.prompt.submit(typed('Write an email to my landlord about the heating'))
    answer = 'strong'
    await $.prompt.submit(typed('Now plan and build a small web app for tracking repairs'))
    answer = 'everyday'
    await $.prompt.submit(typed('Write a short post announcing the app launch'))
    expect(w.setModels).toEqual(['sonnet', 'opus'])
  })

  test('short replies and slash commands are never sorted', async ($, on) => {
    const w = world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('keep going'))
    await $.prompt.submit(typed('/help me with everything please now'))
    expect(w.sorted.length).toBe(0)
  })

  test('after /clear the next prompt picks fresh, down as well', async ($, on) => {
    let answer = 'strong'
    const w = world(on, () => answer)
    await $.session.start(START)
    await $.prompt.submit(typed('Investigate why the deploy pipeline keeps failing'))
    await $.classic.SessionStart({ source: 'clear' })
    answer = 'small'
    await $.prompt.submit(typed('Translate this paragraph into French for me'))
    expect(w.setModels).toEqual(['opus', 'haiku'])
  })

  test('turning it off leaves the current model and stops sorting', async ($, on) => {
    const w = world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('Refactor the billing module and add tests for it'))
    const reply = await $.command.run(command('off'))
    expect(reply.text).toContain('stays on Opus')
    expect(w.setModels).toEqual(['opus'])
    expect(w.model()).toBe('claude-opus-5-5')
    await $.prompt.submit(typed('Now plan and build a small web app for tracking repairs'))
    expect(w.sorted.length).toBe(1)
  })

  test('status reports the lock, the level and the helper count', async ($, on) => {
    world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('Refactor the billing module and add tests for it'))
    const reply = await $.command.run(command('status'))
    expect(reply.text).toContain('Locked model: Opus')
    expect(reply.text).toContain('Level that chose it: strong')
    expect(reply.text).toContain('helpers this session: 0')
  })

  test('turned on mid-session it locks to the current model instead of re-picking', async ($, on) => {
    const w = world(on, () => 'small', { isOn: false }, 12)
    await $.session.start(START)
    await $.command.run(command('on'))
    await $.prompt.submit(typed('Translate this paragraph into French for me'))
    expect(w.setModels).toEqual([])
    const reply = await $.command.run(command('status'))
    expect(reply.text).toContain('Locked model: Sonnet')
  })

  test('a failed sort falls back to the words of the prompt', async ($, on) => {
    const w = world(on, () => 'no idea')
    await $.session.start(START)
    await $.prompt.submit(typed('Write an email to my landlord about the heating'))
    expect(w.setModels).toEqual(['sonnet'])
  })

  test('a model picked by hand turns Auto Model off', async ($, on) => {
    const w = world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('Refactor the billing module and add tests for it'))
    await $.config.set(pickByHand('haiku'))
    await $.prompt.submit(typed('Now plan and build a small web app for tracking repairs'))
    expect(w.sorted.length).toBe(1)
    const reply = await $.command.run(command('status'))
    expect(reply.text).toContain('Auto Model is off')
  })

  test('the status card fits a narrow and a wide pane', async ($, on) => {
    world(on, () => 'strong')
    await $.session.start(START)
    await $.prompt.submit(typed('Refactor the billing module and add tests for it'))
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [40, 160]) {
        const ui = await $.ui.mount({
          plugin: 'automodel',
          surface,
          component: 'CommandOutput',
          props: { command: 'automodel', args: 'status', text: '', isErrored: false },
          viewport: { columns, rows: 40 },
        })
        expect(await ui.find({ type: 'Text', text: 'AUTO MODEL' })).toBeDefined()
        expect((await ui.find({ key: 'automodel-switch' }))?.text).toBe('Turn off')
        await ui.unmount()
      }
    }
  })

  test('the status bar button reads On and flips with one press', async ($, on) => {
    world(on, () => 'strong')
    on('ui.render', { component: 'SessionMode' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, {}, 'from beneath')
    })
    await $.session.start(START)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'automodel', surface, component: 'SessionMode', props: { modes: [] } })
      expect((await ui.find({ key: 'automodel-toggle' }))?.text).toBe('Auto Model: On')
      await ui.press({ key: 'automodel-toggle' })
      expect((await ui.find({ key: 'automodel-toggle' }))?.text).toBe('Auto Model: Off')
      await ui.press({ key: 'automodel-toggle' })
      expect(await ui.find({ text: 'from beneath' })).toBeDefined()
      await ui.unmount()
    }
  })
})
