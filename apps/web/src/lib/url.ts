// Lexical guard for origins a public social crawler cannot reach. Mirrors
// loopback, RFC1918, link-local, and IPv6 local ranges without doing a DNS or
// network reachability probe.
const PRIVATE_IPV4_PATTERN =
  /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/
const PRIVATE_IPV6_PATTERN = /^(::|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/

export function normalizePublicShareableOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    if (parsed.username || parsed.password) return null

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "")
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return null
    if (hostname.endsWith(".local")) return null
    if (hostname === "0.0.0.0") return null
    const ipv6Hostname = hostname.replace(/^\[|\]$/g, "")
    if (PRIVATE_IPV6_PATTERN.test(ipv6Hostname)) return null
    if (PRIVATE_IPV4_PATTERN.test(hostname)) return null
    return parsed.origin
  } catch {
    return null
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

/**
 * Frame thumbnail from a Mux playback id, cropped to a 16:9 card box.
 *
 * `fit_mode=smartcrop` is load-bearing for vertical (9:16) sources: Mux's
 * default `preserve` pads the frame into the requested box, so a 9:16 episode
 * comes back 142x252 and renders as a letterboxed sliver under `object-cover`.
 * Smartcrop returns a filled landscape crop instead.
 *
 * These params are byte-identical to admin's `WATCH_CHAPTER_CAROUSEL_RECIPE`
 * source (`mux-image-derivative.service.ts`), which is the ONLY 16:9 recipe
 * admin pre-generates. Keep them in sync: Mux derivatives are cached per exact
 * URL, so a bespoke width here would miss the warm derivative AND forfeit the
 * matching LQIP that admin exposes as `muxThumbnailBlurDataUrl`.
 */
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
 * Prefer that authored artwork over a frame from the selected Dub; Mux remains
 * the high-resolution fallback when no editorial image is available.
 */
export function resolveDownloadPosterUrl(
  image: Parameters<typeof resolvePosterUrl>[0],
  muxPlaybackId?: string | null,
): string | null {
  const editorial = resolvePosterUrl(image)
  if (editorial) return resolveDownloadEditorialPosterUrl(editorial)

  const playbackId = muxPlaybackId?.trim()
  if (!playbackId) return null
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
