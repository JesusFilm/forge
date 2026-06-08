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
// The whole dispatch is wrapped so ANY synchronous failure — from onStart,
// from fetchMedia itself, or from attaching the promise chain (a non-thenable
// return value, or a `.then` that throws) — is treated as a failed attempt.
// The catch releases the ledger slot and fires onError/onSettled
// unconditionally; if the synchronous path got far enough to hand control to
// the async chain, that chain (not the catch) owns release/onError on rejection,
// so there is exactly one release per outcome and no double-fire.
export function ensureDubMedia(
  id: string | null | undefined,
  requested: Set<string>,
  fetchMedia: (id: string) => Promise<VariantMedia>,
  cb: DubMediaCallbacks,
): void {
  if (!id) return
  if (requested.has(id)) return
  requested.add(id)
  try {
    cb.onStart(id)
    // If fetchMedia returns a non-thenable, `.then` throws synchronously and is
    // caught below — so a post-`dispatched` wedge can't happen: the async chain
    // only owns the outcome once it is fully attached without throwing.
    fetchMedia(id)
      .then((media) => cb.onSuccess(id, media))
      .catch(() => {
        requested.delete(id)
        cb.onError(id)
      })
      .finally(() => cb.onSettled(id))
  } catch {
    // Any synchronous failure on the dispatch path: the async chain never took
    // over, so release the slot here and report the failure.
    requested.delete(id)
    cb.onError(id)
    cb.onSettled(id)
  }
}
