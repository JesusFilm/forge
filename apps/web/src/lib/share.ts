// Share URL builders extracted from ShareModal so the public Watch link,
// embed snippet, and social intent shapes can be unit-tested independently of
// the modal UI.

import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
  parseWatchPath,
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchVideoPath,
} from "./routes"
import { normalizePublicShareableOrigin } from "./url"

export type ResolveWatchShareUrlInput = {
  origin: string
  videoSlug: string
  languageSlug: string
}

/**
 * Build the standalone public Watch URL used by Copy Link and social intents.
 *
 * Public deployment origins remain environment-aware. Literal local/private
 * origins fall back to the indexed public host so a local browser never copies
 * a localhost-only link. Invalid content identity returns null rather than
 * sharing the Watch root or emitting a malformed path.
 */
export function resolveWatchShareUrl({
  origin,
  videoSlug,
  languageSlug,
}: ResolveWatchShareUrlInput): string | null {
  const slug = tryAsContentSlug(videoSlug)
  const lang = tryAsLocaleSlug(languageSlug)
  if (!slug || !lang) return null

  const normalizedOrigin =
    normalizePublicShareableOrigin(origin) ?? WATCH_PUBLIC_METADATA_ORIGIN

  return `${normalizedOrigin}${WATCH_BASE_PATH}${watchVideoPath(slug, lang)}`
}

/**
 * Resolve a browser pathname to the standalone public identity used by Share.
 * Contextual episode routes intentionally share the episode, not its parent.
 */
export function resolveWatchShareUrlFromPathname({
  origin,
  pathname,
}: {
  origin: string
  pathname: string
}): string | null {
  const watchPathname =
    pathname === WATCH_BASE_PATH
      ? "/"
      : pathname.startsWith(`${WATCH_BASE_PATH}/`)
        ? pathname.slice(WATCH_BASE_PATH.length)
        : pathname
  const normalizedWatchPathname = watchPathname.startsWith("/")
    ? watchPathname
    : `/${watchPathname}`
  const parsed = parseWatchPath(normalizedWatchPathname)

  if (parsed.kind === "video") {
    return resolveWatchShareUrl({
      origin,
      videoSlug: parsed.slug,
      languageSlug: parsed.lang,
    })
  }
  if (parsed.kind === "episode") {
    return resolveWatchShareUrl({
      origin,
      videoSlug: parsed.episode,
      languageSlug: parsed.lang,
    })
  }
  if (parsed.kind === "reserved" || parsed.kind === "unknown") return null

  const normalizedOrigin =
    normalizePublicShareableOrigin(origin) ?? WATCH_PUBLIC_METADATA_ORIGIN
  const suffix = parsed.kind === "home" ? "" : normalizedWatchPathname
  return `${normalizedOrigin}${WATCH_BASE_PATH}${suffix}`
}

// Mux playback ids are URL-safe (alphanumeric + `_-`), and currently 8-64
// characters in practice. Validating before interpolation prevents an
// attacker-controlled value from breaking out of the iframe `src` attribute
// — anything outside this character class is rejected and the embed UI is
// hidden upstream.
export const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Build the responsive iframe snippet pointing at player.mux.com/{playbackId}.
 *
 * Returns `""` for a null/invalid playback id. The wrapper uses inline styles
 * (no `<style>` block, no class names) so the snippet is safe to paste inside
 * a partner page that itself wraps content in `<style>` — a literal `</style>`
 * close tag inside the snippet would otherwise terminate the partner's outer
 * style block. The 16:9 aspect ratio is established by modern CSS
 * `aspect-ratio: 16/9` (Baseline 2021, supported in every evergreen browser),
 * which replaces the older `:after { padding-top: 56.25% }` intrinsic-ratio
 * hack that required a stylesheet. The iframe absolute-fills the container
 * and uses vendor-prefixed `allowfullscreen` for older WebKit/Gecko hosts and
 * inline `border:0` to replace the deprecated `frameborder` attribute.
 */
export function buildEmbedSnippet(
  playbackId: string | null | undefined,
): string {
  if (!playbackId) return ""
  if (!PLAYBACK_ID_PATTERN.test(playbackId)) return ""
  return `<div style="position:relative;display:block;margin:10px auto;width:100%;aspect-ratio:16/9"><iframe src="https://player.mux.com/${playbackId}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe></div>`
}

/** Facebook share-intent URL. */
export function buildFbShareUrl(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
}

/**
 * X (formerly Twitter) share-intent URL. x.com is the canonical host now;
 * the /intent/tweet path still works and is what the platform itself links
 * to for share buttons.
 */
export function buildXShareUrl(url: string, title?: string | null): string {
  return `https://x.com/intent/tweet?url=${encodeURIComponent(url)}${
    title ? `&text=${encodeURIComponent(title)}` : ""
  }`
}
