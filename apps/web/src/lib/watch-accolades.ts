/**
 * Watch-page accolades — fixed editorial awards surfaced beside a video's
 * hero metadata.
 *
 * JESUS (1979) holds the Guinness World Records title for the most translated
 * film. The record belongs to the feature film itself, not to its chapter
 * segments and not to the wider Jesus Film Project library, so admission is an
 * explicit slug allowlist rather than a title, parent, or label match — a
 * fuzzy rule would stamp the record onto the ~61 JESUS chapter pages too.
 *
 * This lives in web rather than admin because it is one immutable fact about
 * one catalogue entry, not per-video CMS data. If a second accolade or an
 * editor-managed award list ever lands, move it behind an admin field and
 * delete this module.
 */

export type WatchAccolade = "most-translated-film"

/**
 * Slugs that resolve to the JESUS feature film. `jesus` is the production
 * slug; the other two mirror the defensive aliases already admitted by
 * `VIDEO_BIBLE_COLLECTION_SLUGS` in
 * `src/components/watch-language-inventory/LanguageInventoryPage.tsx`.
 */
const MOST_TRANSLATED_FILM_SLUGS: ReadonlySet<string> = new Set([
  "jesus",
  "jesus-film",
  "the-jesus-film",
])

/**
 * Returns the accolade a watch slug carries, or `null` when it carries none.
 * Callers pass `WatchVideoRecord["slug"]` directly, so nullish and blank
 * values are normal inputs rather than errors.
 */
export function watchAccoladeForSlug(
  slug: string | null | undefined,
): WatchAccolade | null {
  if (typeof slug !== "string") return null
  const normalized = slug.trim().toLowerCase()
  if (normalized.length === 0) return null
  return MOST_TRANSLATED_FILM_SLUGS.has(normalized)
    ? "most-translated-film"
    : null
}
