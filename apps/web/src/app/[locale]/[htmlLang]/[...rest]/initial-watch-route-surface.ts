import type { WatchRouteSurface } from "@/components/FloatingSearchContext"
import { isPublicWatchHomeLanguageSlug } from "@/lib/locale"
import { stripHtmlSuffix } from "@/lib/url-shape"

export function initialWatchRouteSurface(
  rest: readonly string[],
): WatchRouteSurface | null {
  if (rest.length === 1) {
    const slug = stripHtmlSuffix(rest[0] ?? "")
    return isPublicWatchHomeLanguageSlug(slug) ? "language-home" : "experience"
  }
  if (rest.length === 2 && stripHtmlSuffix(rest[1] ?? "") === "english") {
    return "english-video"
  }
  return null
}
