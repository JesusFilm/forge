/** Current catalog routes are mapping evidence, not historical URL ownership. */
export type WatchRouteCatalogVideo = {
  id: string
  slug: string
  watchRouteIdentity: {
    basis: "current_catalog_cutoff_fenced"
    parentSlugs: readonly string[]
    playableAudioLanguageSlugs: readonly string[]
    truncated: boolean
  }
}

export type WatchRouteMatch =
  | { status: "mapped"; videoId: string }
  | { status: "unmapped" | "ambiguous" | "truncated"; videoId: null }

const segment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

function slug(part: string): string | null {
  const value = part.endsWith(".html") ? part.slice(0, -5) : part
  return segment.test(value) ? value : null
}

export function createWatchRouteMapper(
  catalog: readonly WatchRouteCatalogVideo[],
): (input: string) => WatchRouteMatch {
  const bySlug = new Map<string, WatchRouteCatalogVideo[]>()
  for (const video of catalog) {
    const videos = bySlug.get(video.slug) ?? []
    videos.push(video)
    bySlug.set(video.slug, videos)
  }
  return (input) => {
    if (input.length > 2_000 || !input.startsWith("/watch/"))
      return { status: "unmapped", videoId: null }
    const pathname = input.split(/[?#]/u, 1)[0]!
    const parts = pathname.slice("/watch/".length).split("/")
    if (
      parts.length < 1 ||
      parts.length > 3 ||
      parts.some((part) => !part || part.includes("%"))
    )
      return { status: "unmapped", videoId: null }
    const first = parts[0]!
    if (!first.endsWith(".html")) return { status: "unmapped", videoId: null }
    const parent = slug(first)
    if (!parent) return { status: "unmapped", videoId: null }

    const candidates = new Map<string, WatchRouteCatalogVideo>()
    let incompleteCompetingIdentity = false
    const add = (video: WatchRouteCatalogVideo, language: string) => {
      if (
        video.watchRouteIdentity.playableAudioLanguageSlugs.includes(language)
      )
        candidates.set(video.id, video)
    }
    if (parts.length === 1) {
      incompleteCompetingIdentity = (bySlug.get(parent) ?? []).some(
        (video) => video.watchRouteIdentity.truncated,
      )
      for (const video of bySlug.get(parent) ?? [])
        if (video.slug === parent) add(video, "english")
    } else if (parts.length === 2) {
      const second = parts[1]!
      const child = slug(second)
      // A truncated child may have omitted this parent; a truncated parent
      // may have omitted this language. Either can collide with the route.
      incompleteCompetingIdentity = [
        ...(bySlug.get(parent) ?? []),
        ...(child ? (bySlug.get(child) ?? []) : []),
      ].some((video) => video.watchRouteIdentity.truncated)
      if (second.endsWith(".html")) {
        const language = slug(second)
        if (language)
          for (const video of bySlug.get(parent) ?? [])
            if (video.slug === parent) add(video, language)
      }
      if (child)
        for (const video of bySlug.get(child) ?? [])
          if (
            video.slug === child &&
            video.watchRouteIdentity.parentSlugs.includes(parent)
          )
            add(video, "english")
    } else {
      const child = slug(parts[1]!)
      incompleteCompetingIdentity = child
        ? (bySlug.get(child) ?? []).some(
            (video) => video.watchRouteIdentity.truncated,
          )
        : false
      const language = parts[2]!.endsWith(".html") ? slug(parts[2]!) : null
      if (child && language)
        for (const video of bySlug.get(child) ?? [])
          if (
            video.slug === child &&
            video.watchRouteIdentity.parentSlugs.includes(parent)
          )
            add(video, language)
    }
    if (candidates.size > 1) return { status: "ambiguous", videoId: null }
    if (incompleteCompetingIdentity)
      return { status: "truncated", videoId: null }
    const match = [...candidates.values()][0]
    if (!match) return { status: "unmapped", videoId: null }
    if (match.watchRouteIdentity.truncated)
      return { status: "truncated", videoId: null }
    return { status: "mapped", videoId: match.id }
  }
}

export function mapWatchPathToCatalogVideo(
  input: string,
  catalog: readonly WatchRouteCatalogVideo[],
): WatchRouteMatch {
  return createWatchRouteMapper(catalog)(input)
}
