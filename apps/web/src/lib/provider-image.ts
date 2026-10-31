/**
 * Public Mux thumbnails support responsive widths and WebP output, so generate
 * their srcset directly at the provider. Keep
 * Cloudflare Images on Next's optimizer: named editorial variants can be much
 * larger than the card that displays them.
 */
export function isMuxImageUrl(src: string): boolean {
  try {
    const url = new URL(src)
    if (
      url.protocol !== "https:" ||
      url.hostname !== "image.mux.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/[^/]+\/thumbnail\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    )
      return false

    // Do not rewrite signed URLs, other media endpoints, or unknown recipes.
    // Repeated transform keys can also change provider interpretation.
    const keys = [...url.searchParams.keys()]
    if (
      new Set(keys).size !== keys.length ||
      keys.some(
        (key) =>
          !["width", "height", "time", "fit_mode", "quality"].includes(key),
      )
    )
      return false
    for (const key of ["width", "height"]) {
      const value = url.searchParams.get(key)
      if (
        value !== null &&
        (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      )
        return false
    }
    // A lone authored height cannot be scaled proportionally from its width.
    return !url.searchParams.has("height") || url.searchParams.has("width")
  } catch {
    return false
  }
}

/** Keep Admin's pre-generated card derivative byte-for-byte cache-stable. */
export function isAdminMuxCardThumbnail(src: string): boolean {
  try {
    const url = new URL(src)
    return (
      isMuxImageUrl(src) &&
      url.pathname.endsWith("/thumbnail.jpg") &&
      url.searchParams.size === 4 &&
      url.searchParams.get("width") === "448" &&
      url.searchParams.get("height") === "252" &&
      url.searchParams.get("fit_mode") === "smartcrop" &&
      url.searchParams.get("time") === "2"
    )
  } catch {
    return false
  }
}

export function muxImageLoader({ src, width }: { src: string; width: number }) {
  if (
    !isMuxImageUrl(src) ||
    isAdminMuxCardThumbnail(src) ||
    !Number.isFinite(width) ||
    width <= 0
  )
    return src
  const url = new URL(src)
  const sourceWidth = Number(url.searchParams.get("width"))
  const sourceHeight = Number(url.searchParams.get("height"))
  url.pathname = url.pathname.replace(/\.(?:jpe?g|png)$/i, ".webp")
  const outputWidth = Math.min(width, 1_920)
  url.searchParams.set("width", String(outputWidth))
  if (sourceWidth > 0 && sourceHeight > 0) {
    url.searchParams.set(
      "height",
      String(
        Math.max(1, Math.round((outputWidth * sourceHeight) / sourceWidth)),
      ),
    )
  }
  return url.toString()
}
