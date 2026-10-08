export function watchPlaybackLinkIntent(
  value: string,
  slug: string,
): "play" | "details" | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== "org.jesusfilm.forgetv:" ||
      url.hostname !== "watch" ||
      url.pathname !== `/${slug}` ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      url.searchParams.getAll("autoplay").length > 1 ||
      url.searchParams.getAll("topShelf").length > 1
    )
      return null
    if (url.searchParams.get("autoplay") === "1") return "play"
    return url.searchParams.get("topShelf") === "1" ? "details" : null
  } catch {
    return null
  }
}
