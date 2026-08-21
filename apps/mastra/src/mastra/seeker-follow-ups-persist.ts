/**
 * Follow-up question persistence (feat-366 U1 — KTD2, KTD6).
 *
 * Writes one turn's generated questions into the stored assistant message's
 * `content.metadata` under `seekerFollowUps`, via `Memory.updateMessages`
 * (@mastra/memory 1.24.0: `{ messages: [{ id, content }] }`, content
 * DEEP-MERGES — `parts` and sibling metadata keys survive; a dist fact with
 * no other repo caller, pinned by the real-Postgres smoke; re-verify on
 * `@mastra/*` bumps. Verified by dist read 2026-08-18 against @mastra/pg
 * 1.18.1: the store spreads existing content before merging metadata, and
 * its per-message UPDATE is `WHERE id = $n` with NO thread/resource
 * predicate — which is exactly why the client-side ownership re-check below
 * is the only ownership control on this write).
 *
 * VECTOR-STORE COUPLING (review, 2026-08-20 — latent today, do not remove):
 * this metadata-only payload carries no `content.content` string and no text
 * `parts`, so @mastra/memory 1.24.0 derives a null `textForEmbedding` for it.
 * Whenever the Memory has a vector store AND `semanticRecall` is on, the id
 * joins `messageIdsWithClearedContent` and the row's EMBEDDINGS ARE DELETED
 * with no re-embed. ai-chat's Memory is storage-only today (no vector, no
 * embedder — see `ai-chat-memory.ts`), so nothing is broken; the hazard is
 * invisible from the switch that would turn it on, which is why it is
 * recorded here and beside that decision.
 *
 * The write carries NO `parts` — the load-bearing KTD2 invariant: stored
 * parts are replayed to the provider on later turns, and a fabricated
 * tool-invocation part was observed live to 400 the gateway ("assistant tool
 * call requires id"), breaking every subsequent turn in the thread.
 *
 * Carrier resolution: the questions attach to the message REPLAY will read
 * them from — the trailing assistant run's LAST text-bearing message (the
 * feat-329 turn-association rule). The scan recalls one page scoped by the
 * turn's own `threadId` + `resourceId`, then RE-CHECKS the carrier row's own
 * threadId/resourceId client-side before `updateMessages` — which takes bare
 * message ids with no thread scope — failing closed to `no_carrier` on any
 * absence or mismatch (the single-predicate blast-radius law: the store's
 * filter is a dependency-interpreted predicate every test double implements
 * correctly by construction; the erasure CLI's row re-check is the prior
 * art). One short retry covers the finalization race between the stream's
 * end and the store's write.
 *
 * Bounded by its OWN budget, deliberately NOT composed with the request
 * signal (KTD6): the chat proxy aborts upstream immediately after relaying
 * the terminal frame, so composing would abort every persist. A failed or
 * timed-out write costs reload persistence for one turn, nothing else.
 * NEVER throws, never logs — the route logs the returned enum (R9).
 */

import { settleWithinBudget } from "./budgets"
import { SEEKER_FOLLOW_UPS_METADATA_KEY } from "./seeker-follow-ups"

/** Wall-clock bound on the whole persist (scan + retry + write). */
export const FOLLOW_UPS_PERSIST_BUDGET_MS = 3_000

/**
 * Delay before the single carrier-scan retry — a provisional constant for
 * the stream-end → store-write finalization race; the live `persist=`
 * outcome distribution calibrates it after the flag flip.
 */
export const FOLLOW_UPS_PERSIST_RETRY_DELAY_MS = 250

/** One recall page is plenty: the carrier is in the thread's trailing run. */
export const FOLLOW_UPS_CARRIER_SCAN_PAGE_SIZE = 50

/**
 * Persist-side outcome enum. The route adds `skipped` (nothing to persist —
 * gate off, no questions, race loss) and `undelivered` (terminal frame never
 * actually enqueued) before this module is ever called.
 */
export type FollowUpsPersistOutcome =
  | "persisted"
  | "no_carrier"
  | "store_failed"
  | "timeout"

