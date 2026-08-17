/**
 * Thread ownership + creation-ceiling gate for the ai-chat lane (feat-208).
 *
 * Mastra provides NO ownership enforcement on the agent message path: verified
 * in @mastra/core 1.36.0, both agent-side thread-preparation call sites run
 * `getThreadById({ threadId })` and silently ADOPT an existing thread without
 * comparing its resourceId to the caller's resource (the only mismatch throw
 * lives in the update-working-memory tool). With persistence, threadId alone
 * would therefore grant continuation of anyone's thread. Every ai-chat route
 * MUST call `authorizeAiChatThreadAccess` before streaming an agent turn;
 * read-only surfaces (history replay) resolve ownership+existence through
 * `resolveOwnedExistingThread` instead (feat-284 — no ceiling branch on reads).
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

/**
 * Resource-key prefix for signed-in users (chat-proxy contract, feat-208).
 * Single mastra-side home (this module owns the resource contract); apps/chat
 * keeps its own mirror per the no-cross-app-import rule. Prefix-check only —
 * NEVER split on ":" (an OIDC sub may contain anything).
 */
export const USER_RESOURCE_PREFIX = "user:"

/**
 * The SHARED fallback resource key stamped on every internal caller that omits
 * a `resourceId` (feat-204 KTD3). It lives here — the module that owns the
 * resource contract — rather than in `agents/seeker-route.ts`, because
 * `ai-chat-erasure.ts` (feat-337) must refuse this exact key without importing
 * the route module: that module runs `buildSeekerAgent()` at module scope, so
 * importing it would eagerly construct the whole seeker agent (including the
 * kill-switch-resolved Memory the erasure module deliberately bypasses) just to
 * read a string. `seeker-route.ts` re-exports it, so existing importers and
 * test pins are unaffected.
 *
 * Erasure boundary (feat-337 R2): key equality does NOT bound this key's blast
 * radius to one subject — many individuals' turns share it — so the erasure
 * tool refuses it outright. Retention is that data's only deletion path.
 */
export const SEEKER_DEFAULT_RESOURCE_ID = "seeker-dogfood"

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
 *
 * Fail modes differ by branch, per the @mastra/pg contract — not uniform:
 *  - Ownership (existing thread): `getThreadById` THROWS on a store error, which
 *    propagates so the caller maps it to its generic failure — fail CLOSED. This
 *    is the security-critical guarantee: a store blip never grants continuation
 *    of someone else's thread.
 *  - Ceiling (new thread): `listThreads` SWALLOWS store errors and returns total
 *    0, so a transient fault lets thread creation through — fail OPEN. Accepted:
 *    the ceiling is only a soft anti-abuse cap on a cooperative/runaway client
 *    (the retention purge is the adversarial backstop), never the access
 *    boundary, and a genuinely-down store fails the downstream stream anyway.
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

export type AiChatOwnedThreadResolution =
  | { ok: true }
  | { ok: false; reason: "thread_forbidden" | "thread_not_found" }

/**
 * Read-path resolution (feat-284): an owned, EXISTING thread — or a fixed
 * refusal — from a single `getThreadById`. Answers the read question the
 * write-path gate above cannot: `null` → `thread_not_found` (a vanished
 * thread is never an empty-transcript success); owner mismatch →
 * `thread_forbidden`; owner match → ok. There is NO ceiling branch on reads —
 * replaying never creates a thread, so `listThreads` is never consulted and
 * the write-path `thread_limit` reason is unrepresentable here.
 *
 * Store errors propagate (fail CLOSED — no try/catch in this module): the
 * caller maps the throw to its generic failure, never `thread_not_found`.
 * Boundary: this resolver answers ownership+existence only. The caller's
 * subsequent `recall` MUST still always pass `resourceId` — the store's own
 * ownership throw stays the belt-and-suspenders layer under this resolution.
 */
export async function resolveOwnedExistingThread({
  memory,
  threadId,
  resource,
}: {
  memory: Pick<AiChatOwnershipMemory, "getThreadById">
  threadId: string
  resource: string
}): Promise<AiChatOwnedThreadResolution> {
  const thread = await memory.getThreadById({ threadId })
  if (thread === null) return { ok: false, reason: "thread_not_found" }
  return thread.resourceId === resource
    ? { ok: true }
    : { ok: false, reason: "thread_forbidden" }
}
