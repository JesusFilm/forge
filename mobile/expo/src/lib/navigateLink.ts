import { Linking } from "react-native"

/**
 * Returns true if the URL is an internal app link (relative path).
 */
export function isInternalLink(url: string): boolean {
  return url.startsWith("/")
}

/**
 * Parses an internal route from a relative URL path.
 * Supports: /watch/{slug} → Experience screen
 * Returns null if the path doesn't match a known route.
 */
export function parseInternalRoute(
  url: string,
): { screen: "Experience"; params: { slug: string } } | null {
  // Match /watch/{slug} with optional trailing segments and .html
  const match = url.match(/^\/watch\/([^/?#]+)/)
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
  }
  void Linking.openURL(url)
}
