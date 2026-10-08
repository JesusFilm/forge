/**
 * Mux provides the same responsive widths and efficient WebP output as the
 * Next optimizer, so generate its srcset directly at the provider. Keep
 * Cloudflare Images on Next's optimizer: named editorial variants can be much
 * larger than the card that displays them.
 */
export function isMuxImageUrl(src: string): boolean {
  try {
    const { hostname, protocol } = new URL(src)
    return protocol === "https:" && hostname === "image.mux.com"
  } catch {
    return false
  }
}

export function muxImageLoader({ src, width }: { src: string; width: number }) {
  const url = new URL(src)
  const sourceWidth = Number(url.searchParams.get("width"))
  const sourceHeight = Number(url.searchParams.get("height"))
  url.pathname = url.pathname.replace(/\.(?:jpe?g|png)$/i, ".webp")
  url.searchParams.set("width", String(width))
  if (sourceWidth > 0 && sourceHeight > 0) {
    url.searchParams.set(
      "height",
      String(Math.max(1, Math.round((width * sourceHeight) / sourceWidth))),
    )
  }
  return url.toString()
}
