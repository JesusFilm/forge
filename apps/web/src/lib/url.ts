// Shared URL helpers for share-intent fallbacks.
//
// Facebook's URL scraper rejects localhost / private hosts, which empties the
// composer when share buttons fire from a dev build. The public canonical is
// what end users would actually see for the page anyway, so we substitute it
// whenever the configured origin is unreachable from the public internet.
// Twitter/X is more permissive but still benefits from a real URL preview.

export const PUBLIC_SHARE_FALLBACK_ORIGIN = "https://jesusfilm.org"

// Mirrors RFC1918 ranges plus link-local. We accept a small false-positive risk
// (e.g. legitimate 10.0.0.0/8 deployments) in exchange for never sending FB a
// URL its scraper can't reach.
const PRIVATE_IPV4_PATTERN = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/

export function isPublicShareableOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    if (hostname === "localhost" || hostname === "127.0.0.1") return false
    if (hostname.endsWith(".local")) return false
    if (hostname === "0.0.0.0") return false
    // IPv6 loopback: URL("http://[::1]:3000").hostname returns "[::1]" in
    // browsers and Node, but bare "::1" can also appear if the URL was
    // pre-stripped — treat both as non-public.
    if (hostname === "[::1]" || hostname === "::1") return false
    if (PRIVATE_IPV4_PATTERN.test(hostname)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a usable poster URL for a watch-page video image.
 *
 * Priority order:
 *   1. mobileCinematicHigh (curated cinematic still, large)
 *   2. mobileCinematicLow  (curated cinematic still, small)
 *   3. thumbnail           (thumbnail crop)
 *   4. Mux fallback when `muxPlaybackId` is provided — a frame from the
 *      video, not a curated poster, but always available.
 *   5. null
 *
 * The raw `images[].url` field from Strapi is intentionally NOT in the
 * fallback chain: that value is a misshaped Cloudflare Images URL (missing
 * the variant path segment) and returns 400 from Cloudflare, so including
 * it as a "last resort" only ever produces broken images.
 */
export function resolvePosterUrl(
  image:
    | {
        mobileCinematicHigh?: string | null
        mobileCinematicLow?: string | null
        thumbnail?: string | null
        url?: string | null
      }
    | null
    | undefined,
  muxPlaybackId?: string | null,
): string | null {
  const editorial =
    image?.mobileCinematicHigh ??
    image?.mobileCinematicLow ??
    image?.thumbnail ??
    null
  if (editorial) return editorial
  return resolveMuxFrameThumbnailUrl(muxPlaybackId)
}

export function resolveMuxFrameThumbnailUrl(
  muxPlaybackId: string | null | undefined,
): string | null {
  const playbackId = muxPlaybackId?.trim()
  if (!playbackId) return null
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2`
}

function resolveDownloadEditorialPosterUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== "imagedelivery.net") return url

    const segments = parsed.pathname.split("/")
    const transformations = segments.at(-1)?.split(",")
    if (
      transformations == null ||
      !transformations.some((value) => /^w=\d+$/.test(value)) ||
      !transformations.some((value) => /^h=\d+$/.test(value))
    ) {
      return url
    }

    segments[segments.length - 1] = transformations
      .map((value) => {
        if (/^w=\d+$/.test(value)) return "w=1280"
        if (/^h=\d+$/.test(value)) return "h=720"
        return value
      })
      .join(",")
    parsed.pathname = segments.join("/")
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Resolve the poster used by the full-width mobile download modal.
 *
 * Card thumbnails intentionally stay capped at 448px. The modal can occupy
 * roughly 390 CSS pixels on a 3x display, so it needs a larger source to avoid
 * browser upscaling. Prefer the selected Dub's frame so the asset can be
 * requested at the required resolution. Videos without Mux playback can carry
 * Cloudflare delivery URLs whose transformation is fixed at 120x68; request a
 * 1280x720 derivative from the same original instead of letting Next/Image
 * upscale that tiny response. Other editorial providers remain untouched.
 */
export function resolveDownloadPosterUrl(
  image: Parameters<typeof resolvePosterUrl>[0],
  muxPlaybackId?: string | null,
): string | null {
  const playbackId = muxPlaybackId?.trim()
  if (!playbackId) {
    const editorial = resolvePosterUrl(image)
    return editorial ? resolveDownloadEditorialPosterUrl(editorial) : null
  }
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?width=1280&height=720&fit_mode=smartcrop&time=2`
}

export function resolveMuxAnimatedPreviewUrl(
  muxPlaybackId: string | null | undefined,
): string | null {
  const playbackId = muxPlaybackId?.trim()
  if (!playbackId) return null
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/animated.webp?start=2&end=6&width=448&fps=8`
}

export function resolveMuxHeroPosterUrl(
  muxPlaybackId: string | null | undefined,
): string | null {
  const playbackId = muxPlaybackId?.trim()
  if (!playbackId) return null
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.webp?time=2`
}
