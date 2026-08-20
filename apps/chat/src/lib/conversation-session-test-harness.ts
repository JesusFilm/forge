// Shared harness for the two conversation-session suites (conversation-session
// .test.ts + conversation-session.adopt.test.ts — split so neither crosses the
// 1k-line bar; mirrors components/shell/app-shell-test-harness.tsx). Not a test file.
import { vi } from "vitest"

import { type StreamReplyResult } from "./chat-stub"
import {
  createConversationSession,
  type ConversationSessionDeps,
} from "./conversation-session"

/** A promise with its resolver exposed, for hand-controlled settlement. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Flushes the microtask/macrotask chain the fire-and-forget callbacks settle
 * on (real timers — the suites never use fake ones). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// `satisfies` (not a type annotation) keeps the ok:true arm narrowed across
// the module boundary — suites spread these into `{ ...OK_SEEKER, video }`.
export const OK_STUB = {
  ok: true,
  text: "stub reply",
  sources: [],
  grounded: false,
  engine: "stub",
} satisfies StreamReplyResult

export const OK_SEEKER = {
  ok: true,
  text: "seeker reply",
  sources: [],
  grounded: true,
  engine: "seeker",
} satisfies StreamReplyResult

export const VIDEO = {
  videoId: "vid_1",
  title: "Jesus Calms the Storm",
  playbackId: "abcdEFGH1234",
  durationSeconds: 754,
  watchUrl: "https://www.jesusfilm.org/watch/jesus.html",
}

export const ROW = {
  id: "thread-1",
  title: "Server thread",
  updatedAt: "2026-07-12T08:00:00.000Z",
}

/** The session under test with every dep an inspectable vi.fn (defaults OK);
 * override any dep — seekerEnabled, initialConversationId, … — via `over`. */
export function makeSession(over: Partial<ConversationSessionDeps> = {}) {
  const streamReply = vi.fn<ConversationSessionDeps["streamReply"]>(
    async () => OK_STUB,
  )
  const fetchHistoryPage = vi.fn<ConversationSessionDeps["fetchHistoryPage"]>(
    async () => ({ ok: true, threads: [], hasMore: false }),
  )
  const fetchHistoryThread = vi.fn<
    ConversationSessionDeps["fetchHistoryThread"]
  >(async () => ({ ok: true, messages: [] }))
  const session = createConversationSession({
    streamReply,
    fetchHistoryPage,
    fetchHistoryThread,
    seekerEnabled: false,
    ...over,
  })
  return { session, streamReply, fetchHistoryPage, fetchHistoryThread }
}
