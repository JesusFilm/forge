/**
 * Split a reflection into ONE-SENTENCE chunks so each gets its own card +
 * narration and only one sentence is on screen at a time (owner: for social
 * feeds the text must not cover the frame). Standalone (no imports) so both the
 * audio and manifest sides can use it without a circular dependency.
 */
export function splitReflection(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    // The terminator may be followed by a CLOSING QUOTE, and it usually is
    // when the commentator quotes speech. Without the optional quote here the
    // lookbehind sees "perish!'" as unterminated and three sentences land on
    // one card — which is what shipped, and what the owner caught on screen.
    .split(/(?<=[.!?…]['’"”]?)\s+/)
    .filter(Boolean)
  return sentences.length ? sentences : [text.trim()].filter(Boolean)
}
