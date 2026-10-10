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

// Deduplicated, retry-on-error fetch for one dub's media; `requested` is the
// ledger (in-flight/done = no-op, failed removes its id to allow retry). ANY
// sync failure counts as failed; exactly one release per outcome, no double-fire.
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
