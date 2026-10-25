// Pure, React-free helpers for the per-search watch_search Log, extracted from
// the search hook so the correlation-id fallback and outcome selection are
// unit-testable (the emit itself stays in search.ts with the Datadog wrapper).

/** Maps a resolved (non-error) result count to the watch_search outcome. */
export function resolveWatchSearchOutcome(
  resultCount: number,
): "no_result" | "completed" {
  return resultCount === 0 ? "no_result" : "completed"
}

/** Client-side correlation id for one search request (mirrors web's
 *  search_request_id). Runtime UUID when present, else an RFC4122 v4 fallback —
 *  Hermes lacks crypto.randomUUID and we add no dependency. */
export function generateSearchRequestId(): string {
  const runtimeCrypto = (
    globalThis as { crypto?: { randomUUID?: () => string } }
  ).crypto
  const uuid = runtimeCrypto?.randomUUID?.()
  if (uuid) return uuid
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}
