/**
 * Categories rendered by the Watch homepage "Browse by category" rail.
 *
 * Every entry is a category the library ACTUALLY has: a populated collection
 * parent that already renders its own `/watch/<slug>.html` page, so a card
 * click lands on real content instead of a synthesized listing. The set was
 * derived from the live catalog (111 English collections / 1,168 items) by
 * keeping the collection parents that read as top-level audience-facing
 * categories and dropping event-scoped, internal, and duplicate ones.
 *
 * `short-videos` is the one card named for a FORMAT, and it is still a
 * collection link: it points at Conversation Starters, the library's largest
 * short-film collection (21 English short films). There is no label-filtered
 * browse destination for short films — search returns one result for the
 * query — so a genuinely format-wide card cannot be built until that
 * destination exists. Feature films and series are omitted for the same
 * reason, with no collection standing in for them.
 *
 * This module is intentionally free of React and Next imports so the config
 * can be imported by plain-Node scripts and by tests without dragging the
 * client module graph along (same rule as `search-categories.ts`).
 */

import {
  WATCH_HOME_CATEGORY_CATALOG,
  type WatchHomeCategoryId,
} from "@forge/watch-url-policy/watch-home-categories"
import {
  WATCH_HOME_CATEGORY_TILE_DEFAULTS,
  watchHomeTileGradient,
} from "@forge/watch-url-policy/watch-home-tiles"

export type { WatchHomeCategoryId }

export type WatchHomeCategory = {
  /** Stable structural identifier. React key, icon key, and test id. */
  id: WatchHomeCategoryId
  /** Collection parent content slug — the `/watch/<slug>.html` destination. */
  slug: string
  /** Key inside the `WatchHomeCategories` message namespace. */
  titleKey: string
  /** Card background. Mirrors the browse-modal category card language. */
  gradient: string
}

type WatchHomeCategoryTitleKeys = Record<WatchHomeCategoryId, string>

/**
 * Localized-copy keys stay here; the gradient does NOT. Since admins can pick
 * a tile's visual style in the experience editor, the gradient VALUES live in
 * the shared `WATCH_HOME_TILE_STYLES` catalog and each category names one of
 * them through `WATCH_HOME_CATEGORY_TILE_DEFAULTS`. Sourcing the default from
 * there is what keeps the editor's swatch and this renderer showing the same
 * colour (pinned by `watch-home-categories.test.ts`).
 */
const WATCH_HOME_CATEGORY_TITLE_KEY_BY_ID = {
  jesus: "jesus",
  gospels: "gospels",
  "short-videos": "shortVideos",
  family: "family",
  relationships: "relationships",
  women: "women",
  students: "students",
  sports: "sports",
  "good-news": "goodNews",
  hope: "hope",
  training: "training",
  easter: "easter",
  christmas: "christmas",
} as const satisfies WatchHomeCategoryTitleKeys

export const WATCH_HOME_CATEGORIES = WATCH_HOME_CATEGORY_CATALOG.map(
  (category) => ({
    ...category,
    titleKey: WATCH_HOME_CATEGORY_TITLE_KEY_BY_ID[category.id],
    gradient: watchHomeTileGradient(
      WATCH_HOME_CATEGORY_TILE_DEFAULTS[category.id].style,
    ),
  }),
) satisfies readonly WatchHomeCategory[]
