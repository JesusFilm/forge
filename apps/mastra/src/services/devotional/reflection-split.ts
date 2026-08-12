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
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean)
  return sentences.length ? sentences : [text.trim()].filter(Boolean)
}
