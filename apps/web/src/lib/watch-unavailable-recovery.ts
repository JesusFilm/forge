import { isPublicWatchLanguageSlug } from "./locale"
import { tryAsContentSlug, tryAsLocaleSlug } from "./routes"

export type ParsedUnavailableWatchPath = {
  contentSlug: string
  requestedLanguageSlug: string
}

export function parseUnavailableWatchPath(
  pathname: string,
): ParsedUnavailableWatchPath | null {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 1 && segments[0]?.endsWith(".html")) {
    const contentSlug = tryAsContentSlug(segments[0].slice(0, -5))
    return contentSlug
      ? { contentSlug, requestedLanguageSlug: "english" }
      : null
  }
  if (
    segments.length !== 2 ||
    !segments[0]?.endsWith(".html") ||
    !segments[1]?.endsWith(".html")
  ) {
    return null
  }
  const contentSlug = tryAsContentSlug(segments[0].slice(0, -5))
  const requestedLanguageSlug = tryAsLocaleSlug(segments[1].slice(0, -5))
  if (
    !contentSlug ||
    !requestedLanguageSlug ||
    !isPublicWatchLanguageSlug(requestedLanguageSlug)
  ) {
    return null
  }
  return { contentSlug, requestedLanguageSlug }
}
