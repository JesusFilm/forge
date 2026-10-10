/**
 * Closed catalog for the category rail on the Watch homepage.
 *
 * IDs are the persisted authoring contract, slugs identify the existing Watch
 * collection destinations, and staff labels are stable non-localized copy for
 * authoring surfaces. Viewer-facing labels and visual presentation stay with
 * each consumer.
 */
export type WatchHomeCategoryCatalogEntry = {
  id: string
  slug: string
  staffLabel: string
}

export const WATCH_HOME_CATEGORY_CATALOG = [
  { id: "jesus", slug: "jesus", staffLabel: "The JESUS Film" },
  { id: "gospels", slug: "lumo", staffLabel: "Gospels" },
  {
    id: "short-videos",
    slug: "conversation-starters",
    staffLabel: "Short videos",
  },
  { id: "family", slug: "family", staffLabel: "Family" },
  {
    id: "relationships",
    slug: "relationships",
    staffLabel: "Relationships",
  },
  { id: "women", slug: "women-resources", staffLabel: "For Women" },
  {
    id: "students",
    slug: "student-resources",
    staffLabel: "For Students",
  },
  { id: "sports", slug: "sports", staffLabel: "Sports" },
  { id: "good-news", slug: "evangelism", staffLabel: "Good News" },
  { id: "hope", slug: "hope-collection", staffLabel: "Hope" },
  { id: "training", slug: "training", staffLabel: "Training" },
  { id: "easter", slug: "easter", staffLabel: "Easter" },
  { id: "christmas", slug: "christmas", staffLabel: "Christmas" },
] as const satisfies readonly WatchHomeCategoryCatalogEntry[]

export type WatchHomeCategoryId =
  (typeof WATCH_HOME_CATEGORY_CATALOG)[number]["id"]
