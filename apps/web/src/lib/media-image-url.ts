// Resolves the image URL string a MediaCollection card should render.
// Extracted from `apps/web/src/components/sections/MediaCollection.tsx` so the
// behavior is unit-testable and the regex edge cases (case, www-prefix,
// path-anchor, capture-group narrowing) can't silently regress.

const BASE_PATH = "/watch"

export function resolveMediaImageUrl(url: string | null): string | null {
  if (!url) return null
  // Seed authors point poster URLs at jesusfilm.org assuming the assets
  // are hosted there, but Cloudflare routes those paths to dynamic
  // catch-all handlers (307 → .html) for any client that isn't Next.js's
  // own /public/ resolution. The source of truth is apps/web/public/images
  // served under this app's basePath, so rewrite the same seed value to
  // resolve both locally (127.0.0.1/watch/images/…) and in prod
  // (watch.jesusfilm.org/watch/images/…). `i` flag covers uppercased
  // schemes that would otherwise fall through unrewritten.
  const localPosterMatch = url.match(
    /^https?:\/\/(?:www\.)?jesusfilm\.org(\/images\/.*)$/i,
  )
  if (localPosterMatch?.[1]) return `${BASE_PATH}${localPosterMatch[1]}`
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  if (url.startsWith(`${BASE_PATH}/`)) return url
  if (url.startsWith("/images/")) return `${BASE_PATH}${url}`
  return url
}
