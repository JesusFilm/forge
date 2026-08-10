/**
 * Progress sync orchestrator (U10): hydrate on launch/sign-in (fail-open,
 * R11), flush the offline queue, and drain buffered recorder intents on
 * KTD5's batch cadence. Deps are injected (network send, storage, session
 * identity) so every decision path is unit-tested without Apollo or native
 * modules; the provider wires the real client and AsyncStorage.
 */

import {
  WATCH_PROGRESS_QUEUE_STORAGE_KEY,
  enqueueProgressWrite,
  parseStoredProgressQueue,
  planQueueFlush,
  serializeProgressQueue,
  type ProgressQueue,
} from "./queue"
import {
  WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY,
  parseStoredProgressSnapshot,
  serializeProgressSnapshot,
} from "./snapshot"
import {
  bufferProgressIntent,
  drainProgressIntents,
  hydrateProgress,
  peekProgressIntents,
  progressIntentKey,
  type ProgressWriteIntent,
  type WatchProgressEntry,
} from "./store"
import { planBatchSend, resolveProgressEntries } from "./syncPlan"

export type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

export type ProgressSyncDeps = {
  /** The signed-in account id, or null. Read fresh at each decision point. */
  getAccountId: () => string | null
  /** Server read of the account's entries. Throws on failure. */
  fetchEntries: () => Promise<WatchProgressEntry[]>
  /**
   * Server batch upsert. Throws on failure. Reports how many entries the
   * server accepted so a silent partial drop is observable — see
   * `reportDroppedWrites`.
   */
  sendUpserts: (
    entries: ProgressWriteIntent[],
  ) => Promise<{ acceptedCount: number }>
  storage: AsyncStorageLike
  now?: () => number
}

export type ProgressSync = ReturnType<typeof createProgressSync>

/**
 * The server silently drops entries it cannot apply: an unresolvable slug, a
 * deleted video, or a submission the staleness guard rejects. Every one of
 * those is permanent or correct, so retrying is wrong — an unresolvable slug
 * would retry forever. What was missing is any signal at all, which is what
 * this logs. Server-side dedupe of two keys onto one video can also shrink
 * the count legitimately, so this is diagnostic, not an error.
 */
function reportDroppedWrites(sent: number, accepted: number) {
  if (accepted >= sent) return
  console.warn(
    `[watch-progress] event=writes_not_applied sent=${sent} accepted=${accepted}`,
  )
}

