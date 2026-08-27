/**
 * Authoring contract for the Watch homepage category rail's tiles.
 *
 * The rail started as a closed, ordered selection over
 * `WATCH_HOME_CATEGORY_CATALOG` — every tile's title, destination, icon, and
 * gradient were consumer-owned constants. Admins can now author custom tiles
 * and override any of those four fields on a predefined tile, so the icon and
 * style VOCABULARIES have to be shared: the admin editor needs them to render
 * a picker with a truthful preview, and apps/web needs them to render the
 * authored choice. Only the vocabularies moved — viewer-facing localized copy
 * still lives with apps/web.
 *
 * Kept free of React/Next imports for the same reason as
 * `watch-home-categories.ts`: plain-Node scripts and Zod schemas import it.
 */
import {
  WATCH_HOME_CATEGORY_CATALOG,
  type WatchHomeCategoryId,
} from "./watch-home-categories"

// -----------------------------------------------------------------------------
// Icons
// -----------------------------------------------------------------------------

/**
 * Semantic icon keys. Deliberately NOT lucide component names — the key is
 * persisted in block JSON, so it must survive an icon-library swap. Each
 * consumer maps every key to a concrete glyph through an exhaustive
 * `Record<WatchHomeTileIconKey, T>`, which makes an unmapped key a compile
 * error rather than a blank tile.
 */
export const WATCH_HOME_TILE_ICONS = [
  { key: "film", label: "Film" },
  { key: "book", label: "Book" },
  { key: "clock", label: "Short" },
  { key: "users", label: "People" },
  { key: "heart", label: "Heart" },
  { key: "flower", label: "Flower" },
  { key: "graduation", label: "Students" },
  { key: "trophy", label: "Trophy" },
  { key: "megaphone", label: "Megaphone" },
  { key: "anchor", label: "Anchor" },
  { key: "compass", label: "Compass" },
  { key: "sunrise", label: "Sunrise" },
  { key: "gift", label: "Gift" },
  { key: "play", label: "Play" },
  { key: "globe", label: "Globe" },
  { key: "music", label: "Music" },
  { key: "sparkles", label: "Sparkles" },
  { key: "star", label: "Star" },
  { key: "map-pin", label: "Place" },
  { key: "calendar", label: "Calendar" },
  { key: "message-circle", label: "Conversation" },
  { key: "download", label: "Download" },
] as const satisfies readonly { key: string; label: string }[]

export type WatchHomeTileIconKey = (typeof WATCH_HOME_TILE_ICONS)[number]["key"]

export const WATCH_HOME_TILE_ICON_KEYS = WATCH_HOME_TILE_ICONS.map(
  ({ key }) => key,
) as WatchHomeTileIconKey[]

export const DEFAULT_WATCH_HOME_TILE_ICON =
  "sparkles" satisfies WatchHomeTileIconKey

// -----------------------------------------------------------------------------
// Visual styles
// -----------------------------------------------------------------------------

/**
 * Named gradient presets. The thirteen leading entries carry the EXACT
 * gradient strings the predefined categories already render, so sourcing the
 * per-category presentation from this catalog is a no-op for viewers (pinned
 * by `watch-home-tiles.test.ts`).
 */
export const WATCH_HOME_TILE_STYLES = [
  {
    key: "crimson",
    label: "Crimson",
    gradient: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)",
  },
  {
    key: "indigo",
    label: "Indigo",
    gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  },
  {
    key: "amber",
    label: "Amber",
    gradient: "linear-gradient(135deg, #f97316 0%, #c2410c 100%)",
  },
  {
    key: "sunset",
    label: "Sunset",
    gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  },
  {
    key: "rose",
    label: "Rose",
    gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  },
  {
    key: "violet",
    label: "Violet",
    gradient: "linear-gradient(135deg, #a855f7 0%, #6d28d9 100%)",
  },
  {
    key: "mint",
    label: "Mint",
    gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  },
  {
    key: "azure",
    label: "Azure",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #1d4ed8 100%)",
  },
  {
    key: "sky",
    label: "Sky",
    gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  },
  {
    key: "teal",
    label: "Teal",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
  },
  {
    key: "slate",
    label: "Slate",
    gradient: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
  },
  {
    key: "gold",
    label: "Gold",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
  },
  {
    key: "ruby",
    label: "Ruby",
    gradient: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
  },
  {
    key: "midnight",
    label: "Midnight",
    gradient: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
  },
  {
    key: "forest",
    label: "Forest",
    gradient: "linear-gradient(135deg, #16a34a 0%, #14532d 100%)",
  },
] as const satisfies readonly { key: string; label: string; gradient: string }[]

