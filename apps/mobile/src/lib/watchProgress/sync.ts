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
  clearProgressEntry,
  drainProgressIntents,
  hydrateProgress,
  peekProgressIntents,
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
  /** Server per-video clear (R16). Throws on failure. */
  sendClear: (videoId: string) => Promise<void>
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
  let lastGood: readonly WatchProgressEntry[] | null = null
  let cadence = { lastSentAt: null as number | null }

  async function hydrateFromServerInternal(): Promise<void> {
    const accountId = deps.getAccountId()
    if (accountId == null) return
    let outcome: { ok: true; entries: WatchProgressEntry[] } | { ok: false }
    try {
      outcome = { ok: true, entries: await deps.fetchEntries() }
    } catch {
      outcome = { ok: false }
    }
    const resolved = resolveProgressEntries(outcome, lastGood)
    lastGood = resolved.nextLastGood
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
    if (blob != null) {
      await deps.storage.setItem(WATCH_PROGRESS_SNAPSHOT_STORAGE_KEY, blob)
    }
  }

  /** Fold a failed batch into the account-bound queue for a later retry. */
  async function persistFailedWrites(
    accountId: string,
    intents: readonly ProgressWriteIntent[],
  ): Promise<void> {
    if (intents.length === 0) return
    const raw = await deps.storage
      .getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
      .catch(() => null)
    let queue: ProgressQueue = { accountId, writes: [] }
    const stored = parseStoredProgressQueue(raw)
    if (stored != null) queue = stored
    for (const intent of intents) {
      queue = enqueueProgressWrite(queue, accountId, intent)
    }
    const blob = serializeProgressQueue(queue)
    if (blob != null) {
      await deps.storage
        .setItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY, blob)
        .catch(() => {})
    }
  }

  async function flushQueueInternal(): Promise<void> {
    const raw = await deps.storage
      .getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
      .catch(() => null)
    const queue = parseStoredProgressQueue(raw)
    const decision = planQueueFlush(queue, deps.getAccountId())
    if (decision.action === "none") return
    if (decision.action === "discard") {
      await deps.storage.removeItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
      return
    }
    try {
      const { acceptedCount } = await deps.sendUpserts(decision.writes)
      reportDroppedWrites(decision.writes.length, acceptedCount)
      await deps.storage.removeItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
    } catch {
      // Retained for the next flush attempt.
    }
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
      lastGood = parsed.entries
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

    /** Persist a queue built by the recorder's offline path. */
    async saveQueue(queue: ProgressQueue): Promise<void> {
      const blob = serializeProgressQueue(queue)
      if (blob != null) {
        await deps.storage.setItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY, blob)
      }
    },

    async loadQueue(): Promise<ProgressQueue | null> {
      const raw = await deps.storage
        .getItem(WATCH_PROGRESS_QUEUE_STORAGE_KEY)
        .catch(() => null)
      return parseStoredProgressQueue(raw)
    },

    /**
     * Per-video clear (R16): optimistic — the bar disappears immediately;
     * a failed mutation re-hydrates so the entry reappears rather than
     * vanishing permanently (R11's fail-open posture).
     */
    async clearEntry(videoId: string): Promise<void> {
      if (deps.getAccountId() == null) return
      clearProgressEntry(videoId)
      try {
        await deps.sendClear(videoId)
      } catch {
        await hydrateFromServerInternal()
      }
    },

    /**
     * Drain buffered recorder intents on the batch cadence (KTD5): at most
     * one send per 30-second window, immediate on a forced trigger. Failed
     * sends restore the intents (newer buffered ones win).
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
      try {
        const { acceptedCount } = await deps.sendUpserts(intents)
        reportDroppedWrites(intents.length, acceptedCount)
        // A successful send means connectivity is back, so drain any backlog
        // a previous failure persisted (R7's "flush when connectivity
        // returns" — without this it waits for the next sign-in).
        await flushQueueInternal()
      } catch {
        // Persist the failed batch instead of re-buffering it in memory: the
        // queue survives an app kill and carries the recording account, so a
        // later sign-in as someone else discards it rather than writing it
        // under the wrong identity (R7/R10).
        if (deps.getAccountId() === accountId) {
          await persistFailedWrites(accountId, intents)
        }
      }
    },
  }
}
