export type PlaybackDiscoverySource =
  | "direct"
  | "search"
  | "share"
  | "acquisition"
  | "editorial"

export type PlaybackDiscoveryContext = Readonly<{
  source: PlaybackDiscoverySource
  provenance: Readonly<Record<string, string>>
}>

export function consumePlaybackDiscoveryContext(
  _mediaId: string,
  input: { search?: string } = {},
): PlaybackDiscoveryContext {
  const search =
    input.search ?? (typeof location === "undefined" ? "" : location.search)
  const params = new URLSearchParams(search)
  if (params.get("playback_source") === "search") {
    return { source: "search", provenance: { handoff: "search_result" } }
  }
  if (params.get("playback_source") === "share") {
    return { source: "share", provenance: { handoff: "shared_link" } }
  }
  if (params.get("playback_source") === "editorial") {
    return { source: "editorial", provenance: { handoff: "curated_link" } }
  }
  if (
    ["utm_source", "utm_campaign", "gclid", "fbclid"].some((key) =>
      params.has(key),
    )
  ) {
    return { source: "acquisition", provenance: { handoff: "campaign_link" } }
  }
  return { source: "direct", provenance: {} }
}

export function markWatchUrlAsShared(url: string): string {
  return markWatchUrlForPlaybackSource(url, "share")
}

export function markWatchUrlForPlaybackSource(
  url: string,
  source: Extract<PlaybackDiscoverySource, "search" | "share" | "editorial">,
): string {
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(url)
  const value = new URL(url, "https://watch.jesusfilm.org")
  value.searchParams.set("playback_source", source)
  return absolute
    ? value.toString()
    : `${value.pathname}${value.search}${value.hash}`
}
