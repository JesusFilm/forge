import { Linking } from "react-native"

const APP_DOMAINS = [
  "https://www.jesusfilm.org",
  "https://jesusfilm.org",
  "http://www.jesusfilm.org",
  "http://jesusfilm.org",
]

/**
 * If the URL is an absolute app-domain URL, strips the domain and returns
 * the path. Otherwise returns the original URL unchanged.
 */
function stripAppDomain(url: string): string {
  for (const domain of APP_DOMAINS) {
    if (url.startsWith(domain)) {
      return url.slice(domain.length) || "/"
    }
  }
  return url
}

/**
 * Returns true if the URL is an internal app link (relative path starting
 * with "/" but not "//") or an absolute URL on an app domain.
 */
export function isInternalLink(url: string): boolean {
  if (url.startsWith("//")) return false
  if (url.startsWith("/")) return true
  return APP_DOMAINS.some((domain) => url.startsWith(domain))
}

/**
 * Parses an internal route from a relative URL path.
 * Supports: /watch/{slug} → Experience screen
 * Also handles absolute app-domain URLs by stripping the domain first.
 * Returns null if the path doesn't match a known route.
 */
export function parseInternalRoute(
  url: string,
): { screen: "Experience"; params: { slug: string } } | null {
  const path = stripAppDomain(url)
  // Match /watch/{slug} with optional trailing segments and .html
  const match = path.match(/^\/watch\/([^/?#]+)/)
  if (match) {
    const slug = match[1].replace(/\.html$/, "")
    return { screen: "Experience", params: { slug } }
  }
  return null
}

/**
 * Navigates to an internal route if possible, otherwise opens in external browser.
 * @param url The link URL (relative or absolute)
 * @param navigate Function to navigate to a screen (e.g. navigation.navigate)
 */
export function navigateLink(
  url: string,
  navigate: (screen: string, params: Record<string, string>) => void,
): void {
  if (isInternalLink(url)) {
    const route = parseInternalRoute(url)
    if (route) {
      navigate(route.screen, route.params)
      return
    }
    // Unrecognized internal route — construct full URL as fallback
    const fallbackUrl = url.startsWith("/")
      ? `https://www.jesusfilm.org${url}`
      : url
    console.warn(`[navigateLink] Unhandled internal route: ${url}`)
    void Linking.openURL(fallbackUrl)
    return
  }
  void Linking.openURL(url)
}