export type WatchHomeTileStyleKey =
  (typeof WATCH_HOME_TILE_STYLES)[number]["key"]

export const WATCH_HOME_TILE_STYLE_KEYS = WATCH_HOME_TILE_STYLES.map(
  ({ key }) => key,
) as WatchHomeTileStyleKey[]

export const DEFAULT_WATCH_HOME_TILE_STYLE =
  "slate" satisfies WatchHomeTileStyleKey

const STYLE_BY_KEY = new Map(
  WATCH_HOME_TILE_STYLES.map((style) => [style.key, style]),
)

const DEFAULT_TILE_GRADIENT = STYLE_BY_KEY.get(
  DEFAULT_WATCH_HOME_TILE_STYLE,
)!.gradient

/** Unknown/absent keys resolve to the default preset rather than no background. */
export function watchHomeTileGradient(key: string | null | undefined): string {
  if (key == null) return DEFAULT_TILE_GRADIENT
  return (
    STYLE_BY_KEY.get(key as WatchHomeTileStyleKey)?.gradient ??
    DEFAULT_TILE_GRADIENT
  )
}

// -----------------------------------------------------------------------------
// Predefined category defaults
// -----------------------------------------------------------------------------

export type WatchHomeCategoryTileDefaults = {
  icon: WatchHomeTileIconKey
  style: WatchHomeTileStyleKey
}

/**
 * What a predefined category tile looks like when the admin overrides
 * nothing. Exhaustive over the catalog, so adding a category without picking
 * an icon and a style is a compile error.
 */
export const WATCH_HOME_CATEGORY_TILE_DEFAULTS = {
  jesus: { icon: "film", style: "crimson" },
  gospels: { icon: "book", style: "indigo" },
  "short-videos": { icon: "clock", style: "amber" },
  family: { icon: "users", style: "sunset" },
  relationships: { icon: "heart", style: "rose" },
  women: { icon: "flower", style: "violet" },
  students: { icon: "graduation", style: "mint" },
  sports: { icon: "trophy", style: "azure" },
  "good-news": { icon: "megaphone", style: "sky" },
  hope: { icon: "anchor", style: "teal" },
  training: { icon: "compass", style: "slate" },
  easter: { icon: "sunrise", style: "gold" },
  christmas: { icon: "gift", style: "ruby" },
} as const satisfies Record<WatchHomeCategoryId, WatchHomeCategoryTileDefaults>

// -----------------------------------------------------------------------------
// Destination policy
// -----------------------------------------------------------------------------

export const MAX_WATCH_HOME_TILE_HREF_LENGTH = 2048
export const MAX_WATCH_HOME_TILE_TITLE_LENGTH = 80

// A control character — including the NUL / newline / tab tricks used to
// smuggle a scheme past a prefix check — is never legitimate in a destination.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Destinations an admin may type into a tile.
 *
 * Two accepted shapes and nothing else:
 *   - a same-origin absolute PATH (`/watch/jesus.html`), which must NOT start
 *     with `//` — a protocol-relative URL is a cross-origin destination
 *     wearing a path's clothes.
 *   - an absolute `https:` URL.
 *
 * Rejected at the admin write boundary AND re-checked at render, because the
 * persisted JSON outlives any one validator: `javascript:` and `data:` are
 * script-execution sinks, and plain `http:` downgrades the viewer's
 * connection.
 */
export function isSafeWatchHomeTileHref(value: unknown): value is string {
  if (typeof value !== "string") return false
  const href = value.trim()
  if (href.length === 0 || href.length > MAX_WATCH_HOME_TILE_HREF_LENGTH) {
    return false
  }
  if (CONTROL_CHARACTERS.test(href)) return false

  if (href.startsWith("//")) return false
  if (href.startsWith("/")) return true

  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return false
  }
  return parsed.protocol === "https:"
}

/**
 * Only meaningful for an href that already passed
 * `isSafeWatchHomeTileHref` — by then the only non-path shape left is an
 * absolute `https:` URL.
 */
export function isExternalWatchHomeTileHref(href: string): boolean {
  return !href.startsWith("/")
}

/**
 * Catalog lookup shared by the admin editor and the public renderer. Keyed by
 * plain `string` on purpose — every caller is checking an id read out of
 * persisted JSON, so narrowing the key to the literal union would just force
 * a cast at each of those call sites.
 */
export const WATCH_HOME_CATEGORY_BY_ID: ReadonlyMap<
  string,
  (typeof WATCH_HOME_CATEGORY_CATALOG)[number]
> = new Map(
  WATCH_HOME_CATEGORY_CATALOG.map((category) => [category.id, category]),
)
