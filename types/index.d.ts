export type Level = 'small' | 'everyday' | 'strong' | 'strongest'

export type Lock = {
  /** The model line the main conversation is locked to (`opus`), or null before the first pick. */
  line: string | null
  /** The level the sorter gave when that line was chosen. */
  level: Level | null
  /** True when the next typed prompt may pick fresh: a new session, /clear, a compaction, /automodel repick. */
  isFresh: boolean
  /** True while the main thread should stay on `line` even with Auto Model off (turned off mid-session). */
  isPinned: boolean
  /** The session model as last seen after Auto Model set it; a different one later means a pick by hand. */
  seenModel: string | null
  /** Jobs handed to helper agents this session. */
  helpers: number
  /** The helper line a note just asked for, until the Agent call that answers it. */
  pendingHelper: string | null
}

declare module 'claude-code' {
  interface PluginState {
    automodel: { isOn: boolean; lock: Lock }
  }
}
