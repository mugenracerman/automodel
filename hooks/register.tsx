import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level, Lock } from '../types'
import {
  EMPTY_LOCK,
  LINE_ORDER,
  SORTER_SYSTEM,
  bigNumber,
  decide,
  guessLevel,
  helperNote,
  isShortReply,
  kindOf,
  letGo,
  levelOfLine,
  lineFor,
  linesIn,
  parseLevel,
  title,
  turnedOff,
} from './logic'

type Engine = EngineInterface

const isOnAtom = atom({ plugin: 'automodel', key: 'isOn' } as const, false)
const lockAtom = atom({ plugin: 'automodel', key: 'lock' } as const, EMPTY_LOCK)

const GOLD = '#F2C46D'
const HAIR = '#262B33'
const MUTED = '#7D8590'
const TEXT = '#E6EDF3'
const GOOD = '#3DD68C'
const WARN = '#E3B341'

const TYPED = new Set(['composer', 'bridge', 'sdk'])
const SORT_TIMEOUT_MS = 4000
const SORT_MAX_TOKENS = 8

/** The `/config` row that holds the session's model, when this install has one. */
async function modelRow($: Engine) {
  try {
    const rows = await $.config.list()
    return rows.find(row => row.key === 'model' && !row.isLocked)
  } catch {
    return undefined
  }
}

/** The model lines this install offers: read from its model picker, else the Agent tool's lines. */
async function installLines($: Engine): Promise<string[]> {
  const row = await modelRow($)
  const names = [...(row?.options ?? []), typeof row?.value === 'string' ? row.value : '']
  const fromPicker = linesIn(names)
  if (fromPicker.length >= 2) return fromPicker
  try {
    const agent = (await $.tool.list()).find(tool => tool.name === 'Agent')
    const fromAgent = linesIn([agent?.description ?? ''])
    if (fromAgent.length >= 2) return fromAgent
  } catch {
    // fall through to the lines the engine's aliases name
  }
  return [...LINE_ORDER]
}

/** Asks the smallest model for one level; the words of the prompt decide when it cannot. */
export async function sortPrompt($: Engine, text: string, lines: readonly string[]): Promise<Level> {
  const small = lineFor('small', lines) ?? 'haiku'
  try {
    const reply = await $.model.complete({
      model: small,
      system: SORTER_SYSTEM,
      prompt: `Request:\n${text.slice(0, 6000)}\n\nLevel:`,
      maxTokens: SORT_MAX_TOKENS,
      timeoutMs: SORT_TIMEOUT_MS,
    })
    if (reply.isAnswered) {
      const level = parseLevel(reply.text)
      if (level !== undefined) return level
    }
  } catch {
    // the guess below answers
  }
  return guessLevel(text)
}

/** Puts the main conversation on `line`, without a word in the chat. */
async function setMain($: Engine, line: string, level: Level) {
  const row = await modelRow($)
  let isViaConfig = false
  if (row !== undefined) {
    const option = row.options?.find(o => o.toLowerCase().includes(line)) ?? line
    try {
      const done = await $.config.set({ key: 'model', value: option })
      isViaConfig = done.deny === undefined
    } catch {
      isViaConfig = false
    }
  }
  const seenModel = await $.session.model()
  await update($, lockAtom, lock => ({ ...lock, line, level, isFresh: false, seenModel, pendingHelper: null }))
  $.ui.status(isViaConfig ? undefined : `Model: ${title(line)}`)
  await rememberLock($, line, level)
}

async function rememberLock($: Engine, line: string, level: Level) {
  const id = await $.session.id()
  const saved = ((await $.store.get('locks')) ?? {}) as Record<string, { line: string; level: Level }>
  const kept = Object.entries(saved).filter(([key]) => key !== id).slice(-49)
  await $.store.set('locks', Object.fromEntries([...kept, [id, { line, level }]]))
}

