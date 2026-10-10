import { parseWatchPath, WATCH_BASE_PATH } from "@/lib/routes"

export const WATCH_RUM_PATH_SHAPES = [
  "root",
  "one-segment",
  "video-language",
  "episode-implicit-english",
  "episode-language",
  "languages",
  "localized-languages",
  "history",
  "localized-history",
  "language-videos",
  "search",
  "reserved",
  "unknown",
] as const

export type WatchRumPathShape = (typeof WATCH_RUM_PATH_SHAPES)[number]

/**
 * Classify a Datadog view URL into a closed, low-cardinality Watch route shape.
 * This uses the event URL so delayed events from prior views keep their route.
 */
export function watchRumPathShape(viewUrl: string): WatchRumPathShape | null {
  try {
    const { pathname } = new URL(viewUrl)
    if (
      pathname !== WATCH_BASE_PATH &&
      !pathname.startsWith(`${WATCH_BASE_PATH}/`)
    ) {
      return null
    }

    const relativePath = pathname.slice(WATCH_BASE_PATH.length) || "/"
    const route = parseWatchPath(relativePath)
    switch (route.kind) {
      case "home":
        return "root"
      case "localized-home":
        return "one-segment"
      case "video":
        return "video-language"
      case "episode":
        return relativePath.split("/").filter(Boolean).length === 2
          ? "episode-implicit-english"
          : "episode-language"
      case "languages":
        return "languages"
      case "localized-languages":
        return "localized-languages"
      case "history":
        return "history"
      case "localized-history":
        return "localized-history"
      case "language-videos":
        return "language-videos"
      case "search":
        return "search"
      case "reserved":
      case "whats-new":
        return "reserved"
      case "unknown":
        return "unknown"
    }
  } catch {
    return null
  }
}