export function createProgressSync(deps: ProgressSyncDeps) {
  const now = deps.now ?? (() => Date.now())
  /**
   * Tagged with its account: this is the fail-open fallback, so an untagged
   * cache would feed the PREVIOUS account's history into the next account's
   * hydrate whenever their first server read fails (R10).
   */
  let lastGood: {
    accountId: string
    entries: readonly WatchProgressEntry[]
  } | null = null
  let cadence = { lastSentAt: null as number | null }

  /** Only this account's own last-good may be reused. */
  function carryFor(accountId: string): readonly WatchProgressEntry[] | null {
    return lastGood?.accountId === accountId ? lastGood.entries : null
  }

  async function hydrateFromServerInternal(): Promise<void> {
    const accountId = deps.getAccountId()
    if (accountId == null) return
    let outcome: { ok: true; entries: WatchProgressEntry[] } | { ok: false }
    try {
      outcome = { ok: true, entries: await deps.fetchEntries() }
    } catch {
      outcome = { ok: false }
    }
    const resolved = resolveProgressEntries(outcome, carryFor(accountId))
    lastGood = { accountId, entries: resolved.nextLastGood ?? [] }
    // The account may have signed out while the fetch was in flight.
    if (deps.getAccountId() !== accountId) return
    hydrateProgress({ accountId, entries: [...resolved.entries] })
    if (outcome.ok) await persistSnapshot(accountId, resolved.entries)
  }

  async function persistSnapshot(
    accountId: string,
    entries: readonly WatchProgressEntry[],
  ) {
    const blob = serializeProgressSnapshot(accountId, entries, new Date(now()))
    if (blob == null) return
    // The snapshot is a re-derivable paint cache, but this runs inside a
    // fire-and-forget chain — an unguarded reject also skips the flush that
    // follows it, stranding queued writes.
    await deps.storage
      .setItem(WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY, blob)
      .catch(() => {})
  }

  /**
   * The queue is a single storage cell that both persist and flush
   * read-modify-write, from callers that are not otherwise ordered (a
   * foreground flush and a pause-triggered drain overlap routinely). Every
   * queue operation runs through this chain so one cannot clobber the other.
   */
  let queueChain: Promise<unknown> = Promise.resolve()
  function onQueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = queueChain.then(operation, operation)
    queueChain = run.catch(() => undefined)
    return run
  }

  async function readQueue(): Promise<ProgressQueue | null> {
    const raw = await deps.storage
      .getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
      .catch(() => null)
    return parseStoredProgressQueue(raw)
  }

  /** Fold a failed batch into the account-bound queue for a later retry. */
  function persistFailedWrites(
    accountId: string,
    intents: readonly ProgressWriteIntent[],
  ): Promise<void> {
    if (intents.length === 0) return Promise.resolve()
    return onQueue(async () => {
      // Re-check inside the chain: sign-out may have wiped the queue while
      // this was waiting, and re-creating it would resurrect one account's
      // history on a shared device (R10).
      if (deps.getAccountId() !== accountId) return
      let queue: ProgressQueue = (await readQueue()) ?? {
        accountId,
        writes: [],
      }
      for (const intent of intents) {
        queue = enqueueProgressWrite(queue, accountId, intent)
      }
      const blob = serializeProgressQueue(queue)
      if (blob == null) return
      await deps.storage
        .setItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY, blob)
        .catch(() => {
          // Storage is wedged and the buffer is already drained, so re-buffer
          // rather than lose the batch outright; newer samples still win.
          for (const intent of intents) bufferProgressIntent(intent)
        })
    })
  }

  function flushQueueInternal(): Promise<void> {
    return onQueue(async () => {
      const queue = await readQueue()
      const decision = planQueueFlush(queue, deps.getAccountId())
      if (decision.action === "none") return
      if (decision.action === "discard") {
        await deps.storage
          .removeItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
          .catch(() => {})
        return
      }
      const { acceptedCount } = await deps.sendUpserts(decision.writes)
      reportDroppedWrites(decision.writes.length, acceptedCount)
      // Remove only what was sent: dropping the whole key would discard
      // anything a concurrent failure persisted mid-flight.
      const sent = new Set(decision.writes.map(progressIntentKey))
      const current = await readQueue()
      const remaining = (current?.writes ?? []).filter(
        (write) => !sent.has(progressIntentKey(write)),
      )
      if (current == null || remaining.length === 0) {
        await deps.storage
          .removeItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
          .catch(() => {})
        return
      }
      const blob = serializeProgressQueue({
        accountId: current.accountId,
        writes: remaining,
      })
      if (blob != null) {
        await deps.storage
          .setItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY, blob)
          .catch(() => {})
      }
    }).catch(() => {
      // Send failed: the queue is retained for the next attempt.
    })
  }

  return {
    /**
     * Paint bars from the persisted snapshot before any network — only when
     * it belongs to the signed-in account (a stale other-account snapshot
     * must never paint, KTD8).
     */
    async hydrateFromSnapshot(): Promise<void> {
      const accountId = deps.getAccountId()
      if (accountId == null) return
      const raw = await deps.storage
        .getItem(WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY)
        .catch(() => null)
      const parsed = parseStoredProgressSnapshot(raw, new Date(now()))
      if (parsed == null || parsed.accountId !== accountId) return
      lastGood = { accountId, entries: parsed.entries }
      hydrateProgress({ accountId, entries: parsed.entries })
    },

    /**
     * Server read with the fail-open plan: failure reuses last-good so a
     * blip never blanks bars; an empty success renders empty but keeps the
     * last-good cache (R11/AE5).
     */
    hydrateFromServer: hydrateFromServerInternal,

    /**
     * Flush the offline queue: send when its account matches the signed-in
     * account; discard on mismatch (R7/R10). Send failure keeps the queue
     * for the next reconnect.
     */
    flushQueue: flushQueueInternal,

    /**
     * Drain buffered recorder intents on the batch cadence (KTD5): at most
     * one send per 30-second window, immediate on a forced trigger. A failed
     * send persists to the account-bound queue rather than memory.
     */
    async drainIntents({ forced }: { forced: boolean }): Promise<void> {
      const accountId = deps.getAccountId()
      if (accountId == null) return
      const plan = planBatchSend({
        state: cadence,
        now: now(),
        forced,
        hasIntents: peekProgressIntents().length > 0,
      })
      if (!plan.send) return
      cadence = plan.nextState
      const intents = drainProgressIntents()
      // Backlog FIRST: queued writes are older, so sending them second lets
      // the server's staleness guard reject them and fire a false
      // writes_not_applied. It never throws, so it cannot mask the send below.
      await flushQueueInternal()
      try {
        const { acceptedCount } = await deps.sendUpserts(intents)
        reportDroppedWrites(intents.length, acceptedCount)
      } catch {
        // Persist, not re-buffer: the queue survives an app kill and carries the
        // recording account, so a later sign-in as someone else discards it
        // rather than writing under them (R7/R10).
        await persistFailedWrites(accountId, intents)
      }
    },
  }
}