/** Saves the switch and remembers which model to give back once it is off. */
async function setOn($: Engine, isOn: boolean) {
  await $.store.set('isOn', isOn)
  await update($, isOnAtom, () => isOn)
  if (isOn) {
    const isRestorePending = (await $.store.get('restorePending')) === true
    if (!isRestorePending) {
      const own = await usersModel($)
      const row = own === undefined ? await modelRow($) : undefined
      const previous = own ?? (typeof row?.value === 'string' ? row.value : undefined)
      if (previous !== undefined) await $.store.set('restoreModel', previous)
    }
    await $.store.set('restorePending', false)
    const isUnderWay = (await $.session.turns()) > 0
    const seenModel = await $.session.model()
    const current = linesIn([seenModel])[0] ?? null
    await update($, lockAtom, lock =>
      lock.line === null && isUnderWay && current !== null
        ? { ...lock, line: current, level: levelOfLine(current), isFresh: false, isPinned: false, seenModel }
        : { ...lock, isPinned: false },
    )
    return
  }
  await update($, lockAtom, turnedOff)
  await $.store.set('restorePending', true)
  const lock = await read($, lockAtom)
  if (lock.line === null) await restoreModel($)
}

/** The model as the person wrote it in their own settings (`opus`, not a pinned id). */
async function usersModel($: Engine): Promise<string | undefined> {
  try {
    const own = (await $.settings.read({ source: 'user' })) as { model?: unknown }
    return typeof own.model === 'string' && own.model !== '' ? own.model : undefined
  } catch {
    return undefined
  }
}

/** Gives the person's own model back for new sessions, once Auto Model is off. */
async function restoreModel($: Engine) {
  const previous = await $.store.get('restoreModel')
  if ((await $.store.get('restorePending')) !== true) return
  if (typeof previous === 'string' && previous !== '') {
    try {
      await $.config.set({ key: 'model', value: previous })
    } catch {
      // nothing to give back on an install without the row
    }
  }
  await $.store.set('restorePending', false)
}

/** A model picked by hand wins: Auto Model turns off and lets go. */
async function handPicked($: Engine) {
  await $.store.set('isOn', false)
  await $.store.set('restorePending', false)
  await update($, isOnAtom, () => false)
  await update($, lockAtom, letGo)
  $.ui.status(undefined)
}

async function toggle($: Engine) {
  await setOn($, !(await read($, isOnAtom)))
}

function statusText(isOn: boolean, lock: Lock): string {
  return [
    `Auto Model is ${isOn ? 'on' : 'off'}.`,
    `Locked model: ${title(lock.line)}.`,
    `Level that chose it: ${lock.level ?? 'none yet'}.`,
    `Jobs sent to helpers this session: ${lock.helpers}.`,
  ].join(' ')
}

async function runCommand($: Engine, args: string): Promise<string> {
  const word = args.trim().toLowerCase().split(/\s+/)[0] ?? ''
  const isOn = await read($, isOnAtom)
  const lock = await read($, lockAtom)
  if (word === 'on') {
    if (isOn) return 'Auto Model is already on.'
    await setOn($, true)
    return lock.line === null || lock.isFresh
      ? 'Auto Model is on. Your next typed prompt picks the model.'
      : `Auto Model is on. This session stays on ${title(lock.line)} and steps up only for a harder job.`
  }
  if (word === 'off') {
    if (!isOn) return 'Auto Model is already off.'
    await setOn($, false)
    return lock.line === null
      ? 'Auto Model is off.'
      : `Auto Model is off. This session stays on ${title(lock.line)}; your next new session starts on the model you used before.`
  }
  if (word === 'status' || word === '') return statusText(isOn, lock)
  if (word === 'repick') {
    if (!isOn) return 'Auto Model is off. Turn it on with /automodel on first.'
    await update($, lockAtom, now => ({ ...now, isFresh: true }))
    return 'Your next prompt is sorted fresh and may move the model up or down. A change of model rebuilds the cache once.'
  }
  return 'Use /automodel on, /automodel off, /automodel status or /automodel repick.'
}

