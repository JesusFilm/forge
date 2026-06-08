// SYNC: ported from apps/mobile/src/lib/dubMediaFetch.ts (no preferences
// coupling — identical logic). The dedupe ledger that keeps the watch session
// from re-fetching a dub's media it already has in flight or completed.

import type { VariantMedia } from "./normalizeVideo"

export type DubMediaCallbacks = {
  onStart: (id: string) => void
  onSuccess: (id: string, media: VariantMedia) => void
  onError: (id: string) => void
  onSettled: (id: string) => void
}

// Fire a deduplicated, retry-on-error fetch for one dub's media. `requested` is
// the dedupe ledger: an id present in it already has a fetch in flight (or done
// successfully), so repeat calls are no-ops; a FAILED fetch removes its id so
// the next call retries. `onStart`/`onSettled` bracket the request for loading
// state; `onError` flags a failure distinct from "loaded, empty".
//
// The whole dispatch is wrapped so a synchronous throw before the promise is
// returned (from onStart or fetchMedia itself) is treated as a failed attempt —
// the ledger slot is released so the id can never wedge into a permanent no-op.
export function ensureDubMedia(
  id: string | null | undefined,
  requested: Set<string>,
  fetchMedia: (id: string) => Promise<VariantMedia>,
  cb: DubMediaCallbacks,
): void {
  if (!id) return
  if (requested.has(id)) return
  requested.add(id)
  let dispatched = false
  try {
    cb.onStart(id)
    const pending = fetchMedia(id)
    dispatched = true
    pending
      .then((media) => cb.onSuccess(id, media))
      .catch(() => {
        requested.delete(id)
        cb.onError(id)
      })
      .finally(() => cb.onSettled(id))
  } catch {
    if (!dispatched) {
      requested.delete(id)
      cb.onError(id)
      cb.onSettled(id)
    }
  }
}
