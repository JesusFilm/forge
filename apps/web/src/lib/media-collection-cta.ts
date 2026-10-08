import { isVagueMediaCollectionCtaLabel } from "@forge/watch-url-policy/media-collection-cta"
import { DEFAULT_WATCH_LANGUAGE_SLUG } from "@forge/watch-url-policy/routes"
import { resolveWatchShareUrlFromPathname } from "@/lib/share"
import { WATCH_BASE_PATH, normalizeWatchRootHref } from "@/lib/watch-paths"
import { WATCH_PUBLIC_METADATA_ORIGIN } from "@/lib/watch-public-url"

// Hosts that serve the public Watch pages. An absolute CTA URL on any other
// host is an external destination and can never be the current page.
const PUBLIC_WATCH_HOSTS: ReadonlySet<string> = new Set([
  "www.jesusfilm.org",
  "jesusfilm.org",
])

const EXPLICIT_ENGLISH_HOME_PATH = `${WATCH_BASE_PATH}/${DEFAULT_WATCH_LANGUAGE_SLUG}.html`

/**
 * Render-ready CTA href. A bare `"/"` means the Watch root (the editor's old
 * template default), and a Watch page path is rewritten to its canonical
 * public form, so `/watch/x.html/english.html` renders as `/watch/x.html`.
 * Anything else — an external URL, a non-Watch path — is returned unchanged.
 */
export function canonicalMediaCollectionCtaHref(href: string): string {
  const normalized = normalizeWatchRootHref(href) ?? href
  if (!normalized.startsWith(`${WATCH_BASE_PATH}/`)) return normalized
  const canonicalUrl = resolveWatchShareUrlFromPathname({
    origin: WATCH_PUBLIC_METADATA_ORIGIN,
    pathname: normalized,
  })
  return canonicalUrl ? new URL(canonicalUrl).pathname : normalized
}

/**
 * Reduce a CTA href or a page pathname to the one string that identifies the
 * Watch page it lands on, or `null` when it cannot be a public Watch page
 * (external host, protocol-relative, unparseable).
 *
 * Normalization: surrounding whitespace, the query string, the fragment, case,
 * repeated and trailing slashes are ignored; a same-origin absolute URL is
 * reduced to its path; `"/"` means the Watch root; and a Watch path is
 * canonicalized, so explicit English (`/watch/x.html/english.html`,
 * `/watch/english.html`) equals its language-less public form.
 */
export function watchPageIdentity(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.startsWith("//")) return null
  if (trimmed === "/") return WATCH_BASE_PATH

  let url: URL
  try {
    url = new URL(trimmed, WATCH_PUBLIC_METADATA_ORIGIN)
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (!PUBLIC_WATCH_HOSTS.has(url.hostname)) return null

  let pathname = url.pathname.toLowerCase().replace(/\/{2,}/g, "/")
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "")
  if (
    pathname !== WATCH_BASE_PATH &&
    !pathname.startsWith(`${WATCH_BASE_PATH}/`)
  ) {
    return pathname
  }

  const canonical = canonicalMediaCollectionCtaHref(pathname)
  return canonical === EXPLICIT_ENGLISH_HOME_PATH ? WATCH_BASE_PATH : canonical
}

/**
 * Whether a CTA href lands on the page the viewer is already on. Unknown on
 * either side means "not the same page": the guard only drops a link it can
 * prove is a self-link.
 */
export function isSameWatchPage(
  href: string | null | undefined,
  currentPathname: string | null | undefined,
): boolean {
  const target = watchPageIdentity(href)
  return target != null && target === watchPageIdentity(currentPathname)
}

export type MediaCollectionCtaLabel =
  | { kind: "authored"; text: string }
  | { kind: "collection" }
  | { kind: "languageDirectory" }
  | { kind: "inventory" }

export type MediaCollectionCta = {
  href: string
  label: MediaCollectionCtaLabel
}

/**
 * Pick the CTA a Media Collection renders.
 *
 * Destinations are tried in order — a full-story card when the label promises
 * one, the authored link, the collection the rail's items share, then the
 * language's video inventory — and the first one that is not the current page wins. With every candidate a self-link, the
 * rail renders no CTA rather than a button that reloads the page (W-096 /
 * FGE-232: "See all" on the Watch home pointed back at `/watch`).
 *
 * A label always names its destination. An authored label belongs to the
 * authored link, or to the inferred collection when no link was authored; it
 * is never moved onto a fallback, because "Watch the full story" over the
 * video inventory is the misleading CTA this exists to prevent. Vague labels
 * such as "Watch" and "See all" are treated as absent and replaced with a
 * localized label derived from the selected destination.
 */
export function resolveMediaCollectionCta({
  authoredHref,
  authoredLabel,
  collectionHref,
  firstItemHref,
  inventoryHref,
  currentPathname,
}: {
  authoredHref: string | null | undefined
  authoredLabel: string | null | undefined
  collectionHref: string | null | undefined
  firstItemHref?: string | null
  inventoryHref: string
  currentPathname: string | null | undefined
}): MediaCollectionCta | null {
  const label =
    typeof authoredLabel === "string" &&
    authoredLabel.trim().length > 0 &&
    !isVagueMediaCollectionCtaLabel(authoredLabel)
      ? ({ kind: "authored", text: authoredLabel.trim() } as const)
      : null
  const explicitHref =
    typeof authoredHref === "string" && authoredHref.trim().length > 0
      ? authoredHref.trim()
      : null
  const normalizedAuthoredLabel =
    typeof authoredLabel === "string"
      ? authoredLabel.trim().replace(/\s+/g, " ").toLowerCase()
      : ""
  const firstItemForFullStory =
    normalizedAuthoredLabel === "watch the full story" && firstItemHref
      ? canonicalMediaCollectionCtaHref(firstItemHref)
      : null
  const isLanguageDirectory = (href: string) => {
    const identity = watchPageIdentity(href)
    return identity != null && /\/watch\/languages(?:\/|$)/i.test(identity)
  }
  const authoredIsSelfLink = Boolean(
    explicitHref && isSameWatchPage(explicitHref, currentPathname),
  )

  const candidates: MediaCollectionCta[] = []
  if (firstItemForFullStory) {
    candidates.push({
      href: firstItemForFullStory,
      label: label ?? { kind: "collection" },
    })
  }
  if (explicitHref && !authoredIsSelfLink) {
    candidates.push({
      href: canonicalMediaCollectionCtaHref(explicitHref),
      label: isLanguageDirectory(explicitHref)
        ? { kind: "languageDirectory" }
        : (label ?? { kind: "collection" }),
    })
  }
  if (collectionHref && !authoredIsSelfLink) {
    candidates.push({
      href: canonicalMediaCollectionCtaHref(collectionHref),
      label: (explicitHref ? null : label) ?? { kind: "collection" },
    })
  }
  candidates.push({ href: inventoryHref, label: { kind: "inventory" } })

  return (
    candidates.find(
      (candidate) => !isSameWatchPage(candidate.href, currentPathname),
    ) ?? null
  )
}
