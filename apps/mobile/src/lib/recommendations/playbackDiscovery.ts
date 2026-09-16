/**
 * How a playback was reached, for `issueWatchPlaybackContext` (feat-516). A
 * surface marks the destination before it navigates (search results mark
 * `search`, an external link marks `share`); the recorder takes the mark when
 * the video opens. Anything unmarked is `direct`, which is Web's default too.
 *
 * Module scope, like the pending claim: the root host that records playback
 * is a `<Stack>` sibling, so no prop or context path reaches it from a tab.
 */
export type PlaybackDiscoverySource =
  | "direct"
  | "search"
  | "share"
  | "editorial"
  | "acquisition"

export type PlaybackDiscovery = {
  source: PlaybackDiscoverySource
  provenance: Record<string, string>
}

/** A mark older than this no longer explains a playback. */
export const DISCOVERY_MARK_TTL_MS = 10 * 60 * 1_000

/** Web's provenance literals per source; `direct` carries none. */
export const DISCOVERY_PROVENANCE: Readonly<
  Record<Exclude<PlaybackDiscoverySource, "direct">, Record<string, string>>
> = {
  search: { handoff: "search_result" },
  share: { handoff: "shared_link" },
  editorial: { handoff: "curated_link" },
  acquisition: { handoff: "campaign_link" },
}

export const DIRECT_DISCOVERY: PlaybackDiscovery = {
  source: "direct",
  provenance: {},
}

/**
 * A list surface (the series page) cannot mark an episode when it opens,
 * because no episode slug is known yet. The surface that opened the list
 * carries how the LIST was reached in this route param instead, and the
 * episode tap marks the episode with it.
 */
export const DISCOVERY_ROUTE_PARAM = "from"

/** The source a route param names; only a search hand-off is valid today. */
export function discoverySourceFromParam(
  value: string | string[] | undefined,
): PlaybackDiscoverySource | null {
  return value === "search" ? "search" : null
}

export function discoveryFor(
  source: PlaybackDiscoverySource,
): PlaybackDiscovery {
  return source === "direct"
    ? DIRECT_DISCOVERY
    : { source, provenance: DISCOVERY_PROVENANCE[source] }
}

export type PlaybackDiscoveryStore = ReturnType<
  typeof createPlaybackDiscoveryStore
>

/**
 * Holds at most one mark. Keys are whatever the marking surface knows (a slug
 * from a search result, an Admin id from a deep link); the recorder offers
 * every key it has, and the first match wins and is consumed.
 */
export function createPlaybackDiscoveryStore(now: () => number = Date.now) {
  let mark: {
    key: string
    source: PlaybackDiscoverySource
    at: number
  } | null = null
  return {
    mark(key: string, source: PlaybackDiscoverySource): void {
      if (!key) return
      mark = { key, source, at: now() }
    },
    take(keys: ReadonlyArray<string | null | undefined>): PlaybackDiscovery {
      if (!mark) return DIRECT_DISCOVERY
      if (now() - mark.at >= DISCOVERY_MARK_TTL_MS) {
        mark = null
        return DIRECT_DISCOVERY
      }
      if (!keys.some((key) => key != null && key === mark?.key)) {
        return DIRECT_DISCOVERY
      }
      const source = mark.source
      mark = null
      return discoveryFor(source)
    },
    clear(): void {
      mark = null
    },
  }
}

let store: PlaybackDiscoveryStore | null = null

export function getPlaybackDiscoveryStore(): PlaybackDiscoveryStore {
  store ??= createPlaybackDiscoveryStore()
  return store
}

/** Convenience for surfaces: mark the destination right before navigating. */
export function markPlaybackDiscovery(
  key: string,
  source: PlaybackDiscoverySource,
): void {
  getPlaybackDiscoveryStore().mark(key, source)
}