// Damon's Tools (it registers /damons-tools) shows every plugin's switch in its
// own dashboard and keeps the footer to one button; while it is installed this
// plugin leaves its footer toggle out. Looked up at most every few seconds.
let dashboardSeen: { at: number; isThere: boolean } | undefined
async function hasDashboard($: {
  clock: { now: () => Promise<number> }
  command: { list: () => Promise<readonly { name: string }[]> }
}): Promise<boolean> {
  // Where the lookup cannot run, keep the toggle.
  try {
    const now = await $.clock.now()
    if (dashboardSeen && now - dashboardSeen.at < 5000) return dashboardSeen.isThere
    const isThere = (await $.command.list()).some(c => c.name === 'damons-tools')
    dashboardSeen = { at: now, isThere }
    return isThere
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'automodel',
      description: 'Auto Model: on, off, status, or repick the model on your next prompt',
      argumentHint: 'on | off | status | repick',
      immediate: true,
    })
    const isOn = (await $.store.get('isOn')) === true
    await update($, isOnAtom, () => isOn)
    if (!isOn) await restoreModel($)

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await update($, lockAtom, lock => ({ ...lock, isFresh: true, helpers: 0, pendingHelper: null }))
    } else if (e.source === 'compact') {
      await update($, lockAtom, lock => ({ ...lock, isFresh: true }))
    } else if (e.source === 'resume') {
      const saved = ((await $.store.get('locks')) ?? {}) as Record<string, { line: string; level: Level }>
      const had = saved[e.session_id]
      const seenModel = await $.session.model()
      const line = had?.line ?? linesIn([seenModel])[0] ?? null
      await update($, lockAtom, () => ({
        ...EMPTY_LOCK,
        line,
        level: had?.level ?? (line === null ? null : levelOfLine(line)),
        isFresh: false,
        seenModel,
      }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, lockAtom, lock => ({ ...lock, isFresh: true, helpers: 0, pendingHelper: null }))
    }

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await update($, lockAtom, lock => ({ ...lock, isFresh: true }))

    return done
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!TYPED.has(e.origin.kind) || e.turnId !== undefined) return next(e)

    const before = await read($, lockAtom)
    if (before.seenModel !== null && (await $.session.model()) !== before.seenModel) {
      await handPicked($)
      return next(e)
    }
    if (!(await read($, isOnAtom))) return next(e)

    const text = e.text.trim()
    if (text.startsWith('/') || isShortReply(text)) return next(e)

    const lines = await installLines($)
    const level = await sortPrompt($, text, lines)
    const lock = await read($, lockAtom)
    const decision = decide(lock, level, kindOf(text))

    if (decision.kind === 'set') {
      const line = lineFor(decision.level, lines)
      if (line !== undefined) await setMain($, line, decision.level)
      return next(e)
    }
    if (decision.kind === 'note') {
      const line = lineFor(decision.level, lines)
      if (line !== undefined && line !== lock.line) {
        await update($, lockAtom, now => ({ ...now, pendingHelper: line }))
        return next({ ...e, context: [...(e.context ?? []), helperNote(line)] })
      }
    }
    await update($, lockAtom, now => ({ ...now, pendingHelper: null }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const lock = await read($, lockAtom)
    const isHeld = lock.isPinned || (await read($, isOnAtom))
    if (!isHeld || lock.line === null || e.model.toLowerCase().includes(lock.line)) return yield* next(e)

    return yield* next({ ...e, model: lock.line })
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const lock = await read($, lockAtom)
    if (lock.pendingHelper !== null && e.model === lock.pendingHelper) {
      await update($, lockAtom, now => ({ ...now, helpers: now.helpers + 1, pendingHelper: null }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const before = await $.session.model()
    const done = await next(e)
    const isPerson = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'
    if (isPerson && (await $.session.model()) !== before) await handPicked($)

    return done
  }).catch(($, e, next) => next(e))

  on('config.set', { key: 'model' }, async ($, e, next) => {
    const done = await next(e)
    const isPerson = e.origin?.kind === 'composer' || e.origin?.kind === 'bridge'
    if (isPerson && done.deny === undefined) await handPicked($)

    return done
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'automodel' }, async ($, e) => ({ text: await runCommand($, e.args) })).catch(
    ($, e, next) => (next.called ? next(e) : { text: 'Auto Model could not do that just now. Try again in a moment.' }),
  )

  // The button sits in the footer beside whatever else is drawn there: the
  // engine's mode labels and other mods' buttons all come through `next`.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (await hasDashboard($)) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const isOn = await read($, isOnAtom)
    const theirs = await next(e)

    return (
      <Box flexDirection="row" columnGap={1}>
        {theirs}
        <Box backgroundColor={HAIR} paddingX={1}>
          <Button key="automodel-toggle" plain label={`Auto Model: ${isOn ? 'On' : 'Off'}`} onPress={() => toggle($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'automodel' } }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    if (!/^\s*(status)?\s*$/i.test(e.props.args)) return next(e)

    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const isOn = await read($, isOnAtom)
    const lock = await read($, lockAtom)
    const width = Math.max(24, (e.viewport?.columns ?? 80) - 4)
    const rule = (lead: string, color: string) => (
      <Box flexDirection="row" width={width}>
        <Box flexShrink={0}>
          <Text color={color}>{lead}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text color={HAIR} wrap="truncate">{'─'.repeat(width)}</Text>
        </Box>
      </Box>
    )
    const row = (label: string, value: string, color: string) => (
      <Box flexDirection="row" height={1} overflow="hidden">
        <Box width={15} flexShrink={0}>
          <Text color={MUTED} wrap="truncate">{label}</Text>
        </Box>
        <Text color={color} wrap="truncate">{value}</Text>
      </Box>
    )
    const digits = bigNumber(lock.helpers)

    return (
      <Box flexDirection="column" width={width}>
        <Text bold color={TEXT} wrap="truncate">AUTO MODEL</Text>
        {rule('━'.repeat(10), GOLD)}
        <Box marginTop={1} flexDirection="column">
          {rule('SWITCH ', MUTED)}
          {row('Auto Model', isOn ? 'On' : 'Off', isOn ? GOOD : WARN)}
          {row('Locked model', title(lock.line), TEXT)}
          {row('Chosen by', lock.level ?? 'none yet', TEXT)}
        </Box>
        <Box marginTop={1} flexDirection="column">
          {rule('HELPERS ', MUTED)}
          <Box flexDirection="row">
            {e.surface === 'desktop' ? (
              <Box flexShrink={0}>
                <Code source={digits.join('\n')} wrap="truncate-end" />
              </Box>
            ) : (
              <Box borderStyle="round" borderColor={HAIR} paddingX={1} flexDirection="column" flexShrink={0}>
                <Text color={TEXT}>{digits[0]}</Text>
                <Text color={TEXT}>{digits[1]}</Text>
                <Text color={TEXT}>{digits[2]}</Text>
              </Box>
            )}
            <Box paddingLeft={2} flexDirection="column" justifyContent="center">
              <Text color={MUTED} wrap="truncate">jobs sent to helpers this session</Text>
            </Box>
          </Box>
        </Box>
        <Box marginTop={1} flexDirection="row" columnGap={1}>
          <Box backgroundColor={GOLD} paddingX={1}>
            <Button key="automodel-switch" plain label={isOn ? 'Turn off' : 'Turn on'} onPress={() => toggle($)} />
          </Box>
          {isOn && (
            <Box backgroundColor={HAIR} paddingX={1}>
              <Button key="automodel-repick" plain label="Repick next prompt" onPress={() => runCommand($, 'repick')} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
