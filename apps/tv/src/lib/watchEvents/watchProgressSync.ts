// Account sync for Continue Watching (feat-322 U4.6 — the real half).
//
// The anonymous shelf (`continueWatching.ts`) stays the single source the UI
// reads; this module moves it across the account boundary in both directions:
//
//   UP   — `submitContinueWatchingToAccount` maps shelf entries onto admin's
//          `upsertMyWatchProgress` (the same mutation mobile writes, so one
//          account row set serves every device).
//   DOWN — `hydrateContinueWatchingFromAccount` folds `myWatchProgress` rows
//          into the local shelf, so a film started on the phone resumes at the
//          phone's position on this TV.
//
// Every decision rule lives in `watchProgressMerge.ts` (pure, jest-covered);
// this module is only the Apollo + session wiring, mirroring the
// `recordWatchEvent.ts` / `recordWatchEventDocument.ts` split.

import { getApolloClient } from "../apolloClient"
import { getValidAccessToken } from "../auth/session"
import { readLocalUserMarker } from "../auth/anonymousMerge"
import { withTimeout } from "../withTimeout"
import {
  loadContinueWatching,
  updateContinueWatching,
  type ContinueWatchingEntry,
} from "./continueWatching"
import {
  mayFlushShelfToAccount,
  mergeAccountRowsIntoShelf,
  parseAccountProgressRows,
  toWatchProgressUpsertEntries,
  type AccountWatchProgressRow,
} from "./watchProgressMerge"
import {
  GET_MY_WATCH_PROGRESS,
  UPSERT_MY_WATCH_PROGRESS,
} from "./watchProgressDocuments"

/**
 * Budget for the sign-out flush. Sign-out is a UI action the viewer is
 * waiting on, and Apollo carries no per-call ceiling of its own, so without
 * this the button hangs for the transport's worst case (~19s) on a bad
 * network. Well under any plausible upstream patience; a flush that misses
 * it simply retries at the next sign-in.
 */
export const SIGN_OUT_FLUSH_TIMEOUT_MS = 4000

/**
 * Push shelf entries into the account. Returns false to signal the caller to
 * RETAIN local state for a later retry — `promoteAnonymousStateToAccount`
 * maps that onto its `failed` outcome, which leaves every bucket untouched.
 *
 * An empty mapped batch is SUCCESS: nothing needed sending, and reporting
 * failure would wedge the promotion marker forever on a shelf whose entries
 * all lack durations.
 */
export async function submitContinueWatchingToAccount(
  entries: readonly ContinueWatchingEntry[],
): Promise<boolean> {
  try {
    const mapped = toWatchProgressUpsertEntries(entries)
    if (mapped.length === 0) return true
    const userAccessToken = await getValidAccessToken()
    if (userAccessToken == null) return false

    const result = await getApolloClient().mutate({
      mutation: UPSERT_MY_WATCH_PROGRESS,
      variables: { entries: mapped },
      // Supplied through context because obtaining it can require an async
      // refresh; the link's allowlist still decides whether it attaches.
      context: { userAccessToken },
      errorPolicy: "all",
    })
    return result.data?.upsertMyWatchProgress != null
  } catch {
    return false
  }
}

/** The account's progress rows, or null when signed out / unreachable. */
export async function fetchAccountWatchProgress(): Promise<
  AccountWatchProgressRow[] | null
> {
  try {
    const userAccessToken = await getValidAccessToken()
    if (userAccessToken == null) return null
    const result = await getApolloClient().query({
      query: GET_MY_WATCH_PROGRESS,
      // Always the server's rows — a cached answer here would resurrect
      // positions another device has since advanced past.
      fetchPolicy: "network-only",
      context: { userAccessToken },
      errorPolicy: "all",
    })
    return parseAccountProgressRows(result.data?.myWatchProgress)
  } catch {
    return null
  }
}

/** Pull the account's rows down and fold them into the local shelf. */
export async function hydrateContinueWatchingFromAccount(): Promise<void> {
  const rows = await fetchAccountWatchProgress()
  if (rows == null || rows.length === 0) return
  await updateContinueWatching((entries) =>
    mergeAccountRowsIntoShelf(entries, rows),
  )
}

/**
 * Full two-way pass: push the current shelf up, then fold the account's rows
 * back down. Ran on every signed-in profile visit so positions recorded since
 * the last visit reach the account without a per-save network pipeline.
 *
 * A failed push ABORTS the pull, deliberately. Hydrating on top of a failed
 * submit lets the account's older view win against local positions that never
 * reached it — and since the local shelf is the only copy of those positions,
 * there would be nothing left to retry with.
 */
export async function syncContinueWatchingWithAccount(): Promise<void> {
  let pushed = false
  try {
    pushed = await submitContinueWatchingToAccount(await loadContinueWatching())
  } catch {
    pushed = false
  }
  if (!pushed) return
  await hydrateContinueWatchingFromAccount()
}

/**
 * Drop the account's rows from the Apollo cache.
 *
 * `clearSession` empties the keychain and `releaseLocalUserOnSignOut` the
 * storage buckets, but the normalized cache is a THIRD copy of the departing
 * viewer's watch history, living in memory for the rest of the process. The
 * reads here are `network-only`, so nothing acts on it today — this is about
 * the copy existing at all on a shared TV, and about the next reader that
 * forgets to pin its fetch policy.
 */
export async function purgeAccountProgressCache(): Promise<void> {
  try {
    await getApolloClient().clearStore()
  } catch {
    // Sign-out has already happened; a cache that refuses to clear must not
    // surface as a failed sign-out.
  }
}

/**
 * The sign-out flush: the shelf's last chance to reach the account before
 * `releaseLocalUserOnSignOut` wipes it for the next viewer.
 *
 * Gated on the ownership marker, which is what makes it safe on a shared TV.
 * An interrupted earlier sign-out can leave one viewer's shelf behind with a
 * marker that no longer names them; without this gate the NEXT viewer's
 * sign-out would upload that history into THEIR account, where the server
 * cannot tell it apart (it derives the subject from the bearer, and the
 * bearer is genuinely theirs).
 *
 * Never throws and never outlasts its budget — sign-out must complete.
 */
export async function flushOwnedShelfOnSignOut(
  userId: string | null | undefined,
): Promise<boolean> {
  try {
    const marker = await readLocalUserMarker()
    if (!mayFlushShelfToAccount(marker.userId, userId)) return false
    return await withTimeout(
      submitContinueWatchingToAccount(await loadContinueWatching()),
      SIGN_OUT_FLUSH_TIMEOUT_MS,
    )
  } catch {
    // Timed out, storage failed, or the network declined. The wipe still
    // proceeds: the account keeps whatever the last successful sync
    // delivered, which is the privacy-preserving direction on a shared TV.
    return false
  }
}
