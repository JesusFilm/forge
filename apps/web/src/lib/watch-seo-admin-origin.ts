/** Browser navigation uses the public Admin endpoint, never server transport. */
export function watchSeoAdminOrigin(
  publicGraphqlUrl: string,
  production: boolean,
): string | null {
  try {
    const url = new URL(publicGraphqlUrl)
    const host = url.hostname.toLowerCase().replace(/\.$/, "")
    if (url.username || url.password || url.search || url.hash) return null
    if (url.protocol !== "https:" && !(url.protocol === "http:" && !production))
      return null
    if (
      host.endsWith(".internal") ||
      host === "auth.jesusfilm.org" ||
      (production &&
        (host.endsWith(".local") ||
          host.endsWith(".localhost") ||
          host === "localhost" ||
          !host.includes(".") ||
          /^[\d.]+$/.test(host) ||
          host.includes(":")))
    )
      return null
    return url.origin
  } catch {
    return null
  }
}
