import {
  WATCH_BASE_PATH,
  WATCH_PUBLIC_METADATA_ORIGIN,
} from "./watch-public-url"

/** Navigation-relative anchors need the exact public document pathname. */
export function watchSurfaceHrefNeedsDocumentPathname(href: string): boolean {
  const value = href.trim()
  // WHATWG parsing keeps a matching special scheme relative to the current
  // document unless it supplies an authority (for example https:birth.html).
  if (/^https?:/i.test(value) && !/^https?:\/\//i.test(value)) return true
  return !value.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

/** Public source paths only. Next Link root paths include the configured base path. */
export function watchSurfaceItemPath(
  href: string | null | undefined,
  nextLink = true,
  publicDocumentPathname?: string,
): string | null {
  if (href == null) return null
  if (watchSurfaceHrefNeedsDocumentPathname(href) && !publicDocumentPathname)
    return null
  if (
    publicDocumentPathname != null &&
    !/^\/(?!\/)[^?#]*$/.test(publicDocumentPathname)
  )
    return null
  try {
    const value =
      nextLink &&
      href.startsWith("/") &&
      !href.startsWith(`${WATCH_BASE_PATH}/`)
        ? `${WATCH_BASE_PATH}${href}`
        : href
    const url = new URL(
      value,
      `${WATCH_PUBLIC_METADATA_ORIGIN}${publicDocumentPathname ?? "/"}`,
    )
    return url.origin === WATCH_PUBLIC_METADATA_ORIGIN &&
      /^\/watch\/[a-zA-Z0-9_-]+\.html(?:\/[a-zA-Z0-9_-]+\.html){0,2}$/.test(
        url.pathname,
      )
      ? url.pathname
      : null
  } catch {
    return null
  }
}
