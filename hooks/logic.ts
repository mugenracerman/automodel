import type { Level, Lock } from '../types'

export const LEVELS: readonly Level[] = ['small', 'everyday', 'strong', 'strongest']

/** The four model lines, least to most capable, as the engine names their aliases. */
export const LINE_ORDER: readonly string[] = ['haiku', 'sonnet', 'opus', 'fable']

export const EMPTY_LOCK: Lock = {
  line: null,
  level: null,
  isFresh: true,
  isPinned: false,
  seenModel: null,
  helpers: 0,
  pendingHelper: null,
}

export const SORTER_SYSTEM = [
  'Sort the request into exactly one level. Answer with the one word only.',
  'small: quick, simple jobs. Summarize, sort, extract, rename, translate, reformat, a short factual answer.',
  'everyday: an email, a post, a short draft, a small edit, a simple question about one file, a quick chart.',
  'strong: the default for anything that matters. Building or changing software, multi-step projects, research, analysis, long documents, planning, anything touching several files or tools.',
  'strongest: only the very hardest. Deep research that runs for hours, a very large build or migration, a problem the strong model would likely fall short on.',
  'When unsure, say strong.',
].join('\n')

export const rank = (level: Level): number => LEVELS.indexOf(level)

/** Reads the sorter's one-word answer; undefined when it named no level. */
export function parseLevel(text: string): Level | undefined {
  const word = text.toLowerCase().match(/\b(strongest|strong|everyday|small)\b/)
  return word ? (word[1] as Level) : undefined
}

const SHORT_REPLIES = new Set([
  'yes', 'y', 'yep', 'yeah', 'sure', 'ok', 'okay', 'k', 'no', 'nope', 'thanks', 'thank you',
  'go', 'go ahead', 'do it', 'keep going', 'continue', 'carry on', 'sounds good', 'looks good',
  'lgtm', 'perfect', 'great', 'nice', 'please do', 'yes please', 'ok do it', 'proceed', 'next',
])

/** A short reply to what Claude just said: fewer than four words, or a known go-ahead. */
export function isShortReply(text: string): boolean {
  const clean = text.trim().toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ')
  if (clean === '') return true
  if (SHORT_REPLIES.has(clean)) return true
  return clean.split(' ').length < 4
}

