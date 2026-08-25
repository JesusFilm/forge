/**
 * Cut a Matthew Henry chapter down to the section covering one passage.
 *
 * Henry is ingested whole-chapter, which is fine for a devotional built on the
 * whole chapter and wrong for one built on a beat of it. Luke 19 is 10,770
 * words: Zacchaeus, the parable of the pounds, the triumphal entry and the
 * temple. Handing all of it to the modernizer buries the relevant part, and
 * handing all of it to the fidelity critic guarantees a "dropped argument"
 * finding, because most of what was dropped belongs to a different story.
 * Ryle never had this problem — his volumes are already split by section, so
 * he arrived pre-narrowed at roughly 800 words.
 *
 * Henry opens every chapter with his own outline naming the verse ranges
 * ("I. The conversion of Zaccheus the publican at Jericho, ver. 1-10. II. The
 * parable of the pounds ... ver. 11-27."), and then lays out each range as
 * scripture followed by exposition. That outline is the cut list.
 */

/** One of Henry's top-level divisions of a chapter. */
export type HenrySection = {
  startVerse: number
  endVerse: number
  text: string
}

const OUTLINE_ENTRY = /\bver\.\s*(\d{1,3})\s*[-–]\s*(\d{1,3})/g

/**
 * Where the scripture block for `verse` begins.
 *
 * Searched only after `from`, so a cross-reference inside the exposition
 * ("1 Cor. xii. 7", "1 Pet. iv. 10") cannot be mistaken for the start of the
 * chapter's verse 1 — those all sit later in the text than the block they
 * would be confused with.
 */
function verseBlockStart(text: string, verse: number, from: number): number {
  const re = new RegExp(`\\s${verse}\\s+[A-Z]`, "g")
  re.lastIndex = from
  const m = re.exec(text)
  return m ? m.index : -1
}

/** Henry's own outline, resolved to positions in the chapter text. */
export function henrySections(chapterText: string): HenrySection[] {
  // The outline lives before the first scripture block; ranges quoted later in
  // the exposition are references, not divisions.
  const firstBlock = verseBlockStart(chapterText, 1, 0)
  const header = chapterText.slice(0, firstBlock > 0 ? firstBlock : 600)
  const ranges: Array<[number, number]> = []
  for (const m of header.matchAll(OUTLINE_ENTRY)) {
    ranges.push([Number(m[1]), Number(m[2])])
  }
  if (ranges.length === 0) return []

  const starts: number[] = []
  let cursor = 0
  for (const [startVerse] of ranges) {
    const at = verseBlockStart(chapterText, startVerse, cursor)
    if (at < 0) return [] // outline and body disagree — better to give up than guess
    starts.push(at)
    cursor = at + 1
  }

  return ranges.map(([startVerse, endVerse], i) => ({
    startVerse,
    endVerse,
    text: chapterText
      .slice(starts[i], starts[i + 1] ?? chapterText.length)
      .trim(),
  }))
}

/**
 * The section a passage falls in, or null when the chapter has no usable
 * outline. Overlap is enough: a devotional on verses 3-5 wants the section
 * covering 1-10.
 */
export function henrySectionForVerses(
  chapterText: string,
  startVerse: number,
  endVerse: number,
): HenrySection | null {
  for (const s of henrySections(chapterText)) {
    if (startVerse <= s.endVerse && endVerse >= s.startVerse) return s
  }
  return null
}
