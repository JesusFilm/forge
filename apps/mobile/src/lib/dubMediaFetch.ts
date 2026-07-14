import type { VariantMedia } from "./normalizeVideo"

export type DubMediaCallbacks = {
  onStart: (id: string) => void
  onSuccess: (id: string, media: VariantMedia) => void
  onError: (id: string) => void
  onSettled: (id: string) => void
}

// Deduplicated retry-on-error fetch for one dub's media. `requested` is the
// dedupe ledger (id present = in-flight/done; FAILED fetch removes its id to retry).
// A sync throw before the promise returns still releases the slot, else id wedges.
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
