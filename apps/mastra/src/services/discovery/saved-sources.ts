import type { Platform } from "./candidate"
import {
  fetchSavedSources,
  type SourcesConfig,
  type FetchSavedSourcesOptions,
} from "./sources-client"

/**
 * Best-effort load of the website's saved trusted-source values for a platform.
 * The status distinguishes an intentionally unconfigured source list from an
 * upstream failure so scheduled workflows can avoid reporting a missed run as
 * a successful empty discovery.
 */
export type SavedSourceLoadResult = {
  values: string[]
  status: "not_configured" | "loaded" | "failed"
}

type LoadSavedSourceOptions = {
  config?: SourcesConfig | null
  fetchImpl?: FetchSavedSourcesOptions["fetchImpl"]
}

export async function loadSavedSourceValuesResult(
  platform: Platform,
  options: LoadSavedSourceOptions,
): Promise<SavedSourceLoadResult> {
  if (!options.config) return { values: [], status: "not_configured" }
  try {
    const sources = await fetchSavedSources(platform, {
      ...options.config,
      fetchImpl: options.fetchImpl,
    })
    return { values: sources.map((s) => s.value), status: "loaded" }
  } catch (error) {
    console.error(
      `[discovery] event=saved_sources_failed platform=${platform} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return { values: [], status: "failed" }
  }
}

export async function loadSavedSourceValues(
  platform: Platform,
  options: LoadSavedSourceOptions,
): Promise<string[]> {
  return (await loadSavedSourceValuesResult(platform, options)).values
}

/**
 * Classify a saved YouTube source value as a playlist or a channel reference.
 * Playlists: a `list=` URL param, or a bare playlist id (PL…/UU…/UULF…/UUSH…/
 * FL…/OL…). Everything else (channel URL, @handle, UC… id) is a channel.
 */
export function classifyYouTubeSource(value: string): "playlist" | "channel" {
  const v = value.trim()
  if (/[?&]list=/.test(v)) return "playlist"
  if (/(^|\/)(PL|UU|UULF|UUSH|FL|OL)[\w-]{10,}$/.test(v)) return "playlist"
  return "channel"
}

export type NormalizedYouTubeSource = {
  kind: "playlist" | "channel"
  value: string
}

/**
 * Convert the supported website source formats to the exact values accepted by
 * YouTube Data API. Custom legacy channel URLs do not carry a stable API id or
 * handle, so callers drop them rather than sending an invalid `@https://...`.
 */
export function normalizeYouTubeSource(
  value: string,
): NormalizedYouTubeSource | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const hostname = url.hostname.toLowerCase()
    if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
      return null
    }

    const playlistId = url.searchParams.get("list")?.trim()
    if (playlistId) return { kind: "playlist", value: playlistId }

    const channelMatch = url.pathname.match(/^\/channel\/([^/?#]+)\/?$/i)
    if (channelMatch) return { kind: "channel", value: channelMatch[1]! }

    const handleMatch = url.pathname.match(/^\/(@[^/?#]+)\/?$/)
    if (handleMatch) return { kind: "channel", value: handleMatch[1]! }

    return null
  } catch {
    if (
      /^[a-z][a-z\d+.-]*:/i.test(trimmed) ||
      /(?:^|\/)(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed)
    ) {
      return null
    }
    return {
      kind: classifyYouTubeSource(trimmed),
      value: trimmed,
    }
  }
}

/** Append `extra` to `base`, preserving order and dropping duplicates. */
export function mergeUnique(
  base: string[],
  extra: string[],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const seen = new Set(base)
  const out = [...base]
  for (const item of extra) {
    if (out.length >= limit) break
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}
