type PlayerSourceInput = {
  offlineSource: string | null
  /** The dub the download holds; null when no download or unknown. */
  offlineDubDocumentId: string | null
  /** Null while the dub selection has not settled for this video. */
  activeVariantHls: string | null
  /** The settled dub's identity; null before it settles or when unknown. */
  activeVariantDocumentId: string | null
  variantSettled: boolean
  recordStreamingUrl: string | null
  seedStreamingUrl: string | null
}

/**
 * The watch screen's one source chain, pure so its precedence is pinned by
 * tests. Order: a completed download beats streaming while the settled dub is
 * the one on disk (see `offlinePlays`); the SETTLED dub beats everything
 * remote; the record-level fallback (`firstPlayable`) applies only once the
 * dub selection has settled; the seed carries playback until then.
 *
 * The settle gate is load-bearing (R4): before the default dub resolves,
 * `activeVariant` is null and the record fallback is `dubs[0]` — for a
 * multi-dub video that is the WRONG language's asset. Publishing it for even
 * one render plays a wrong-language flash on a fresh visit, and on an expand
 * it reads as a dub switch, defeats adoption, and restarts playback.
 */
export function resolvePlayerSource(input: PlayerSourceInput): string | null {
  if (input.offlineSource != null && offlinePlays(input)) {
    return input.offlineSource
  }
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
 * A download is ONE dub. It plays unless the viewer settled on a different
 * dub that has a stream: an unknown identity on either side, or a pick with
 * nothing to stream, keeps the copy on disk rather than playing nothing.
 */
function offlinePlays(
  input: Pick<
    PlayerSourceInput,
    | "offlineDubDocumentId"
    | "activeVariantHls"
    | "activeVariantDocumentId"
    | "variantSettled"
  >,
): boolean {
  if (!input.variantSettled) return true
  if (input.offlineDubDocumentId == null) return true
  if (input.activeVariantDocumentId == null) return true
  if (input.activeVariantDocumentId === input.offlineDubDocumentId) return true
  return input.activeVariantHls == null
}

/**
 * What an offline container swap tells the adapter. A download holds ONE dub,
 * so a swap that also names another language is new audio (the QoE session
 * re-keys); an unknown language on either side keeps the session, because
 * nothing proves the audio changed.
 */
export function offlineSwapClaim(input: {
  previousLanguageSlug: string | null
  nextLanguageSlug: string | null
}): "same-content" | "new-content" {
  const { previousLanguageSlug, nextLanguageSlug } = input
  if (previousLanguageSlug == null || nextLanguageSlug == null)
    return "same-content"
  return previousLanguageSlug === nextLanguageSlug
    ? "same-content"
    : "new-content"
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
 * DUB change (same slug, new language), which is `isDubSwap`'s claim below.
 * The local-ness half is what separates them, and it is validated against the
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

/**
 * Is this source change the SAME video on another audio track — a dub pick
 * mid-play? It keeps the viewer's place like an offline swap, but the asset
 * is new, so quality attribution treats it as new content.
 *
 * Distinct from `releaseTriggersSwap` in `playbackTarget.ts`, which asks only
 * whether two URLs name different assets: this one also requires one video
 * and two remote sides, so a download completing is never read as a dub.
 */
export function isDubSwap(input: {
  previousUrl: string | null
  nextUrl: string | null
  /** The two sources belong to one video — the host's slug-stable videoKey. */
  sameVideo: boolean
  /** `isSameMuxAsset(previousUrl, nextUrl)`: one asset behind two strings. */
  sameAsset: boolean
  /** `validateLocalMediaUrl(url, OFFLINE_ROOT)`, injected to keep this pure. */
  isLocal: (url: string) => boolean
}): boolean {
  const { previousUrl, nextUrl, sameVideo, sameAsset, isLocal } = input
  if (!sameVideo || sameAsset) return false
  if (previousUrl == null || nextUrl == null) return false
  // A non-Mux remote URL carries no asset id, so an unchanged URL would read
  // as a different asset here and arm a latch from a source to itself.
  if (previousUrl === nextUrl) return false
  // A local side is the offline swap's claim, never a dub change.
  return !isLocal(previousUrl) && !isLocal(nextUrl)
}
