import { createHash, createHmac } from "node:crypto"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import type {
  WatchSearchResponse,
  WatchSearchResult,
} from "../watch-search.service"

const SLUG = /^[a-z0-9_-]+$/
const LANGUAGE = /^[a-z0-9-]+$/
// Match Web: reserve five minutes within the 48-hour verification ceiling.
const TTL_MS = 48 * 60 * 60 * 1000 - 5 * 60 * 1000

/** Mirrors the public card action pathname, excluding subtitle query metadata. */
export function watchSearchSurfaceItemPath(
  result: WatchSearchResult,
  targetLanguageSlug: string,
): string | null {
  if (
    result.type !== "video" ||
    !result.id ||
    !result.title ||
    !SLUG.test(result.slug)
  )
    return null
  const availability = result.availability.kind
  const language =
    availability === "unavailable"
      ? targetLanguageSlug
      : (result.action.hrefLanguageSlug ??
        (availability === "target_subtitle" ? null : result.languageSlug))
  if (!language || !LANGUAGE.test(language)) return null
  if (
    availability === "target_subtitle" &&
    (!result.availability.languageSlug ||
      !LANGUAGE.test(result.availability.languageSlug))
  )
    return null
  const path =
    availability === "unavailable"
      ? `/watch/${result.slug}.html/${language}.html`
      : `/watch${buildCanonicalWatchVideoPath(result.slug, language)}`
  return path.length <= 512 ? path : null
}

/** Signing a trusted result page writes no measurement facts or request identity. */
export function signWatchSearchSurfaceManifest(
  response: WatchSearchResponse,
  token: string | undefined,
  now = Date.now(),
) {
  if (!token || response.results.length > 100) return null
  const items: { position: number; itemPath: string }[] = []
  for (const [position, result] of response.results.entries()) {
    const itemPath = watchSearchSurfaceItemPath(
      result,
      response.languageInterpretation.targetLanguageSlug,
    )
    if (!itemPath) return null
    items.push({ position, itemPath })
  }
  const config = {
    surface: "watch-search",
    block: "results",
    presentation: "result-list",
    placement: "search-results",
  } as const
  const sourcePayload = JSON.stringify([
    config.surface,
    config.block,
    config.presentation,
    config.placement,
    items.map((item) => [item.position, item.itemPath]),
  ])
  const sourceVersion = createHash("sha256").update(sourcePayload).digest("hex")
  const expiresAt = new Date(now + TTL_MS).toISOString()
  const manifest = {
    ...config,
    policyVersion: "watch-exposure-v2" as const,
    items,
    sourceVersion,
    expiresAt,
  }
  const signature = createHmac("sha256", token)
    .update(
      JSON.stringify([
        "watch-public-surface-manifest-v2",
        sourcePayload,
        manifest.policyVersion,
        sourceVersion,
        expiresAt,
      ]),
    )
    .digest("base64url")
  return { manifest, signature }
}
