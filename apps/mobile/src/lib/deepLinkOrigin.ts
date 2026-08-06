import { withTimeout } from "./withTimeout"

/**
 * External-arrival registry for deep-link attribution. Stack shape cannot answer
 * "did this come from outside?" — the initialRouteName anchor puts (tabs) under a
 * cold link, so canGoBack() is already true. Only the opening URL is authoritative.
 */
export type DeepLinkEntry = "cold" | "warm"

type Arrival = { entry: DeepLinkEntry; at: number }

const externalArrivals = new Map<string, Arrival>()

// A genuine arrival is consumed within a microtask of navigation. Anything older
// was stranded (e.g. the slug was already the active route, so no effect re-ran)
// and must not mis-tag a later in-app open.
const ARRIVAL_TTL_MS = 30_000

// expo-router races this same call against 150ms (facebook/react-native#25675):
// getInitialURL can hang rather than reject, which would wedge the gate forever.
const INITIAL_URL_DEADLINE_MS = 3_000

/**
 * Extracts the watch slug from a deep link. Handles the custom scheme
 * (`forgemobile://watch/<slug>`) and the public share URL, whose canonical shape
 * is `/watch/<slug>.html` or `/watch/<slug>.html/<language>.html`.
 */
export function watchSlugFromUrl(url: string): string | null {
  if (!url) return null
  // Strip scheme+authority without URL(), which rejects custom schemes on Hermes.
  const afterScheme = url.includes("://")
    ? url.slice(url.indexOf("://") + 3)
    : url
  const pathOnly = afterScheme.split(/[?#]/)[0] ?? ""
  const segments = pathOnly.split("/").filter(Boolean)
  const watchIndex = segments.lastIndexOf("watch")
  if (watchIndex === -1) return null
  const raw = segments[watchIndex + 1]
  if (!raw) return null
  // The trailing language segment is ignored: the slug is always the first one.
  const slug = raw.endsWith(".html") ? raw.slice(0, -".html".length) : raw
  if (!slug) return null
  try {
    return decodeURIComponent(slug)
  } catch {
    return slug
  }
}

/** Records an external arrival. No-op for URLs that address no watch slug. */
export function registerDeepLinkUrl(
  url: string | null | undefined,
  entry: DeepLinkEntry,
  now: number = Date.now(),
): void {
  if (!url) return
  const slug = watchSlugFromUrl(url)
  if (!slug) return
  // Never downgrade cold to warm: an iOS universal link can arrive through both
  // getInitialURL and the url event on the same cold launch.
  const existing = externalArrivals.get(slug)
  if (existing?.entry === "cold" && entry === "warm") return
  externalArrivals.set(slug, { entry, at: now })
}

/**
 * Returns the arrival kind once, then forgets it, so a later in-app visit to the
 * same slug is not re-counted. Entries past the TTL are treated as absent.
 */
export function consumeDeepLinkEntry(
  slug: string | null | undefined,
  now: number = Date.now(),
): DeepLinkEntry | null {
  if (!slug) return null
  const arrival = externalArrivals.get(slug)
  if (arrival == null) return null
  externalArrivals.delete(slug)
  return now - arrival.at > ARRIVAL_TTL_MS ? null : arrival.entry
}

// Consumers must AWAIT this: the initial URL is only readable asynchronously and
// child effects run before the root layout's, so reading the registry at mount
// would classify every cold arrival as in-app.
let resolveReady: (() => void) | null = null
let ready: Promise<void> = new Promise<void>((resolve) => {
  resolveReady = resolve
})

export function whenDeepLinkOriginsReady(): Promise<void> {
  return ready
}

export type DeepLinkOriginDeps = {
  getInitialURL: () => Promise<string | null>
  addUrlListener: (handler: (event: { url: string }) => void) => {
    remove: () => void
  }
}

/**
 * Starts external-arrival tracking. Returns a teardown. The gate opens even if
 * the initial-URL read rejects OR never settles, so a consumer can never hang.
 */
export function initDeepLinkOrigins(deps: DeepLinkOriginDeps): () => void {
  const subscription = deps.addUrlListener((event) => {
    registerDeepLinkUrl(event?.url, "warm")
  })
  void withTimeout(deps.getInitialURL(), INITIAL_URL_DEADLINE_MS)
    .then((url) => registerDeepLinkUrl(url, "cold"))
    .catch(() => undefined)
    .finally(() => resolveReady?.())
  return () => subscription.remove()
}

/** Test seam only. */
export function resetDeepLinkOrigins(): void {
  externalArrivals.clear()
  ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
}
