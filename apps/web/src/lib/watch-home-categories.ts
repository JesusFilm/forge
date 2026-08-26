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

export type WatchHomeCategory = {
  /** Stable structural identifier. React key, icon key, and test id. */
  id: string
  /** Collection parent content slug — the `/watch/<slug>.html` destination. */
  slug: string
  /** Key inside the `WatchHomeCategories` message namespace. */
  titleKey: string
  /** Card background. Mirrors the browse-modal category card language. */
  gradient: string
}

export const WATCH_HOME_CATEGORIES = [
  {
    id: "jesus",
    slug: "jesus",
    titleKey: "jesus",
    gradient: "linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%)",
  },
  {
    id: "gospels",
    slug: "lumo",
    titleKey: "gospels",
    gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  },
  {
    id: "short-videos",
    slug: "conversation-starters",
    titleKey: "shortVideos",
    gradient: "linear-gradient(135deg, #f97316 0%, #c2410c 100%)",
  },
  {
    id: "family",
    slug: "family",
    titleKey: "family",
    gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  },
  {
    id: "relationships",
    slug: "relationships",
    titleKey: "relationships",
    gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  },
  {
    id: "women",
    slug: "women-resources",
    titleKey: "women",
    gradient: "linear-gradient(135deg, #a855f7 0%, #6d28d9 100%)",
  },
  {
    id: "students",
    slug: "student-resources",
    titleKey: "students",
    gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  },
  {
    id: "sports",
    slug: "sports",
    titleKey: "sports",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #1d4ed8 100%)",
  },
  {
    id: "good-news",
    slug: "evangelism",
    titleKey: "goodNews",
    gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  },
  {
    id: "hope",
    slug: "hope-collection",
    titleKey: "hope",
    gradient: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
  },
  {
    id: "training",
    slug: "training",
    titleKey: "training",
    gradient: "linear-gradient(135deg, #64748b 0%, #334155 100%)",
  },
  {
    id: "easter",
    slug: "easter",
    titleKey: "easter",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
  },
  {
    id: "christmas",
    slug: "christmas",
    titleKey: "christmas",
    gradient: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
  },
] as const satisfies readonly WatchHomeCategory[]

export type WatchHomeCategoryId = (typeof WATCH_HOME_CATEGORIES)[number]["id"]
