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

    const hostname = parsed.hostname.toLowerCase()
    if (hostname === "localhost") return null
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
