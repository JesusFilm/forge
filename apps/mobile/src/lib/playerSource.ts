/**
 * The watch screen's one source chain, pure so its precedence is pinned by
 * tests. Order: a completed download beats streaming; the SETTLED dub beats
 * everything remote; the record-level fallback (`firstPlayable`) applies only
 * once the dub selection has settled; the seed carries playback until then.
 *
 * The settle gate is load-bearing (R4): before the default dub resolves,
 * `activeVariant` is null and the record fallback is `dubs[0]` — for a
 * multi-dub video that is the WRONG language's asset. Publishing it for even
 * one render plays a wrong-language flash on a fresh visit, and on an expand
 * it reads as a dub switch, defeats adoption, and restarts playback.
 */
export function resolvePlayerSource(input: {
  offlineSource: string | null
  /** Null while the dub selection has not settled for this video. */
  activeVariantHls: string | null
  variantSettled: boolean
  recordStreamingUrl: string | null
  seedStreamingUrl: string | null
}): string | null {
  if (input.offlineSource != null) return input.offlineSource
  if (input.variantSettled) {
    return (
      input.activeVariantHls ??
      input.recordStreamingUrl ??
      input.seedStreamingUrl
    )
  }
  return input.seedStreamingUrl
}

/**
 * Is this source change the SAME video moving between the network and a
 * completed download, rather than a different video?
 *
 * It cannot be answered with `isSameMuxAsset`: a local file has no Mux
 * playback id, so that predicate is false by construction for every offline
 * swap — which is why one used to restart at 0:00.
 *
 * Two halves, and both are load-bearing. `sameVideo` alone would also match a
 * DUB change (same slug, new language), which must keep restarting. The
 * local-ness half is what separates them, and it is validated against the
 * offline root rather than sniffed, so a `file:` URI from anywhere else is not
 * treated as this app's download.
 */
export function isOfflineContainerSwap(input: {
  previousUrl: string | null
  nextUrl: string | null
  /** The two sources belong to one video — the host's slug-stable videoKey. */
  sameVideo: boolean
  /** `validateLocalMediaUrl(url, OFFLINE_ROOT)`, injected to keep this pure. */
  isLocal: (url: string) => boolean
}): boolean {
  const { previousUrl, nextUrl, sameVideo, isLocal } = input
  if (!sameVideo) return false
  if (previousUrl == null || nextUrl == null) return false
  if (previousUrl === nextUrl) return false
  // Either direction: a download completing (remote -> local) and a download
  // being deleted mid-play (local -> remote) both keep the viewer's place.
  return isLocal(previousUrl) !== isLocal(nextUrl)
}
