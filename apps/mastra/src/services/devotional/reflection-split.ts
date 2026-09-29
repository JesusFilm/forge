/**
 * Split a reflection into ONE-SENTENCE chunks so each gets its own card +
 * narration and only one sentence is on screen at a time (owner: for social
 * feeds the text must not cover the frame). Standalone (no imports) so both the
 * audio and manifest sides can use it without a circular dependency.
 */
/**
 * A full stop that ends a WORD, not a sentence: an initial ("J.C.", "C.S.") or
 * a short title ("St.", "Dr."). The authored vineyard script names "J.C. Ryle",
 * and splitting there put a card on screen that said only "J.C." — and a voice
 * that read those two letters on their own.
 */
const NOT_A_SENTENCE_END =
  /^(?:(?:[A-Z]\.)+|Mr\.|Mrs\.|Ms\.|Dr\.|St\.|Mt\.|vs\.|cf\.)$/

export function splitReflection(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim()
  if (!flat) return []
  // The terminator may be followed by a CLOSING QUOTE, and it usually is
  // when the commentator quotes speech. Without the optional quote here the
  // lookbehind sees "perish!'" as unterminated and three sentences land on
  // one card — which is what shipped, and what the owner caught on screen.
  const pieces = flat.split(/(?<=[.!?…]['’"”]?)\s+/).filter(Boolean)
  const sentences: string[] = []
  for (const piece of pieces) {
    const prev = sentences[sentences.length - 1]
    const lastWord = prev?.split(" ").at(-1) ?? ""
    if (prev !== undefined && NOT_A_SENTENCE_END.test(lastWord)) {
      sentences[sentences.length - 1] = `${prev} ${piece}`
    } else {
      sentences.push(piece)
    }
  }
  return sentences.length ? sentences : [flat]
}