/** Narrow Memory surface (structural so tests fake it; the real ai-chat
 * Memory satisfies it). */
export type FollowUpsPersistMemory = {
  recall: (args: {
    threadId: string
    resourceId: string
    perPage: number
  }) => Promise<{ messages: unknown[] }>
  updateMessages: (args: {
    messages: Array<{
      id: string
      content: { metadata: Record<string, unknown> }
    }>
  }) => Promise<unknown>
}

type CarrierRow = { id: string }

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

/** Whether a stored row carries non-empty text (the replay carrier rule). */
function isTextBearing(candidate: unknown): boolean {
  if (typeof candidate !== "object" || candidate === null) return false
  const content = (candidate as { content?: unknown }).content as
    | { parts?: unknown }
    | null
    | undefined
  if (!content || !Array.isArray(content.parts)) return false
  for (const part of content.parts) {
    if (typeof part !== "object" || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (
      p.type === "text" &&
      typeof p.text === "string" &&
      p.text.trim().length > 0
    ) {
      return true
    }
  }
  return false
}

/**
 * Resolve the carrier from one recalled page (chronological order — the
 * pinned recall contract): walk backwards across the TRAILING assistant run
 * only; the first text-bearing assistant row found is the run's LAST
 * text-bearing message. Any non-assistant row ends the walk, and the
 * ownership re-check runs here, on the row itself.
 *
 * TURN IDENTITY — the walk is bounded on BOTH sides, because POSITION ALONE
 * CANNOT distinguish this turn's answer from a neighbour's (review, 2026-08-20):
 *
 *  - LOWER (`turnStartedAtMs`). When the store LAGS the stream end, the
 *    trailing row is the PREVIOUS turn's answer; the scan would "find" it and
 *    the retry (which only fires on not-found) could never fire. A
 *    text-bearing candidate whose `createdAt` predates the turn's start — or
 *    cannot be parsed — rejects the scan, letting the retry wait for the
 *    fresh row.
 *  - UPPER (`turnEndedAtMs`). The role rung does NOT close the newer-turn
 *    case, and an earlier version of this docstring wrongly claimed it did: a
 *    NEWER turn's answer sits LATER in the list than the user row that would
 *    have stopped the walk, so the backwards walk reaches the newer ANSWER
 *    first and returns it before ever seeing that user row. A candidate
 *    created after the turn's end therefore rejects too.
 *
 * Both bounds fail CLOSED to not-found — never a stale or forward attach.
 * Same-process clocks throughout: the route captures both timestamps itself
 * (start before the agent run, end just before this persist), so this turn's
 * rows always stamp inside the window.
 *
 * WHAT THE BOUNDS DO NOT CLOSE (security review, 2026-08-20 — read this before
 * treating the window as a complete fix). They NARROW concurrent-turn
 * mis-attach; they do not eliminate it. A neighbouring turn that both started
 * and finished while this turn was still generating chips lands INSIDE
 * `[turnStartedAtMs, turnEndedAtMs]` and passes both rungs. The blast radius
 * of that case stays inside the same `threadId` + `resourceId`, because the
 * ownership re-check below is unchanged and is still the last rung before the
 * only success return — so the worst case is same-user, same-thread
 * mis-attribution, never a cross-subject write. Both comparisons are also
 * deliberately EXCLUSIVE (`<` / `>`): a row stamped exactly on either
 * timestamp passes. Same-process clock on both ends and a 1 ms window make
 * that the right direction; it is recorded here so it reads as a decision
 * rather than an unexamined `<` vs `<=`.
 */
function resolveCarrier(
  messages: unknown[],
  threadId: string,
  resourceId: string,
  turnStartedAtMs?: number,
  turnEndedAtMs?: number,
): CarrierRow | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i]
    if (typeof candidate !== "object" || candidate === null) return null
    const row = candidate as {
      id?: unknown
      role?: unknown
      threadId?: unknown
      resourceId?: unknown
      createdAt?: unknown
    }
    if (row.role !== "assistant") return null
    if (!isTextBearing(candidate)) continue
    if (turnStartedAtMs !== undefined || turnEndedAtMs !== undefined) {
      const createdAtMs =
        row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : typeof row.createdAt === "string"
            ? Date.parse(row.createdAt)
            : Number.NaN
      if (Number.isNaN(createdAtMs)) return null
      if (turnStartedAtMs !== undefined && createdAtMs < turnStartedAtMs) {
        return null
      }
      if (turnEndedAtMs !== undefined && createdAtMs > turnEndedAtMs) {
        return null
      }
    }
    // Client-side ownership re-check (fail closed): the row the store
    // returned must itself claim the turn's thread AND resource.
    const id = readString(row.id)
    if (
      id === null ||
      readString(row.threadId) !== threadId ||
      readString(row.resourceId) !== resourceId
    ) {
      return null
    }
    return { id }
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Persist one turn's questions. Returns the outcome enum; NEVER throws.
 * See the module header for the carrier rule, the ownership re-check, and
 * why the budget is deliberately signal-free.
 */
