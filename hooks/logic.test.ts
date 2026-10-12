import { describe, expect, test } from 'claude-code/testing'

import type { Lock } from '../types'
import {
  EMPTY_LOCK,
  bigNumber,
  decide,
  guessLevel,
  isShortReply,
  kindOf,
  lineFor,
  linesIn,
  parseLevel,
  turnedOff,
} from './logic'

const locked = (over: Partial<Lock>): Lock => ({ ...EMPTY_LOCK, isFresh: false, line: 'opus', level: 'strong', ...over })

describe('reading the one-word answer', () => {
  test('finds each level, strongest before strong', () => {
    expect(parseLevel('small')).toBe('small')
    expect(parseLevel(' Everyday.')).toBe('everyday')
    expect(parseLevel('STRONG')).toBe('strong')
    expect(parseLevel('strongest')).toBe('strongest')
    expect(parseLevel('level: strongest\n')).toBe('strongest')
  })
  test('names nothing for an answer outside the four', () => {
    expect(parseLevel('medium')).toBe(undefined)
    expect(parseLevel('')).toBe(undefined)
  })
})

describe('spotting a short reply', () => {
  test('short or go-ahead replies are short', () => {
    for (const text of ['yes', 'ok', 'keep going', 'do it', 'Sounds good!', 'go for it']) {
      expect(isShortReply(text), text).toBe(true)
    }
  })
  test('a real request is not', () => {
    expect(isShortReply('Summarize notes.md into five bullet points')).toBe(false)
    expect(isShortReply('yes, and also rename every file in the folder')).toBe(false)
  })
})

describe('the word-based fallback', () => {
  test('sorts by the words, strong when in doubt', () => {
    expect(guessLevel('Translate this paragraph into French')).toBe('small')
    expect(guessLevel('Write an email to my landlord about the heating')).toBe('everyday')
    expect(guessLevel('Refactor the auth module and add tests')).toBe('strong')
    expect(guessLevel('Migrate the entire codebase from Vue 2 to Vue 3')).toBe('strongest')
    expect(guessLevel('Hmm, thoughts on the colour scheme overall maybe')).toBe('strong')
  })
})

describe('picking and locking', () => {
  test('the first prompt of a session picks, whatever its level', () => {
    expect(decide(EMPTY_LOCK, 'everyday', 'answer')).toEqual({ kind: 'set', level: 'everyday', reason: 'fresh' })
  })
  test('a later prompt that sorts lower stays on the locked model', () => {
    expect(decide(locked({}), 'everyday', 'answer')).toEqual({ kind: 'keep' })
    expect(decide(locked({}), 'small', 'contextual')).toEqual({ kind: 'keep' })
  })
  test('a later prompt that sorts higher steps up once, never back down', () => {
    const up = decide(locked({ line: 'sonnet', level: 'everyday' }), 'strong', 'work')
    expect(up).toEqual({ kind: 'set', level: 'strong', reason: 'step-up' })
    const after = locked({ line: 'opus', level: 'strong' })
    expect(decide(after, 'everyday', 'answer')).toEqual({ kind: 'keep' })
    expect(decide(after, 'strong', 'work')).toEqual({ kind: 'keep' })
  })
  test('after /clear or a compaction the next prompt picks fresh, down too', () => {
    expect(decide(locked({ isFresh: true }), 'small', 'work')).toEqual({ kind: 'set', level: 'small', reason: 'fresh' })
  })
})

describe('the helper note', () => {
  test('only a small or everyday job with real work in it that stands alone', () => {
    expect(kindOf('Summarize notes.md into five bullet points')).toBe('work')
    expect(decide(locked({}), 'small', kindOf('Summarize notes.md into five bullet points'))).toEqual({
      kind: 'note',
      level: 'small',
    })
    expect(decide(locked({}), 'small', kindOf('What year did Apollo 11 land on the Moon?'))).toEqual({ kind: 'keep' })
    expect(decide(locked({}), 'small', kindOf('Summarize what we decided above'))).toEqual({ kind: 'keep' })
    expect(decide(locked({ line: 'sonnet', level: 'everyday' }), 'everyday', 'work')).toEqual({ kind: 'keep' })
  })
  test('a short job with no files or long text stays on the cached main model', () => {
    expect(kindOf('Translate "good morning, see you at noon" into French, Spanish and German')).toBe('answer')
    expect(kindOf('Rewrite this sentence to sound friendlier')).toBe('contextual')
    expect(kindOf('Rename the files in C:/photos/2024 to their dates')).toBe('work')
    expect(kindOf(`Translate into French: ${'The quick brown fox jumps over the lazy dog. '.repeat(40)}`)).toBe('work')
  })
})

describe('turning it off', () => {
  test('keeps the current model for the session', () => {
    const off = turnedOff(locked({ pendingHelper: 'haiku' }))
    expect(off.line).toBe('opus')
    expect(off.isPinned).toBe(true)
    expect(off.pendingHelper).toBe(null)
  })
})

describe('the model lines', () => {
  test('read from the install and stepped down when one is missing', () => {
    expect(linesIn(['Default (claude-opus-5-5)', 'sonnet', 'haiku'])).toEqual(['haiku', 'sonnet', 'opus'])
    expect(lineFor('strongest', ['haiku', 'sonnet', 'opus'])).toBe('opus')
    expect(lineFor('strong', ['haiku', 'sonnet'])).toBe('sonnet')
    expect(lineFor('small', ['haiku', 'sonnet', 'opus', 'fable'])).toBe('haiku')
  })
  test('big numbers are three rows of heavy box drawing', () => {
    expect(bigNumber(10)).toEqual(['━┓  ┏━┓', ' ┃  ┃ ┃', '━┻━ ┗━┛'])
    expect(bigNumber(7).join('')).not.toMatch(/[╸╹╺╻]/)
  })
})
