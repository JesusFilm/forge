/**
 * Resolves the authored Watch homepage rail into render-ready cards.
 *
 * Two input shapes reach this module, and both stay supported for as long as
 * unmigrated blocks exist in admin:
 *   - `tiles` — the authored list (predefined tiles with optional overrides
 *     plus fully custom tiles). Authoritative whenever it is non-empty.
 *   - `categoryIds` — the original closed selection. Read only when `tiles`
 *     is absent, which is also what a rail authored before tile editing
 *     shipped looks like.
 *
 * Admin rejects malformed selections, but this stays defensive around
 * historical and hand-edited JSON: an unknown category, an unsafe href, or a
 * custom tile with no title is dropped rather than rendered broken. The href
 * check is deliberately re-run here even though admin validated on write —
 * persisted block JSON outlives any one validator, and the value lands in an
 * anchor's `href`.
 *
 * Free of React/Next component imports so the resolution rules can be tested
 * without a renderer.
 */
import {
  DEFAULT_WATCH_HOME_TILE_ICON,
  WATCH_HOME_CATEGORY_TILE_DEFAULTS,
  WATCH_HOME_TILE_ICON_KEYS,
  isExternalWatchHomeTileHref,
  isSafeWatchHomeTileHref,
  watchHomeTileGradient,
  type WatchHomeTileIconKey,
} from "@forge/watch-url-policy/watch-home-tiles"

import { tryAsContentSlug, watchVideoPath, type LocaleSlug } from "@/lib/routes"
import {
  WATCH_HOME_CATEGORIES,
  type WatchHomeCategoryId,
} from "@/lib/watch-home-categories"

export type WatchHomeRailTileInput = {
  readonly id?: string | null
  readonly categoryId?: string | null
  readonly title?: string | null
  readonly href?: string | null
  readonly icon?: string | null
  readonly style?: string | null
}

export type ResolvedWatchHomeTile = {
  /** React key and the `watch-home-category-*` test-id suffix. */
  key: string
  /**
   * Message key inside the `WatchHomeCategories` namespace, or null when the
   * tile carries an authored literal title. Authoring a title is what opts a
   * tile out of localization.
   */
  titleKey: string | null
  title: string | null
  href: string
  /** An `https:` destination — rendered as a plain anchor, not `next/link`. */
  external: boolean
  iconKey: WatchHomeTileIconKey
  gradient: string
}

const CATEGORY_BY_ID = new Map(
  WATCH_HOME_CATEGORIES.map((category) => [category.id, category]),
)
const ICON_KEYS = new Set<string>(WATCH_HOME_TILE_ICON_KEYS)

/**
 * The default destination for a predefined tile is locale-aware because the
 * catalog stores a content slug, not a URL. An AUTHORED href is used verbatim
 * — admin has no locale context when the operator types it, so silently
 * rewriting it would be guessing.
 */
function categoryHref(categoryId: WatchHomeCategoryId, locale: LocaleSlug) {
  const category = CATEGORY_BY_ID.get(categoryId)
  if (!category) return null
  const slug = tryAsContentSlug(category.slug)
  if (!slug) return null
  return watchVideoPath(slug, locale)
}

function nonEmpty(value: string | null | undefined) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function iconKeyFor(
  authored: string | null | undefined,
  categoryId: WatchHomeCategoryId | null,
): WatchHomeTileIconKey {
  const key = nonEmpty(authored)
  if (key != null && ICON_KEYS.has(key)) {
    return key as WatchHomeTileIconKey
  }
  if (categoryId != null) {
    return WATCH_HOME_CATEGORY_TILE_DEFAULTS[categoryId].icon
  }
  return DEFAULT_WATCH_HOME_TILE_ICON
}

function resolveTile(
  tile: WatchHomeRailTileInput,
  index: number,
  locale: LocaleSlug,
): ResolvedWatchHomeTile | null {
  const rawCategoryId = nonEmpty(tile.categoryId)
  const categoryId =
    rawCategoryId != null && CATEGORY_BY_ID.has(rawCategoryId as never)
      ? (rawCategoryId as WatchHomeCategoryId)
      : null
  const category = categoryId == null ? null : CATEGORY_BY_ID.get(categoryId)!

  const authoredTitle = nonEmpty(tile.title)
  // A custom tile has no catalog copy to fall back on.
  if (category == null && authoredTitle == null) return null

  const authoredHref = nonEmpty(tile.href)
  let href: string | null = null
  if (authoredHref != null) {
    href = isSafeWatchHomeTileHref(authoredHref) ? authoredHref : null
  } else if (categoryId != null) {
    href = categoryHref(categoryId, locale)
  }
  if (href == null) return null

  const authoredStyle = nonEmpty(tile.style)
  const gradient =
    authoredStyle != null
      ? watchHomeTileGradient(authoredStyle)
      : category != null
        ? category.gradient
        : watchHomeTileGradient(null)

  return {
    key: nonEmpty(tile.id) ?? categoryId ?? `tile-${index}`,
    titleKey:
      authoredTitle == null && category != null ? category.titleKey : null,
    title: authoredTitle,
    href,
    external: isExternalWatchHomeTileHref(href),
    iconKey: iconKeyFor(tile.icon, categoryId),
    gradient,
  }
}

export function resolveWatchHomeTiles({
  tiles,
  categoryIds,
  locale,
}: {
  tiles?: readonly WatchHomeRailTileInput[] | null
  categoryIds?: readonly string[] | null
  locale: LocaleSlug
}): ResolvedWatchHomeTile[] {
  const source: readonly WatchHomeRailTileInput[] =
    tiles != null && tiles.length > 0
      ? tiles
      : (categoryIds ?? []).map((categoryId) => ({ categoryId }))

  const resolved: ResolvedWatchHomeTile[] = []
  const seenKeys = new Set<string>()
  for (const [index, tile] of source.entries()) {
    const card = resolveTile(tile, index, locale)
    if (card == null) continue
    if (seenKeys.has(card.key)) continue
    seenKeys.add(card.key)
    resolved.push(card)
  }

  return resolved
}
