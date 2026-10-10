// Promotion of anonymous local watch state into a signed-in account (feat-322
// U4.6). React-free and pure at the decision layer, storage I/O through
// safeStorage and best-effort — same conventions as watchEvents.ts /
// continueWatching.ts, whose buckets this module promotes.
//
// This is an ACCOUNT-ISOLATION boundary, not a cache warmup
// (docs/solutions/best-practices/watch-progress-history-user-isolation-pattern-20260702.md).
// A living-room TV is the sharpest version of the hazard the web pattern
// describes: one device, one household, several people, and D4's "one account
// per TV" means the SAME three storage keys are reused by whoever signs in
// next. Three rules follow, and every one of them is load-bearing:
//
//  1. A current-local-user MARKER records who the local buckets belong to.
//     Promotion is decided from the marker, never from "is there data here".
//  2. There are NO per-user buckets to enumerate, deliberately. The web bug was
//     iterating `forge.watch_progress.v1.user.*` and sweeping a previous
//     account's rows into the current one; TV keeps exactly one anonymous
//     bucket set so that iteration has nothing to find. If someone ever adds
//     per-user local buckets here, this whole module has to be re-derived.
//  3. The payload carries a CLAIMED user id and nothing more. Device storage is
//     user-controlled input, so the server re-derives the real subject from the
//     authenticated session and drops the payload when the two disagree. The
//     client must never be the only thing standing between account A's history
//     and account B's profile.

import { getStorage } from "../safeStorage"
import { MY_LIST_STORAGE_KEY, clearMyList } from "../myList/myList"
import {
  CONTINUE_WATCHING_STORAGE_KEY,
  PENDING_COMPLETIONS_STORAGE_KEY,
  clearContinueWatching,
  parseContinueWatching,
  type ContinueWatchingEntry,
} from "../watchEvents/continueWatching"
import {
  QUEUE_STORAGE_KEY,
  VIEWER_ID_STORAGE_KEY,
  flushWatchEventQueue,
  type QueuedWatchEvent,
} from "../watchEvents/watchEvents"

/** Who the local anonymous buckets currently belong to. */
export const LOCAL_USER_STORAGE_KEY = "forge.auth.local_user"

/** Every key holding anonymous watch state. The ONLY enumeration in this
 *  module, and it is a fixed list — never a storage-key scan.
 *  PENDING_COMPLETIONS rides the shelf's locked clear (both are wiped by
 *  `clearContinueWatching`) but is listed so the enumeration stays the
 *  complete, auditable inventory of what a wipe erases. */
export const ANONYMOUS_STATE_KEYS = [
  VIEWER_ID_STORAGE_KEY,
  CONTINUE_WATCHING_STORAGE_KEY,
  PENDING_COMPLETIONS_STORAGE_KEY,
  QUEUE_STORAGE_KEY,
  MY_LIST_STORAGE_KEY,
] as const

export type LocalUserMarker = {
  /** `null` means the local buckets are genuinely unowned (fresh install, or
   *  everything accumulated since the last sign-out). */
  userId: string | null
}

export const UNOWNED_LOCAL_USER: LocalUserMarker = { userId: null }

/**
 * What sign-in should do with the local buckets.
 *
 * - `promote` — unowned state belongs to whoever is signing in now.
 * - `skip`    — this account already merged; promotion is once-only.
 * - `reset`   — the buckets belong to SOMEBODY ELSE. Wipe, promote nothing.
 *
 * `reset` is the family-member case and the reason the marker exists. It is
 * reachable whenever sign-out did not run to completion (force quit, storage
 * failure, a token wiped out from under the app), which on a shared TV is not
 * an edge case.
 */
export type MergeAction = "promote" | "skip" | "reset"

export function decideMergeAction(
  marker: LocalUserMarker,
  userId: string,
): MergeAction {
  if (marker.userId == null) return "promote"
  return marker.userId === userId ? "skip" : "reset"
}

/** Narrows unknown storage content to a marker; anything malformed reads as
 *  unowned, which is the same posture as a fresh install. */
export function parseLocalUserMarker(raw: string | null): LocalUserMarker {
  if (!raw) return UNOWNED_LOCAL_USER
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return UNOWNED_LOCAL_USER
    const userId = (parsed as { userId?: unknown }).userId
    return typeof userId === "string" && userId.length > 0
      ? { userId }
      : UNOWNED_LOCAL_USER
  } catch {
    return UNOWNED_LOCAL_USER
  }
}

// ── Conflict resolution ─────────────────────────────────────────────────────

/**
 * Comparable progress for one entry. Ratio first (it is what the UI shows),
 * falling back to absolute seconds when duration is unknown — comparing a
 * ratio against seconds would make a 40-minute position lose to a 0.9.
 */
