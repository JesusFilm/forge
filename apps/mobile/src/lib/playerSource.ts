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
