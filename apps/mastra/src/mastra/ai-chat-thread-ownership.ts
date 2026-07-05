/**
 * Thread ownership + creation-ceiling gate for the ai-chat lane (feat-208).
 *
 * Mastra provides NO ownership enforcement on the agent message path: verified
 * in @mastra/core 1.36.0, both agent-side thread-preparation call sites run
 * `getThreadById({ threadId })` and silently ADOPT an existing thread without
 * comparing its resourceId to the caller's resource (the only mismatch throw
 * lives in the update-working-memory tool). With persistence, threadId alone
 * would therefore grant continuation of anyone's thread. Every ai-chat route
 * MUST call `authorizeAiChatThreadAccess` before streaming an agent turn.
 *
 * Known TOCTOU residue (accepted): the check-then-stream gap means an attacker
 * racing a victim's FIRST turn on a guessed id could create/adopt first —
 * winning a creation-time race against a v4 UUID, which is not practical.
 * The `thread_forbidden` outcome is also an existence oracle for thread ids;
 * accepted for the same entropy reason.
 */

/**
 * Per-resource thread-creation ceiling. Bounds a single cooperative or
 * runaway client only — a cookie-refusing caller can mint a fresh resource per
 * request, so the retention purge (./ai-chat-retention.ts) is the actual
 * adversarial backstop on storage growth.
 */
export const AI_CHAT_MAX_THREADS_PER_RESOURCE = 200

/** The narrow Memory surface the gate needs — structural so tests fake it. */
export type AiChatOwnershipMemory = {
  getThreadById: (args: {
    threadId: string
  }) => Promise<{ resourceId?: string | null } | null>
  listThreads: (args: {
    filter?: { resourceId?: string }
    page?: number
    perPage?: number
  }) => Promise<{ total: number }>
}

export type AiChatThreadAuthorization =
  | { ok: true }
  | { ok: false; reason: "thread_forbidden" | "thread_limit" }

/**
 * Authorize one turn against a thread. Existing thread → the caller's resource
 * must equal the thread's owner (`thread_forbidden` otherwise). New thread →
 * the resource must be under the creation ceiling (`thread_limit` otherwise).
 * Throws only if the underlying store does — callers map that to their
 * generic failure path (fail closed, never fail open).
 */
export async function authorizeAiChatThreadAccess({
  memory,
  threadId,
  resource,
  maxThreadsPerResource = AI_CHAT_MAX_THREADS_PER_RESOURCE,
}: {
  memory: AiChatOwnershipMemory
  threadId: string
  resource: string
  maxThreadsPerResource?: number
}): Promise<AiChatThreadAuthorization> {
  const thread = await memory.getThreadById({ threadId })
  if (thread !== null) {
    return thread.resourceId === resource
      ? { ok: true }
      : { ok: false, reason: "thread_forbidden" }
  }
  const { total } = await memory.listThreads({
    filter: { resourceId: resource },
    page: 0,
    perPage: 1,
  })
  return total >= maxThreadsPerResource
    ? { ok: false, reason: "thread_limit" }
    : { ok: true }
}