function progressRank(entry: ContinueWatchingEntry): {
  ratio: number | null
  seconds: number
} {
  return {
    ratio:
      entry.progress != null && Number.isFinite(entry.progress)
        ? entry.progress
        : null,
    seconds: Number.isFinite(entry.positionSeconds) ? entry.positionSeconds : 0,
  }
}

/** True when `candidate` is strictly further along than `incumbent`. */
function isFurtherAlong(
  candidate: ContinueWatchingEntry,
  incumbent: ContinueWatchingEntry,
): boolean {
  const a = progressRank(candidate)
  const b = progressRank(incumbent)
  if (a.ratio != null && b.ratio != null) return a.ratio > b.ratio
  return a.seconds > b.seconds
}

/**
 * Max-progress-wins reconciliation, keyed on `videoId`.
 *
 * Used two ways: to dedupe the local shelf before it is submitted, and to fold
 * the account's existing rows against the promoted ones. Ties keep the FIRST
 * occurrence, so callers put the side they want to win a tie first — the
 * account's own rows, whose `updatedAt` came from the server.
 */
export function mergeContinueWatching(
  ...groups: readonly (readonly ContinueWatchingEntry[])[]
): ContinueWatchingEntry[] {
  const byVideoId = new Map<string, ContinueWatchingEntry>()
  for (const group of groups) {
    for (const entry of group) {
      const incumbent = byVideoId.get(entry.videoId)
      if (incumbent == null || isFurtherAlong(entry, incumbent)) {
        byVideoId.set(entry.videoId, entry)
      }
    }
  }
  return [...byVideoId.values()]
}

// ── Payload ─────────────────────────────────────────────────────────────────

export type AccountMergePayload = {
  /**
   * The account this promotion CLAIMS to be for. Read from device storage, so
   * the server must compare it against the authenticated session and drop the
   * payload on mismatch — it is a cross-check, never an authorization.
   */
  claimedUserId: string
  /** Anonymous grouping key being promoted. Never a bearer. */
  viewerId: string | null
  continueWatching: ContinueWatchingEntry[]
}

export type AccountMergeOutcome =
  /** Buckets were handed to the server and the marker now names this account. */
  | { status: "promoted"; eventsSubmitted: number; eventsRetained: number }
  /** This account already merged on this device. Once-only, by construction. */
  | { status: "already_merged" }
  /** The buckets belonged to another account and were wiped, not promoted. */
  | { status: "reset_for_other_user" }
  /** Nothing anonymous to promote; the marker still moves to this account. */
  | { status: "nothing_to_promote" }
  /** The server did not accept. Nothing was cleared; a later sign-in retries. */
  | { status: "failed" }

// ── Storage layer (best-effort; a failure must never block sign-in) ─────────

export async function readLocalUserMarker(): Promise<LocalUserMarker> {
  try {
    return parseLocalUserMarker(
      await getStorage().getItem(LOCAL_USER_STORAGE_KEY),
    )
  } catch {
    return UNOWNED_LOCAL_USER
  }
}

export async function writeLocalUserMarker(
  userId: string | null,
): Promise<void> {
  try {
    const storage = getStorage()
    if (userId == null) {
      await storage.removeItem(LOCAL_USER_STORAGE_KEY)
      return
    }
    await storage.setItem(LOCAL_USER_STORAGE_KEY, JSON.stringify({ userId }))
  } catch {
    // Best-effort. A marker that fails to persist re-reads as unowned, which
    // is the permissive direction for the SAME user re-signing-in and the
    // wiping direction for a different one — see the reset path.
  }
}

/**
 * Removes every anonymous bucket. The fixed key list above is the whole
 * enumeration; nothing here scans storage.
 *
 * Returns whether EVERY bucket is confirmed gone. Callers must not advance
 * the marker on a false: the marker is the only thing standing between a
 * surviving shelf and the next account, and since feat-322's account sync a
 * surviving shelf is uploaded, not merely displayed.
 *
 * Continue Watching clears through its own module so the erase takes the
 * shelf lock — a bare `removeItem` can land mid-`saveResumeSnapshot`, whose
 * pending write then restores what was just erased.
 */
