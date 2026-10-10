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

/**
 * Widest hero poster Mux serves from a warm cache. Un-sized, the same URL
 * returns 1920x1080 but takes ~3x as long (652ms against 190ms measured
 * 2026-09-02) because it is not the derivative the watch hero already requests.
 */
export const MUX_HERO_POSTER_MAX_WIDTH = 1280

/**
 * The hero poster at the width `HeroPlayer`'s image loader asks for, in the
 * same parameter order, so the two surfaces agree on one derivative — Mux
 * caches per exact URL. This holds for the direct request (a `<video poster>`
 * attribute, or an unoptimized `<Image>`); a `next/image` request still asks
 * Mux only for this URL, and narrower devices are served by resizing it.
 *
 * Use this for any full-viewport surface. Authored artwork is NOT the better
 * source there: the admin library stores mobile derivatives for these videos
 * (`mobileCinematicHigh` measured 640x300, `videoStill` 480x270), which a
 * full-bleed hero upscales about fourfold. Small surfaces should still prefer
 * the authored image — at card size it has pixels to spare and it is curated.
 */
export function resolveMuxHeroPosterUrlAtMaxWidth(
  muxPlaybackId: string | null | undefined,
): string | null {
  const base = resolveMuxHeroPosterUrl(muxPlaybackId)
  if (!base) return null
  const url = new URL(base)
  url.searchParams.set("width", String(MUX_HERO_POSTER_MAX_WIDTH))
  return url.toString()
}

/**
 * Longest edge a heavily blurred backdrop source needs, and the quality it is
 * requested at.
 */
export const BLURRED_BACKDROP_MAX_WIDTH = 128
const BLURRED_BACKDROP_QUALITY = 50

/**
 * Shrink the source behind a heavily blurred CSS backdrop.
 *
 * `/watch/<lang>.html/videos` paints one `WATCH_IMMERSIVE_BACKDROP_CLASS`
 * backdrop per collection group — 111 of them on the English page — as a CSS
 * `background-image`. CSS backgrounds are not lazy-loaded, and
 * `content-visibility: auto` does NOT defer them either (measured 2026-09-12:
 * all 111 are fetched on load with or without it), so every backdrop on the
 * page downloads during the initial load no matter how far below the fold it
 * sits.
 *
 * Authored artwork arrives from Cloudflare Images at `w=1280,h=600,q=95`,
 * which for this library is a 1.3-1.5 MB PNG apiece. Measured on the live
 * English page at a 390x844x3 viewport with the cache disabled, those 110
 * requests were 27.1 MB of a 29.0 MB page, and they starved the LCP hero: on
 * DevTools "Fast 4G" with 4x CPU throttle, LCP was 8592 ms before this rewrite
 * and 2648 ms after, with 31.4 MB of transfer falling to 4.7 MB.
 *
 * The element is at most ~440 CSS px wide and renders under `blur-2xl`
 * (`blur(40px)`) plus `brightness-50` and `saturate-75`, so a 128px-wide
 * source carries strictly more detail than survives the blur.
 *
 * Only Cloudflare Images URLs carrying an explicit `w=`/`h=` transformation
 * are rewritten, and the aspect ratio is preserved so the crop cannot shift.
 * Mux frame URLs are deliberately returned untouched: they are already the
 * pre-generated 448x252 derivative (~13 KB), and a bespoke width there is a
 * cold on-demand render (see `resolveMuxFrameThumbnailUrl`). Any other host is
 * returned unchanged rather than guessed at — a wrong guess is a broken
 * backdrop, and the no-op is merely the status quo.
 */
export function resolveBlurredBackdropUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.hostname !== "imagedelivery.net") return url

  const segments = parsed.pathname.split("/")
  const transformations = segments.at(-1)?.split(",")
  if (transformations == null) return url

  const width = transformations.find((value) => /^w=\d+$/.test(value))
  const height = transformations.find((value) => /^h=\d+$/.test(value))
  if (width == null || height == null) return url

  const sourceWidth = Number.parseInt(width.slice(2), 10)
  const sourceHeight = Number.parseInt(height.slice(2), 10)
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceHeight <= 0 ||
    sourceWidth <= BLURRED_BACKDROP_MAX_WIDTH
  ) {
    return url
  }

  const scaledHeight = Math.max(
    1,
    Math.round((sourceHeight * BLURRED_BACKDROP_MAX_WIDTH) / sourceWidth),
  )
  const rewritten = transformations.map((value) => {
    if (/^w=\d+$/.test(value)) return `w=${BLURRED_BACKDROP_MAX_WIDTH}`
    if (/^h=\d+$/.test(value)) return `h=${scaledHeight}`
    if (/^q=\d+$/.test(value)) return `q=${BLURRED_BACKDROP_QUALITY}`
    return value
  })
  if (!rewritten.some((value) => value.startsWith("q="))) {
    rewritten.push(`q=${BLURRED_BACKDROP_QUALITY}`)
  }

  segments[segments.length - 1] = rewritten.join(",")
  parsed.pathname = segments.join("/")
  return parsed.toString()
}
