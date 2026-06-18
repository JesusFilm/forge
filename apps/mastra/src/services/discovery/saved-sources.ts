import type { Platform } from "./candidate"
import {
  fetchSavedSources,
  type SourcesConfig,
  type FetchSavedSourcesOptions,
} from "./sources-client"

/**
 * Best-effort load of the website's saved trusted-source values for a platform.
 * Returns the raw values (links/handles/playlist ids). NEVER throws — a fetch
 * failure or missing config logs and returns `[]`, so the daily run falls back
 * to whatever Run-form input it was given. Each workflow maps these values into
 * its own trusted inputs (channels/playlists/boards/handles).
 */
export async function loadSavedSourceValues(
  platform: Platform,
  options: {
    config?: SourcesConfig | null
    fetchImpl?: FetchSavedSourcesOptions["fetchImpl"]
  },
): Promise<string[]> {
  if (!options.config) return []
  try {
    const sources = await fetchSavedSources(platform, {
      ...options.config,
      fetchImpl: options.fetchImpl,
    })
    return sources.map((s) => s.value)
  } catch (error) {
    console.error(
      `[discovery] event=saved_sources_failed platform=${platform} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return []
  }
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

/** Append `extra` to `base`, preserving order and dropping duplicates. */
export function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base)
  const out = [...base]
  for (const item of extra) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}