const STRONGEST = /\b(for hours|overnight|deep research|entire (codebase|system|repo)|whole (codebase|system|repo)|large[- ]scale|migrat(e|ion) (the|our|all|every)|from scratch.*(platform|system)|very large)\b/
const STRONG = /\b(build|implement|refactor|debug|fix|architect\w*|design|research|analy[sz]\w*|plan\w*|project|app|application|feature|bug|test(s|ing)?|deploy|migrat\w*|several files|multiple files|codebase|repo|pipeline|investigate|integrat\w*|optimi[sz]\w*)\b/
const EVERYDAY = /\b(email|e-mail|post|tweet|letter|reply to|draft|note|message|chart|graph|small edit|tweak|this file|one file|blurb|caption|bio)\b/
const SMALL = /\b(summari[sz]e|sort|extract|rename|translate|reformat|format|convert|list|define|what is|what's|who is|when (is|was|did)|spell|capitali[sz]e|count|tl;?dr)\b/

/** Guesses the level from the prompt's words when the sorter cannot answer: strong when in doubt. */
export function guessLevel(text: string): Level {
  const t = text.toLowerCase()
  if (STRONGEST.test(t)) return 'strongest'
  if (STRONG.test(t)) return 'strong'
  if (EVERYDAY.test(t)) return 'everyday'
  if (SMALL.test(t) && t.split(/\s+/).length <= 40) return 'small'
  return 'strong'
}

export type Kind = 'answer' | 'work' | 'contextual'

const ACTION = /\b(read|open|summari[sz]e|rename|reformat|format|convert|translate|extract|sort|clean up|tidy|list|count|draft|rewrite|proofread|merge|split)\b/
const MATERIAL = /\b(file|files|folder|folders|directory|csv|docx|pdf|spreadsheet|xlsx|logs?)\b|[\w-]+\.(md|txt|ts|tsx|js|py|json|csv|docx|pdf|xlsx|log|html|ya?ml)\b|[\w.-]+[\\/][\w.-]+/
const CONTEXTUAL = /\b(this|that|it|these|those|above|earlier|before|previous|again|same|we|our|us|you said|you just|your (last|previous)|the plan|the change|the fix|continue|so far)\b/

/** A pasted text this long is worth a helper's fresh start. */
export const LONG_TEXT = 1500

/**
 * What a later, smaller prompt needs: a one-line answer, a self-contained job,
 * or the conversation. A job is only `work` when it has material to get through
 * (files, or a long pasted text): a helper starts cold, loading its tools and
 * instructions, so a short translation or rewrite is cheaper from the locked
 * model's cache.
 */
export function kindOf(text: string): Kind {
  const t = text.toLowerCase()
  const hasMaterial = MATERIAL.test(t) || text.length >= LONG_TEXT
  if (CONTEXTUAL.test(t) && text.length < LONG_TEXT) return 'contextual'
  if (ACTION.test(t) && hasMaterial) return 'work'
  return 'answer'
}

/** Picks the line for a level from the lines this install offers, stepping down when it lacks one. */
export function lineFor(level: Level, lines: readonly string[]): string | undefined {
  const ordered = LINE_ORDER.filter(line => lines.includes(line))
  if (ordered.length === 0) return undefined
  const wanted = Math.min(rank(level), LINE_ORDER.length - 1)
  for (let i = wanted; i >= 0; i -= 1) {
    const line = LINE_ORDER[i]
    if (line !== undefined && ordered.includes(line)) return line
  }
  return ordered[0]
}

/** The level a line serves, for a lock read back. */
export function levelOfLine(line: string): Level {
  const at = LINE_ORDER.indexOf(line)
  return LEVELS[Math.max(0, Math.min(at, LEVELS.length - 1))] ?? 'strong'
}

/** Finds the model lines named in a list of model names or ids, least capable first. */
export function linesIn(names: readonly string[]): string[] {
  const text = names.join(' ').toLowerCase()
  return LINE_ORDER.filter(line => text.includes(line))
}

export type Decision =
  | { kind: 'set'; level: Level; reason: 'fresh' | 'step-up' }
  | { kind: 'note'; level: Level }
  | { kind: 'keep' }

/**
 * What to do with one sorted prompt. Fresh: pick, up or down. Locked: step up
 * once when it sorts higher, never down; a smaller self-contained job gets a
 * helper note; everything else stays on the locked model.
 */
export function decide(lock: Lock, level: Level, kind: Kind): Decision {
  if (lock.isFresh || lock.level === null) return { kind: 'set', level, reason: 'fresh' }
  if (rank(level) > rank(lock.level)) return { kind: 'set', level, reason: 'step-up' }
  if (rank(level) < rank(lock.level) && rank(level) <= rank('everyday') && kind === 'work') {
    return { kind: 'note', level }
  }
  return { kind: 'keep' }
}

/** The note that asks Claude to hand a small self-contained job to one helper. */
export function helperNote(line: string): string {
  return [
    'Auto Model note: this request is a small, self-contained job.',
    `Hand it to exactly one helper agent with the Agent tool, model "${line}".`,
    'Give the helper only what it needs for this job (the file paths or the text itself), wait for it, then pass its result back to the user in your own reply.',
    'If the job turns out to depend on this conversation, do it yourself instead.',
  ].join(' ')
}

/** The state after the plugin turns Auto Model off: sorting stops, the model stays. */
export function turnedOff(lock: Lock): Lock {
  return { ...lock, isPinned: lock.line !== null, pendingHelper: null }
}

/** The state after a pick by hand: Auto Model lets go of the model entirely. */
export function letGo(lock: Lock): Lock {
  return { ...lock, line: null, level: null, isPinned: false, seenModel: null, pendingHelper: null }
}

/**
 * Heavy box-drawing digits, three rows tall, from the common heavy glyphs only
 * (no half-line glyphs, which the desktop's fonts lack).
 */
const DIGITS: Record<string, readonly [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['━┓ ', ' ┃ ', '━┻━'],
  '2': ['━━┓', '┏━┛', '┗━━'],
  '3': ['━━┓', ' ━┫', '━━┛'],
  '4': ['┃ ┃', '┗━┫', '  ┃'],
  '5': ['┏━━', '┗━┓', '━━┛'],
  '6': ['┏━━', '┣━┓', '┗━┛'],
  '7': ['━━┓', '  ┃', '  ┃'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '━━┛'],
}

export function bigNumber(n: number): [string, string, string] {
  const glyphs = String(Math.max(0, Math.floor(n))).split('').map(d => DIGITS[d] ?? DIGITS['0']!)
  return [0, 1, 2].map(row => glyphs.map(g => g[row]).join(' ')) as [string, string, string]
}

export function title(line: string | null): string {
  return line === null ? 'not picked yet' : line.charAt(0).toUpperCase() + line.slice(1)
}
