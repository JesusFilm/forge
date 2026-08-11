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
import {
  loadContinueWatching,
  updateContinueWatching,
  type ContinueWatchingEntry,
} from "./continueWatching"
import {
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
 */
export async function syncContinueWatchingWithAccount(): Promise<void> {
  try {
    await submitContinueWatchingToAccount(await loadContinueWatching())
  } catch {
    // Best-effort — the hydrate below is still worth attempting.
  }
  await hydrateContinueWatchingFromAccount()
}