export async function clearAnonymousWatchState(): Promise<boolean> {
  const storage = getStorage()
  let cleared = true
  for (const key of ANONYMOUS_STATE_KEYS) {
    if (key === CONTINUE_WATCHING_STORAGE_KEY) {
      // Clears the shelf AND the pending-completions bucket under the shelf
      // lock (both are that module's storage; a bare removeItem could land
      // mid-save and be re-materialized).
      if (!(await clearContinueWatching())) cleared = false
      continue
    }
    if (key === PENDING_COMPLETIONS_STORAGE_KEY) continue // handled above
    if (key === MY_LIST_STORAGE_KEY) {
      // Through its own module for the same reason as the shelf: the erase has
      // to take that module's lock, or a bare removeItem can land mid-toggle
      // and be re-materialized by the pending write — leaving the departing
      // viewer's saved titles on a shared TV.
      if (!(await clearMyList())) cleared = false
      continue
    }
    try {
      await storage.removeItem(key)
    } catch {
      // Best-effort per key: one failure must not skip the rest.
      cleared = false
    }
  }
  return cleared
}

/**
 * Sign-out side of the boundary.
 *
 * Clears the account's local buckets AND releases the marker. Releasing it is
 * what lets the NEXT person's genuinely-anonymous watching promote into THEIR
 * account — and it is only safe because the buckets went with it. Clearing one
 * without the other is the bug in both directions: keep the marker and the next
 * viewer's own history is thrown away; keep the buckets and it is handed to the
 * wrong account.
 *
 * So the release is CONDITIONAL on the wipe. If a bucket survives, the marker
 * keeps naming the departing viewer, which makes the next sign-in take the
 * `reset` branch and wipe again — the shelf is stranded for one session
 * instead of being handed to (and now uploaded into) somebody else's account.
 */
export async function releaseLocalUserOnSignOut(): Promise<void> {
  if (await clearAnonymousWatchState()) {
    await writeLocalUserMarker(null)
  }
}

async function readAnonymousPayload(
  claimedUserId: string,
): Promise<AccountMergePayload> {
  const storage = getStorage()
  let viewerId: string | null = null
  let continueWatching: ContinueWatchingEntry[] = []
  try {
    viewerId = await storage.getItem(VIEWER_ID_STORAGE_KEY)
  } catch {
    // Best-effort.
  }
  try {
    continueWatching = mergeContinueWatching(
      parseContinueWatching(
        await storage.getItem(CONTINUE_WATCHING_STORAGE_KEY),
      ),
    )
  } catch {
    // Best-effort.
  }
  return { claimedUserId, viewerId, continueWatching }
}

/**
 * Promote the anonymous buckets into `userId`, once.
 *
 * Never throws: sign-in must land on the profile screen whatever storage or the
 * network did. A rejected submit leaves every bucket and the marker untouched,
 * so the next sign-in retries — that is the whole retry story, deliberately, as
 * a retry loop here would re-submit into admin's dedupe-less create.
 */
export async function promoteAnonymousStateToAccount(input: {
  userId: string
  /** Sends viewer-id + Continue Watching. Resolve `false` to retain for retry. */
  submitProgress: (payload: AccountMergePayload) => Promise<boolean>
  /**
   * Per-event submitter threaded into `flushWatchEventQueue`, so the queue keeps
   * ITS lock, its oldest-first order and its retain-on-failure semantics rather
   * than growing a second drain here. Omitted → the queue waits for a later
   * flush.
   */
  submitWatchEvent?: (event: QueuedWatchEvent) => Promise<boolean>
}): Promise<AccountMergeOutcome> {
  const { userId, submitProgress, submitWatchEvent } = input
  try {
    const action = decideMergeAction(await readLocalUserMarker(), userId)

    if (action === "skip") return { status: "already_merged" }

    if (action === "reset") {
      // Somebody else's history. It is not promoted, not read, and not left
      // lying around for the next signed-in session to inherit.
      //
      // The marker advances only if the wipe is confirmed. Advancing it after
      // a failed wipe would tell the NEXT sign-in the surviving buckets belong
      // to this account — turning the other viewer's history into ours, which
      // the sync then uploads. Leaving the old marker keeps this branch armed
      // so the next attempt wipes again.
      if (!(await clearAnonymousWatchState())) {
        return { status: "failed" }
      }
      await writeLocalUserMarker(userId)
      return { status: "reset_for_other_user" }
    }

    const payload = await readAnonymousPayload(userId)
    const hasProgress =
      payload.viewerId != null || payload.continueWatching.length > 0

    if (hasProgress && !(await submitProgress(payload))) {
      return { status: "failed" }
    }

    const drained =
      submitWatchEvent != null
        ? await flushWatchEventQueue(submitWatchEvent)
        : { submitted: 0, retained: 0 }

    // The marker moves last: until it does, a crash re-runs the whole promotion
    // rather than silently marking unpromoted history as done.
    await writeLocalUserMarker(userId)

    if (!hasProgress && drained.submitted === 0) {
      return { status: "nothing_to_promote" }
    }
    return {
      status: "promoted",
      eventsSubmitted: drained.submitted,
      eventsRetained: drained.retained,
    }
  } catch {
    return { status: "failed" }
  }
}
