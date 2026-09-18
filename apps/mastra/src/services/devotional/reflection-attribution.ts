/**
 * The on-screen credit for the reflection's source.
 *
 * "Adapted from a trusted classic" signals a historic, credible source even to
 * viewers who don't recognize the name (owner note); the author's name follows,
 * and after it the year the work was first published, so the viewer can see at
 * a glance that the thought is old, not something written this morning by a
 * machine (owner, 2026-09-18).
 *
 * Years are of FIRST publication, from the works the corpus ingests:
 *   - Ryle's Expository Thoughts appeared volume by volume; Matthew in 1856,
 *     Luke in 1858.
 *   - Henry's Exposition of the Old and New Testaments ran 1708-1710; the
 *     Gospels volume is 1710.
 *   - Spurgeon's morning readings appeared as Morning by Morning in 1865; the
 *     combined Morning and Evening followed, and 1865 is the date the work
 *     itself is dated from.
 * A source with no year listed simply shows the name, as before.
 */
const FIRST_PUBLISHED: ReadonlyArray<readonly [RegExp, number]> = [
  [/Expository Thoughts.*\bLuke\b/i, 1858],
  [/Expository Thoughts.*\bMatthew\b/i, 1856],
  [/Matthew Henry/i, 1710],
  [/Spurgeon/i, 1865],
]

/** Author name as shown: the part before the first comma of the citation. */
export function authorOf(sourceName: string): string {
  return sourceName.split(",")[0].trim()
}

/** Year the cited work was first published, or null when unknown. */
export function firstPublishedYear(sourceName: string): number | null {
  for (const [re, year] of FIRST_PUBLISHED) {
    if (re.test(sourceName)) return year
  }
  return null
}

/** "Adapted from a trusted classic · J.C. Ryle, 1858" */
export function attributionFor(sourceName: string, prefix: string): string {
  const year = firstPublishedYear(sourceName)
  const author = authorOf(sourceName)
  return `${prefix} · ${author}${year ? `, ${year}` : ""}`
}
