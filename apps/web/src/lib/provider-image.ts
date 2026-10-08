/**
 * Provider image URLs already encode their output size and format. Sending
 * them through Next's optimizer adds a second fetch/encode hop without
 * improving the delivered asset.
 */
export function shouldBypassNextImageOptimization(src: string): boolean {
  try {
    const { hostname, protocol } = new URL(src)
    return (
      protocol === "https:" &&
      (hostname === "image.mux.com" || hostname === "imagedelivery.net")
    )
  } catch {
    return false
  }
}
