/** Explicit local tunnel origin; never changes hosted Shorts authority. */
export function shortsLocalPublicOrigin(
  value = process.env.AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN,
  nodeEnv = process.env.NODE_ENV,
): string | undefined {
  if (!value) return undefined
  if (nodeEnv === "production") {
    throw new Error("AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN is local-only")
  }
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("AUTH_SHORTS_LOCAL_PUBLIC_ORIGIN must be an HTTPS origin")
  }
  return url.origin
}