export async function persistSeekerFollowUps(input: {
  memory: FollowUpsPersistMemory
  threadId: string
  resourceId: string
  questions: string[]
  /** The turn's start timestamp (ms) — the carrier scan's LOWER bound, so a
   * lagging store retries instead of attaching to the previous turn's answer
   * (see `resolveCarrier`). Supplied by the route and by the pg smoke. */
  turnStartedAtMs?: number
  /** The turn's end timestamp (ms), captured just before this call — the
   * carrier scan's UPPER bound, so a newer turn's answer can never be
   * attached to (see `resolveCarrier`). Supplied by the route and by the pg
   * smoke; the smoke is the only place this bound meets a REAL stored
   * `createdAt`. */
  turnEndedAtMs?: number
  budgetMs?: number
  retryDelayMs?: number
}): Promise<FollowUpsPersistOutcome> {
  const budgetMs = input.budgetMs ?? FOLLOW_UPS_PERSIST_BUDGET_MS
  const retryDelayMs = input.retryDelayMs ?? FOLLOW_UPS_PERSIST_RETRY_DELAY_MS

  // A LOCAL timeout signal — the persist is deliberately signal-free toward
  // the request (module header); this signal exists only to bound the store.
  const budgetSignal = AbortSignal.timeout(budgetMs)

  // The whole body settles within the budget via the shared budgets.ts
  // helper (which also absorbs the detached work's late rejection), and sits
  // inside try/catch so no store throw — sync or async — can reach the
  // route's drain loop (KTD6).
  try {
    const work = (async (): Promise<FollowUpsPersistOutcome> => {
      let carrier: CarrierRow | null = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await delay(retryDelayMs)
        const { messages } = await input.memory.recall({
          threadId: input.threadId,
          resourceId: input.resourceId,
          perPage: FOLLOW_UPS_CARRIER_SCAN_PAGE_SIZE,
        })
        carrier = resolveCarrier(
          messages,
          input.threadId,
          input.resourceId,
          input.turnStartedAtMs,
          input.turnEndedAtMs,
        )
        if (carrier !== null) break
      }
      if (carrier === null) return "no_carrier"

      // Late-write refusal (review, 2026-08-20): `settleWithinBudget` rejects
      // the CALLER at the budget but does not cancel this detached body, so a
      // scan that overran could otherwise still land its write afterwards —
      // onto a row that may by then belong to a later turn. Re-check the
      // budget between resolving the carrier and writing, and fail closed.
      if (budgetSignal.aborted) return "timeout"

      // Metadata-only write — NO parts (KTD2, load-bearing). The store
      // deep-merges `content`, so sibling metadata keys and `parts` survive;
      // a re-persist for the same turn overwrites this key (last write wins).
      await input.memory.updateMessages({
        messages: [
          {
            id: carrier.id,
            content: {
              metadata: { [SEEKER_FOLLOW_UPS_METADATA_KEY]: input.questions },
            },
          },
        ],
      })
      return "persisted"
    })()

    return await settleWithinBudget(work, budgetSignal)
  } catch {
    return budgetSignal.aborted ? "timeout" : "store_failed"
  }
}
