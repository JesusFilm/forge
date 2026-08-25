/**
 * Split a classic-commentary excerpt into its numbered POINTS.
 *
 * Ryle (and Matthew Henry) structure an exposition as a sequence of points
 * introduced by an ordinal lead-in: "We learn, firstly, from these verses —",
 * "We see, secondly,", "Let us observe, lastly,". Everything before the first
 * lead-in is the preamble.
 *
 * Why this exists in CODE rather than as a prompt instruction: asking the
 * model to find the points itself AND then hold itself to two of them does
 * not hold. Given a full four-point excerpt with an "at most two points"
 * prose rule, the modernizer still sprawled across three of them and ran 70%
 * over the word target. Every reflection that came out well was produced from
 * a source that had already been sliced down to specific points. Segmenting
 * here turns "pick two" from a judgment the model has to make about
 * unstructured prose into a countable choice over an enumerated list.
 *
 * Pure and dependency-free so it is trivially testable.
 */

export type CommentaryPoint = {
  /** 1-based position in the excerpt. */
  index: number
  /** The ordinal word that introduced it ("firstly", "lastly", …), if any. */
  ordinal: string | null
  /** The point's full text, including its own lead-in sentence. */
  text: string
}

/**
 * Ordinal lead-ins, e.g. "We learn, firstly, from these verses —" or
 * "Let us observe, lastly,". The lead-in verb varies a lot across the corpus
 * ("We see" is the most common, then "We learn", "We have", "Let us
 * observe"…), so match on the ORDINAL rather than trying to enumerate verbs.
 */
const ORDINAL_LEAD_IN =
  /\b(?:we|let us)\s+(?:learn|see|observe|notice|have|are taught|should notice|should observe|should learn)\s*,?\s+(firstly|secondly|thirdly|fourthly|fifthly|sixthly|lastly)\b/gi

/**
 * Matthew Henry numbers his points with UPPERCASE roman numerals instead of
 * ordinal words: "I. Who, and what, this Zaccheus was.", "II. How he came in
 * Christ's way", "III. The notice Christ took of him". Without this his
 * expositions parsed as zero points, so nothing narrowed them and the point
 * picker never ran at all — Henry sections reached the modernizer four times
 * the size of a Ryle one, which is what kept the fidelity critic reporting
 * dropped arguments.
 *
 * Uppercase only, and only after a sentence break. Henry cites verses with
 * LOWERCASE romans ("1 Cor. xii. 7", "Rom. x.") several times a paragraph, and
 * matching those would shred the exposition into fragments.
 */
const ROMAN_LEAD_IN =
  /(?:^|[.!?]\s+|\n\s*)((?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.)\s+(?=[A-Z])/g

/**
 * Split `text` into its ordinal-marked points. Returns an EMPTY array when the
 * excerpt has no ordinal structure at all (roughly a fifth of the corpus is
 * continuous exposition) — callers should then use the excerpt as-is rather
 * than trying to impose a structure that isn't there.
 */
export function splitCommentaryPoints(text: string): CommentaryPoint[] {
  const ordinal = [...text.matchAll(ORDINAL_LEAD_IN)]
  // Ryle's ordinals win when present: they mark his argument, where a stray
  // roman in the same text would only be a citation.
  const matches =
    ordinal.length >= 2 ? ordinal : [...text.matchAll(ROMAN_LEAD_IN)]
  if (matches.length < 2) return [] // 0 or 1 marker → not a multi-point piece

  const points: CommentaryPoint[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0
    const end =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? text.length)
        : text.length
    // The roman-numeral pattern starts its match at the preceding sentence
    // break, so the slice can open with the previous point's full stop.
    const slice = text
      .slice(start, end)
      .trim()
      .replace(/^[.!?]\s*/, "")
    if (!slice) continue
    points.push({
      index: points.length + 1,
      ordinal: matches[i][1]?.toLowerCase() ?? null,
      text: slice,
    })
  }
  return points
}

/** The text before the first ordinal point (scene framing, "these verses
 *  describe…"). Empty string when the excerpt has no point structure. */
export function commentaryPreamble(text: string): string {
  const ordinal = [...text.matchAll(ORDINAL_LEAD_IN)]
  const marks =
    ordinal.length >= 2 ? ordinal : [...text.matchAll(ROMAN_LEAD_IN)]
  const first = marks[0]
  if (!first || first.index == null) return ""
  // The roman pattern anchors on the preceding sentence break, so its match
  // begins ON the full stop that ends the preamble. Keep that stop: the
  // preamble is handed to the modernizer as scene framing, and framing that
  // ends mid-sentence reads as truncated source.
  const end = /[.!?]/.test(text[first.index] ?? "")
    ? first.index + 1
    : first.index
  return text.slice(0, end).trim()
}
